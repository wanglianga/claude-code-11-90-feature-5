import type {
  Actor,
  AuditActorRole,
  AuditEntry,
  CaseFile,
  CommitResult,
  FieldGrant,
} from '../types';
import { seedAudits, seedCases } from '../data/seed';
import { uid } from '../lib/ids';
import { fingerprint } from '../lib/audit';
import { grantState, validateCandidate } from '../lib/rules';
import { remoteDb, type HistoryRecord } from '../db/remoteDb';
import { emit } from './bus';

// ============================================================
// 纯浏览器“模拟远端服务”：
// - 远端库 = 同源共享的 IndexedDB casedesk_remote_v1（两个标签页天然共享）
// - 用 online 开关 + 延迟模拟网络；离线时业务读/提交直接返回 NETWORK
// - 每次提交校验 baseRev 乐观锁并写 history 版本快照 + 审计
// ============================================================

let networkOnline = true;
export function setServerNetworkOnline(v: boolean): void {
  networkOnline = v;
}
export function isServerNetworkOnline(): boolean {
  return networkOnline;
}

const NETWORK_LATENCY: [number, number] = [180, 520];
function latency(): Promise<void> {
  const [lo, hi] = NETWORK_LATENCY;
  return new Promise((r) => setTimeout(r, lo + Math.random() * (hi - lo)));
}
function assertNetwork(): void {
  if (!networkOnline) {
    const e = new Error('模拟网络不可用（离线/地下室）') as Error & { code: 'NETWORK' };
    e.code = 'NETWORK';
    throw e;
  }
}

const SYSTEM_ACTOR: Actor = {
  id: 'system',
  account: '-',
  password: '-',
  name: '模拟环境',
  title: 'system',
  role: 'social_worker',
};

let seedPromise: Promise<void> | null = null;

export async function ensureSeeded(force = false): Promise<void> {
  if (seedPromise && !force) return seedPromise;
  seedPromise = (async () => {
    const db = await remoteDb();
    const seeded = await db.get('kv', 'seeded-v1');
    if (seeded && !force) return;

    if (force) {
      await db.clear('cases');
      await db.clear('grants');
      await db.clear('audit');
      await db.clear('history');
      await db.clear('kv');
    }

    const cases = seedCases();
    const auditSeeds = seedAudits(SYSTEM_ACTOR);
    // 所有异步指纹必须在开启 IndexedDB 事务前算完，避免事务在 await 期间自动提交
    const audits: AuditEntry[] = [];
    for (const a of auditSeeds) audits.push({ ...a, fingerprint: await fingerprint(stripFp(a)) });

    const tx = db.transaction(['cases', 'audit', 'history', 'kv'], 'readwrite');
    for (const c of cases) {
      await tx.objectStore('cases').put(c);
      const hist: HistoryRecord = {
        hid: `${c.id}@${c.rev}`,
        caseId: c.id,
        rev: c.rev,
        at: c.updatedAt,
        actorName: '种子数据',
        snapshot: structuredClone(c),
      };
      await tx.objectStore('history').put(hist);
    }
    for (const a of audits) {
      await tx.objectStore('audit').put(a);
    }
    await tx.objectStore('kv').put({ at: Date.now() }, 'seeded-v1');
    await tx.done;
  })();
  return seedPromise;
}

function stripFp(a: AuditEntry): Omit<AuditEntry, 'fingerprint'> {
  const { fingerprint: _fp, ...rest } = a;
  return rest;
}

// ---------- 脱敏：无有效授权不下发紧急联系人真值 ----------

export function redactCase(c: CaseFile, actor: Actor | null, grants: FieldGrant[], now: number): CaseFile {
  if (!actor) return { ...c, client: { ...c.client, emergencyContact: null } };
  const grant = grants.find(
    (g) => g.caseId === c.id && g.granteeActorId === actor.id && g.field === 'client.emergencyContact',
  );
  if (grantState(grant, now) === 'valid') return c;
  return { ...c, client: { ...c.client, emergencyContact: null } };
}

// ---------- 查询 ----------

export async function apiListCases(actor: Actor): Promise<CaseFile[]> {
  assertNetwork();
  await latency();
  const db = await remoteDb();
  const [cases, grants] = await Promise.all([db.getAll('cases'), db.getAll('grants')]);
  const now = Date.now();
  return cases
    .map((c) => redactCase(c, actor, grants, now))
    .sort((a, b) => a.id.localeCompare(b.id));
}

export async function apiGetCase(caseId: string, actor: Actor | null): Promise<CaseFile> {
  assertNetwork();
  await latency();
  const db = await remoteDb();
  const c = await db.get('cases', caseId);
  if (!c) throw new Error(`case not found: ${caseId}`);
  const grants = await db.getAll('grants');
  return redactCase(c, actor, grants, Date.now());
}

/** 内部/测试用：取未脱敏原始案卷 */
export async function rawGetCase(caseId: string): Promise<CaseFile | undefined> {
  const db = await remoteDb();
  return db.get('cases', caseId);
}

export async function apiListAudit(): Promise<AuditEntry[]> {
  const db = await remoteDb();
  const all = await db.getAll('audit');
  return all.sort((a, b) => b.at - a.at);
}

export async function apiListGrants(): Promise<FieldGrant[]> {
  const db = await remoteDb();
  return db.getAll('grants');
}

// ---------- 审计写入 ----------

export interface AuditDesc {
  actorId: string;
  actorName: string;
  actorRole?: AuditActorRole;
  tabId: string;
  action: string;
  target: string;
  summary: string;
  caseId?: string;
  rev?: number;
  at?: number;
}

async function buildEntries(descs: AuditDesc[]): Promise<AuditEntry[]> {
  const out: AuditEntry[] = [];
  for (const d of descs) {
    const base: Omit<AuditEntry, 'id' | 'fingerprint'> = {
      at: d.at ?? Date.now(),
      actorId: d.actorId,
      actorName: d.actorName,
      actorRole: d.actorRole ?? 'social_worker',
      tabId: d.tabId,
      action: d.action,
      target: d.target,
      summary: d.summary,
      caseId: d.caseId,
      rev: d.rev,
    };
    out.push({
      ...base,
      id: uid('aud'),
      fingerprint: await fingerprint(base),
    });
  }
  return out;
}

// ---------- 提交案卷（乐观锁 + 守卫） ----------

export interface CommitArgs {
  actor: Actor;
  tabId: string;
  caseId: string;
  baseRev: number;
  candidate: CaseFile;
  auditEvents?: AuditDesc[];
}

export async function apiCommitCase(args: CommitArgs): Promise<CommitResult> {
  assertNetwork();
  await latency();
  const db = await remoteDb();
  const stored = await db.get('cases', args.caseId);
  if (!stored) return { ok: false, code: 'GUARD', violations: [] };

  if (stored.rev !== args.baseRev) {
    const baseHist = await db.get('history', `${args.caseId}@${args.baseRev}`);
    const grants = await db.getAll('grants');
    return {
      ok: false,
      code: 'CONFLICT',
      serverRev: stored.rev,
      current: redactCase(stored, args.actor, grants, Date.now()),
      baseSnapshot: baseHist
        ? redactCase(baseHist.snapshot, args.actor, grants, baseHist.at)
        : null,
    };
  }

  const grants = (await db.getAll('grants')).filter((g) => g.caseId === args.caseId);
  const violations = validateCandidate(args.candidate, {
    current: stored,
    grants,
    now: Date.now(),
    actorId: args.actor.id,
  });
  if (violations.length) {
    return { ok: false, code: 'GUARD', violations, current: structuredClone(stored) };
  }

  const next: CaseFile = structuredClone(args.candidate);
  next.id = args.caseId;
  next.rev = stored.rev + 1;
  next.updatedAt = Date.now();

  const descs: AuditDesc[] = args.auditEvents?.length
    ? args.auditEvents.map((e) => ({ ...e, caseId: args.caseId, rev: next.rev }))
    : [
        {
          actorId: args.actor.id,
          actorName: args.actor.name,
          actorRole: args.actor.role,
          tabId: args.tabId,
          action: 'commit',
          target: args.caseId,
          summary: `提交案卷修改，版本 ${args.baseRev} → ${next.rev}`,
          caseId: args.caseId,
          rev: next.rev,
        },
      ];
  const entries = await buildEntries(descs);

  const tx = db.transaction(['cases', 'history', 'audit'], 'readwrite');
  await tx.objectStore('cases').put(next);
  await tx.objectStore('history').put({
    hid: `${next.id}@${next.rev}`,
    caseId: next.id,
    rev: next.rev,
    at: next.updatedAt,
    actorName: args.actor.name,
    snapshot: structuredClone(next),
  } satisfies HistoryRecord);
  for (const e of entries) await tx.objectStore('audit').put(e);
  await tx.done;

  emit({ type: 'remote-changed', caseId: args.caseId, rev: next.rev, at: next.updatedAt, actorName: args.actor.name });
  emit({ type: 'audit-added' });

  return {
    ok: true,
    case: redactCase(next, args.actor, await db.getAll('grants'), Date.now()),
    audits: entries,
  };
}

// ---------- 主管动作：退回 / 确认进入服务计划 ----------

export async function apiSupervisorDecision(args: {
  actor: Actor;
  tabId: string;
  caseId: string;
  recordId: string;
  decision: 'return' | 'confirm';
  note: string;
  ownerName?: string;
}): Promise<{ ok: true; case: CaseFile } | { ok: false; message: string }> {
  assertNetwork();
  await latency();
  const db = await remoteDb();
  const stored = await db.get('cases', args.caseId);
  if (!stored) return { ok: false, message: '案卷不存在' };

  const next = structuredClone(stored);
  const visit = next.visits.find((v) => v.id === args.recordId);
  if (!visit) return { ok: false, message: '服务记录不存在' };
  const goal = next.goals.find((g) => g.id === visit.goalId);
  const at = Date.now();
  let summary = '';
  let action = '';

  if (args.decision === 'return') {
    visit.status = 'returned';
    visit.supervisorNote = args.note;
    if (goal) {
      goal.publishState = 'returned';
      goal.returnNote = args.note;
      goal.returnedByName = args.actor.name;
      goal.returnedAt = at;
    }
    action = 'supervisor-return';
    summary = `主管${args.actor.name}退回记录 ${args.recordId} 及服务目标${goal ? `「${goal.title}」` : ''}：${args.note}`;
  } else {
    visit.status = 'confirmed';
    visit.supervisorNote = args.note || '事实完整，确认进入服务计划。';
    if (goal) goal.publishState = 'confirmed';
    next.plan.push({
      id: uid('plan'),
      goalId: visit.goalId,
      text: `${visit.confirmedGoalText || goal?.title || '服务目标'}（依据 ${visit.serviceDate} 家访记录 ${visit.id}）`,
      ownerName: args.ownerName || '责任社工',
      addedAt: at,
      sourceRecordId: visit.id,
      rev: next.rev + 1,
    });
    action = 'supervisor-confirm';
    summary = `主管${args.actor.name}确认记录 ${args.recordId}，目标「${goal?.title ?? ''}」进入服务计划。转介回执/提醒未被计为服务完成。`;
  }

  next.rev += 1;
  next.updatedAt = at;
  const entries = await buildEntries([
    {
      actorId: args.actor.id,
      actorName: args.actor.name,
      actorRole: 'supervisor',
      tabId: args.tabId,
      action,
      target: args.recordId,
      summary,
      caseId: args.caseId,
      rev: next.rev,
    },
  ]);

  const tx = db.transaction(['cases', 'history', 'audit'], 'readwrite');
  await tx.objectStore('cases').put(next);
  await tx.objectStore('history').put({
    hid: `${next.id}@${next.rev}`,
    caseId: next.id,
    rev: next.rev,
    at,
    actorName: args.actor.name,
    snapshot: structuredClone(next),
  });
  for (const e of entries) await tx.objectStore('audit').put(e);
  await tx.done;

  emit({ type: 'remote-changed', caseId: args.caseId, rev: next.rev, at, actorName: args.actor.name });
  emit({ type: 'audit-added' });

  const grants = await db.getAll('grants');
  return { ok: true, case: redactCase(next, args.actor, grants, Date.now()) };
}

// ---------- 脚本化“远端他人动作”（B 改约、家属取消等；不受本标签离线开关影响） ----------

export async function apiRemoteScript(args: {
  actor: { id: string; name: string; role?: AuditActorRole };
  tabId: string;
  caseId: string;
  action: string;
  target: string;
  summary: string;
  mutate: (c: CaseFile) => void;
}): Promise<CaseFile> {
  const db = await remoteDb();
  const stored = await db.get('cases', args.caseId);
  if (!stored) throw new Error('case missing');
  const next = structuredClone(stored);
  args.mutate(next);
  next.rev = stored.rev + 1;
  next.updatedAt = Date.now();

  const entries = await buildEntries([
    {
      actorId: args.actor.id,
      actorName: args.actor.name,
      actorRole: args.actor.role ?? 'social_worker',
      tabId: args.tabId,
      action: args.action,
      target: args.target,
      summary: args.summary,
      caseId: args.caseId,
      rev: next.rev,
    },
  ]);

  const tx = db.transaction(['cases', 'history', 'audit'], 'readwrite');
  await tx.objectStore('cases').put(next);
  await tx.objectStore('history').put({
    hid: `${next.id}@${next.rev}`,
    caseId: next.id,
    rev: next.rev,
    at: next.updatedAt,
    actorName: args.actor.name,
    snapshot: structuredClone(next),
  });
  for (const e of entries) await tx.objectStore('audit').put(e);
  await tx.done;

  emit({
    type: 'remote-changed',
    caseId: args.caseId,
    rev: next.rev,
    at: next.updatedAt,
    actorName: args.actor.name,
  });
  emit({ type: 'audit-added' });
  return next;
}

// ---------- 字段授权 ----------

export async function apiIssueGrant(args: {
  caseId: string;
  actor: Actor;
  tabId: string;
  ttlMs: number;
  ttlLabel: string;
  reason: string;
}): Promise<{ grant: FieldGrant; secret: NonNullable<CaseFile['client']['emergencyContact']> }> {
  const db = await remoteDb();
  const c = await db.get('cases', args.caseId);
  if (!c?.client.emergencyContact) throw new Error('no restricted value');
  const now = Date.now();
  const grant: FieldGrant = {
    id: uid('grant'),
    caseId: args.caseId,
    field: 'client.emergencyContact',
    granteeActorId: args.actor.id,
    granteeName: args.actor.name,
    reason: args.reason,
    issuedAt: now,
    expiresAt: now + args.ttlMs,
    ttlLabel: args.ttlLabel,
    revoked: false,
  };
  const entries = await buildEntries([
    {
      actorId: args.actor.id,
      actorName: args.actor.name,
      actorRole: args.actor.role,
      tabId: args.tabId,
      action: 'grant-issue',
      target: grant.id,
      summary: `家属授权 ${args.actor.name} 查看紧急联系人，有效期至 ${new Date(grant.expiresAt).toLocaleTimeString()}（${args.ttlLabel}）。缓存将绑定该到期时刻。`,
      caseId: args.caseId,
    },
  ]);
  const tx = db.transaction(['grants', 'audit'], 'readwrite');
  await tx.objectStore('grants').put(grant);
  for (const e of entries) await tx.objectStore('audit').put(e);
  await tx.done;
  emit({ type: 'grants-changed', caseId: args.caseId });
  emit({ type: 'audit-added' });
  return { grant, secret: c.client.emergencyContact };
}

export async function apiRevokeGrant(args: {
  grantId: string;
  actor: { id: string; name: string };
  tabId: string;
  reason: string;
}): Promise<FieldGrant | null> {
  const db = await remoteDb();
  const g = await db.get('grants', args.grantId);
  if (!g) return null;
  g.revoked = true;
  g.revokedAt = Date.now();
  g.revokeReason = args.reason;
  const entries = await buildEntries([
    {
      actorId: args.actor.id,
      actorName: args.actor.name,
      actorRole: 'system',
      tabId: args.tabId,
      action: 'grant-revoke',
      target: g.id,
      summary: `家属撤回紧急联系人查看授权：${args.reason}。所有在线标签页立即清除界面、剪贴板尝试清空并删除持久缓存。`,
      caseId: g.caseId,
    },
  ]);
  const tx = db.transaction(['grants', 'audit'], 'readwrite');
  await tx.objectStore('grants').put(g);
  for (const e of entries) await tx.objectStore('audit').put(e);
  await tx.done;
  emit({ type: 'grant-revoked', grantId: g.id, caseId: g.caseId, at: g.revokedAt });
  emit({ type: 'grants-changed', caseId: g.caseId });
  emit({ type: 'audit-added' });
  return g;
}

export async function resetRemote(): Promise<void> {
  const db = await remoteDb();
  await db.clear('cases');
  await db.clear('grants');
  await db.clear('audit');
  await db.clear('history');
  await db.clear('kv');
  seedPromise = null;
  await ensureSeeded(true);
  emit({ type: 'data-reset', at: Date.now() });
  emit({ type: 'audit-added' });
}
