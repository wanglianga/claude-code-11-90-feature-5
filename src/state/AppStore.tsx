import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type {
  Actor,
  AuditEntry,
  CaseFile,
  DraftEnvelope,
  FieldGrant,
  Granularity,
  OutboxOp,
  SensitiveCacheEntry,
  TabPresence,
  Violation,
  MergeAnalysis,
} from '../types';
import { ACCOUNTS, findActor } from '../config/accounts';
import { uid } from '../lib/ids';
import {
  addOp,
  allSecrets,
  clearAllLocalData,
  deleteDraft,
  deleteSecretsByGrant,
  listOps,
  loadDraft,
  localDb,
  purgeExpiredSecrets,
  putSecret,
  saveDraft,
} from '../db/localDb';
import { secretCacheKey } from '../db/schema';
import { remoteDb } from '../db/remoteDb';
import {
  apiCommitCase,
  apiGetCase,
  apiIssueGrant,
  apiListAudit,
  apiListCases,
  apiListGrants,
  apiRemoteScript,
  apiRevokeGrant,
  apiSupervisorDecision,
  ensureSeeded,
  rawGetCase,
  redactCase,
  resetRemote,
  setServerNetworkOnline,
  type AuditDesc,
} from '../mock/server';
import { emit, onMessage, type BusMessage } from '../mock/bus';
import { onSecretsExpired, requestPurgeNow, runMerge } from '../workers/client';
import {
  buildCandidate,
  rebaseDeferredOntoNewRemote,
  unresolvedItems,
} from '../lib/merge';
import type { CommitResult } from '../types';

// ---------------- 小工具 ----------------

function getTabId(): string {
  const KEY = 'casedesk.tabId';
  let t = sessionStorage.getItem(KEY);
  if (!t) {
    t = uid('tab');
    sessionStorage.setItem(KEY, t);
  }
  return t;
}

function readSessionActor(): Actor | null {
  const id = sessionStorage.getItem('casedesk.actorId');
  return ACCOUNTS.find((a) => a.id === id) ?? null;
}

function readOnlinePref(): boolean {
  return sessionStorage.getItem('casedesk.online') !== 'offline';
}

/** 草稿中绝不持久化紧急联系人真值；真值只进入绑定到期时刻的 sensitive store */
function stripSecret(c: CaseFile): CaseFile {
  const next = structuredClone(c);
  next.client.emergencyContact = null;
  return next;
}

export interface Toast {
  id: number;
  kind: 'info' | 'success' | 'error' | 'warn';
  text: string;
}

export interface PrepareResult {
  env: DraftEnvelope;
  current: CaseFile;
  analysis: MergeAnalysis;
}

interface AppContextValue {
  tabId: string;
  actor: Actor | null;
  now: number;
  onlinePref: boolean;
  online: boolean;
  browserOnline: boolean;
  cacheStale: boolean;
  cases: CaseFile[];
  audits: AuditEntry[];
  grants: FieldGrant[];
  drafts: Record<string, DraftEnvelope>;
  outbox: OutboxOp[];
  secretEntries: SensitiveCacheEntry[];
  presence: TabPresence[];
  toasts: Toast[];
  liveMessage: string;

  login: (account: string, password: string) => boolean;
  loginAs: (id: string) => void;
  logout: () => void;
  setOnlinePref: (v: boolean) => void;

  pushToast: (text: string, kind?: Toast['kind']) => void;
  announce: (msg: string) => void;

  refreshCases: () => Promise<void>;
  refreshAudits: () => Promise<void>;
  refreshGrants: () => Promise<void>;

  getDraft: (caseId: string) => DraftEnvelope | undefined;
  ensureDraft: (caseId: string) => Promise<DraftEnvelope | null>;
  /** 离散编辑：持久化草稿并记录一条 outbox 操作（含 baseRev） */
  patchDraft: (
    caseId: string,
    opLabel: string,
    fn: (value: CaseFile, env: DraftEnvelope) => void,
  ) => Promise<DraftEnvelope | null>;
  /** 文本输入过程中的静默持久化（不产生 outbox 条目） */
  patchDraftSilent: (
    caseId: string,
    fn: (value: CaseFile, env: DraftEnvelope) => void,
  ) => Promise<void>;
  setGranularity: (caseId: string, g: Granularity) => Promise<void>;
  discardDraft: (caseId: string) => Promise<void>;

  prepareAnalysis: (caseId: string) => Promise<
    | { kind: 'ok'; result: PrepareResult }
    | { kind: 'offline' }
    | { kind: 'no-draft' }
    | { kind: 'error'; message: string }
  >;
  quickSync: (caseId: string) => Promise<
    | { kind: 'synced'; rev: number }
    | { kind: 'conflict' }
    | { kind: 'guard'; violations: Violation[] }
    | { kind: 'offline' }
    | { kind: 'error'; message: string }
  >;
  commitAnalysis: (
    caseId: string,
    env: DraftEnvelope,
    analysis: MergeAnalysis,
    candidate: CaseFile,
    auditEvents?: AuditDesc[],
    /** 冲突合并后，候选已以服务器最新版本为底，需用该 rev 作为乐观锁基准重提 */
    expectedRev?: number,
  ) => Promise<
    | { kind: 'synced'; result: Extract<CommitResult, { ok: true }>; deferred: number }
    | { kind: 'conflict'; result: Extract<CommitResult, { ok: false; code: 'CONFLICT' }> }
    | { kind: 'guard'; violations: Violation[] }
    | { kind: 'offline' }
    | { kind: 'error'; message: string }
  >;

  supervisorDecision: (args: {
    caseId: string;
    recordId: string;
    decision: 'return' | 'confirm';
    note: string;
    ownerName?: string;
  }) => Promise<{ ok: boolean; message?: string }>;

  remoteScript: (args: Parameters<typeof apiRemoteScript>[0]) => Promise<void>;

  grantFor: (caseId: string) => FieldGrant | undefined;
  secretFor: (caseId: string) => SensitiveCacheEntry | undefined;
  requestGrant: (caseId: string, ttlMs: number, ttlLabel: string) => Promise<boolean>;
  revokeGrant: (grantId: string, reason: string) => Promise<void>;

  resetAllDemo: () => Promise<void>;
}

const Ctx = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp must be used within AppProvider');
  return v;
}

export function AppProvider({ children }: { children: ReactNode }) {
  const tabIdRef = useRef<string>(getTabId());
  const tabId = tabIdRef.current;

  const [actor, setActor] = useState<Actor | null>(() => readSessionActor());
  const actorRef = useRef<Actor | null>(actor);
  actorRef.current = actor;
  const [now, setNow] = useState(() => Date.now());
  const [onlinePref, setOnlinePrefState] = useState(readOnlinePref);
  const [browserOnline, setBrowserOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  );
  const [cacheStale, setCacheStale] = useState(false);

  const [cases, setCases] = useState<CaseFile[]>([]);
  const [audits, setAudits] = useState<AuditEntry[]>([]);
  const [grants, setGrants] = useState<FieldGrant[]>([]);
  const [drafts, setDrafts] = useState<Record<string, DraftEnvelope>>({});
  const [outbox, setOutbox] = useState<OutboxOp[]>([]);
  const [secretEntries, setSecretEntries] = useState<SensitiveCacheEntry[]>([]);
  const [presenceMap, setPresenceMap] = useState<Record<string, TabPresence>>({});
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [liveMessage, setLiveMessage] = useState('');
  const toastSeq = useRef(1);

  const online = onlinePref && browserOnline;

  // ---------- toast / aria live ----------
  const pushToast = useCallback((text: string, kind: Toast['kind'] = 'info') => {
    const id = toastSeq.current++;
    setToasts((t) => [...t.slice(-4), { id, kind, text }]);
    window.setTimeout(() => {
      setToasts((t) => t.filter((x) => x.id !== id));
    }, 5200);
  }, []);

  const announce = useCallback((msg: string) => setLiveMessage(`${Date.now()}: ${msg}`), []);

  // ---------- 数据刷新 ----------
  const refreshAudits = useCallback(async () => {
    try {
      setAudits(await apiListAudit());
    } catch {
      /* 审计台静默 */
    }
  }, []);

  const refreshGrants = useCallback(async () => {
    try {
      setGrants(await apiListGrants());
    } catch {
      /* ignore */
    }
  }, []);

  const refreshCases = useCallback(async () => {
    if (!actor) return;
    try {
      const list = await apiListCases(actor);
      setCases(list);
      setCacheStale(false);
    } catch (e) {
      if ((e as { code?: string })?.code === 'NETWORK') {
        // 断网刷新/重载时，用浏览器内“远端库”的本地副本作为只读缓存兜底
        const db = await remoteDb();
        const all = await db.getAll('cases');
        setCases(all.map((c) => redactCase(c, actor, grants, Date.now())));
        setCacheStale(true);
      }
    }
  }, [actor, grants]);

  const refreshOutbox = useCallback(async () => {
    setOutbox(await listOps());
  }, []);

  const reloadSecrets = useCallback(async () => {
    const all = await allSecrets();
    setSecretEntries(all);
  }, []);

  // ---------- 启动：种子、草稿、密钥、时钟 ----------
  useEffect(() => {
    setServerNetworkOnline(online);
  }, [online]);

  useEffect(() => {
    void (async () => {
      await ensureSeeded();
      await refreshAudits();
      await refreshGrants();
      await refreshOutbox();
      const db = await localDb();
      const recs = await db.getAllFromIndex('drafts', 'byTab', tabId);
      const map: Record<string, DraftEnvelope> = {};
      for (const r of recs) {
        const { key: _k, ...env } = r;
        map[env.caseId] = env;
      }
      setDrafts(map);
      await reloadSecrets();
      const expired = await purgeExpiredSecrets(Date.now());
      if (expired.length) {
        await reloadSecrets();
      }
      requestPurgeNow();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (actor) void refreshCases();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actor?.id]);

  // 秒级时钟
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  // 浏览器在线状态
  useEffect(() => {
    const on = () => setBrowserOnline(navigator.onLine);
    window.addEventListener('online', on);
    window.addEventListener('offline', on);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', on);
    };
  }, []);

  // 到期清扫（主线程兜底 + Worker 后台清扫回调）
  useEffect(() => {
    const t = window.setInterval(async () => {
      const expired = await purgeExpiredSecrets(Date.now());
      if (expired.length) {
        await reloadSecrets();
        pushToast(`授权已到期：已遮蔽并从持久缓存清除 ${expired.length} 项紧急联系人`, 'warn');
        announce('授权到期，紧急联系人已从界面和本地缓存清除');
      }
    }, 5000);
    const off = onSecretsExpired(async (entries) => {
      await reloadSecrets();
      pushToast(`WebWorker 检测到授权到期，已清除 ${entries.length} 项敏感缓存`, 'warn');
      announce('授权到期，后台 Worker 已清除敏感缓存');
    });
    return () => {
      window.clearInterval(t);
      off();
    };
  }, [announce, pushToast, reloadSecrets]);

  // ---------- 撤权本地清除（界面 + IDB + 剪贴板） ----------
  const purgeGrantEverywhere = useCallback(
    async (grantId: string, silent = false) => {
      const removed = await deleteSecretsByGrant(grantId);
      await reloadSecrets();
      // 尽力清空剪贴板（浏览器只允许在部分时机写入；失败时明确提示用户手动处理）
      let clipboardCleared = false;
      try {
        await navigator.clipboard.writeText('');
        clipboardCleared = true;
      } catch {
        clipboardCleared = false;
      }
      window.getSelection?.()?.removeAllRanges?.();
      if (!silent) {
        pushToast(
          `家属已撤权：界面已遮蔽、持久缓存删除 ${removed.length} 项，${
            clipboardCleared ? '剪贴板已尝试清空。' : '剪贴板无法远程清空，若曾复制请手动删除。'
          }`,
          'warn',
        );
        announce('紧急联系人授权被撤回，已从界面和持久缓存删除');
      }
    },
    [announce, pushToast, reloadSecrets],
  );

  // ---------- BroadcastChannel ----------
  useEffect(() => {
    const off = onMessage((msg: BusMessage) => {
      if (msg.type === 'remote-changed') {
        void refreshCases();
        void refreshAudits();
        if (msg.actorName && !msg.actorName.includes('系统')) {
          // 温和提示，避免本标签自己的提交重复打扰：自己提交时也会收到总线（BroadcastChannel 不回送本上下文，故这里都是他人）
          pushToast(`收到另一标签页的远端更新：${msg.caseId} → rev ${msg.rev}（${msg.actorName}）`, 'info');
        }
      } else if (msg.type === 'audit-added') {
        void refreshAudits();
      } else if (msg.type === 'grants-changed') {
        void refreshGrants();
      } else if (msg.type === 'grant-revoked') {
        void refreshGrants();
        void purgeGrantEverywhere(msg.grantId);
      } else if (msg.type === 'data-reset') {
        void (async () => {
          await clearAllLocalData();
          setDrafts({});
          setOutbox([]);
          setSecretEntries([]);
          await Promise.all([refreshCases(), refreshAudits(), refreshGrants(), refreshOutbox()]);
          pushToast('模拟数据已重置为初始 v7 样例', 'success');
        })();
      } else if (msg.type === 'presence') {
        setPresenceMap((m) => ({ ...m, [msg.presence.tabId]: msg.presence }));
      } else if (msg.type === 'presence-bye') {
        setPresenceMap((m) => {
          const n = { ...m };
          delete n[msg.tabId];
          return n;
        });
      }
    });
    return off;
  }, [purgeGrantEverywhere, pushToast, refreshAudits, refreshCases, refreshGrants, refreshOutbox]);

  // ---------- presence 心跳 ----------
  useEffect(() => {
    const beat = () =>
      emit({
        type: 'presence',
        presence: { tabId, actorId: actor?.id, actorName: actor?.name, at: Date.now() },
      });
    beat();
    const t = window.setInterval(beat, 2000);
    const bye = () => emit({ type: 'presence-bye', tabId });
    window.addEventListener('beforeunload', bye);
    return () => {
      window.clearInterval(t);
      window.removeEventListener('beforeunload', bye);
      bye();
    };
  }, [actor, tabId]);

  // 清理过期 presence
  useEffect(() => {
    const t = window.setInterval(() => {
      setPresenceMap((m) => {
        const nowTs = Date.now();
        let changed = false;
        const n: Record<string, TabPresence> = {};
        for (const [k, v] of Object.entries(m)) {
          if (nowTs - v.at < 7000) n[k] = v;
          else changed = true;
        }
        return changed ? n : m;
      });
    }, 3000);
    return () => window.clearInterval(t);
  }, []);

  // ---------------- 会话 ----------------
  const login = useCallback((account: string, password: string) => {
    const a = findActor(account, password);
    if (!a) return false;
    sessionStorage.setItem('casedesk.actorId', a.id);
    setActor(a);
    void allSecrets().then(setSecretEntries);
    return true;
  }, []);

  const loginAs = useCallback((id: string) => {
    const a = ACCOUNTS.find((x) => x.id === id);
    if (!a) return;
    sessionStorage.setItem('casedesk.actorId', a.id);
    setActor(a);
  }, []);

  const logout = useCallback(() => {
    sessionStorage.removeItem('casedesk.actorId');
    setActor(null);
  }, []);

  const setOnlinePref = useCallback(
    (v: boolean) => {
      sessionStorage.setItem('casedesk.online', v ? 'online' : 'offline');
      setOnlinePrefState(v);
      setServerNetworkOnline(v && navigator.onLine);
      pushToast(v ? '已恢复网络：可核对并同步待发修改' : '已切换为离线（模拟地下室）：编辑会保存在本机', v ? 'success' : 'warn');
      announce(v ? '网络已恢复' : '已进入离线模式，编辑将保存在本地待同步');
    },
    [announce, pushToast],
  );

  // ---------------- 草稿 ----------------
  const getDraft = useCallback((caseId: string) => drafts[caseId], [drafts]);

  const ensureDraft = useCallback(
    async (caseId: string): Promise<DraftEnvelope | null> => {
      const existing = drafts[caseId] ?? (await loadDraft(tabId, caseId));
      if (existing) {
        if (!drafts[caseId]) setDrafts((m) => ({ ...m, [caseId]: existing }));
        return existing;
      }
      let remote: CaseFile | undefined = cases.find((c) => c.id === caseId);
      if (!remote) {
        try {
          remote = await apiGetCase(caseId, actor);
        } catch {
          remote = await rawGetCase(caseId);
          if (remote && actor) {
            const gs = await apiListGrants();
            remote = redactCase(remote, actor, gs, Date.now());
          }
        }
      }
      if (!remote) return null;
      const clean = stripSecret(remote);
      const env: DraftEnvelope = {
        caseId,
        baseRev: remote.rev,
        base: structuredClone(clean),
        value: structuredClone(clean),
        granularity: 'field',
        updatedAt: Date.now(),
        tabId,
      };
      await saveDraft(env);
      setDrafts((m) => ({ ...m, [caseId]: env }));
      return env;
    },
    [actor, cases, drafts, tabId],
  );

  const patchDraftSilent = useCallback(
    async (caseId: string, fn: (value: CaseFile, env: DraftEnvelope) => void) => {
      const env = await ensureDraft(caseId);
      if (!env) return;
      fn(env.value, env);
      env.updatedAt = Date.now();
      await saveDraft(env);
      setDrafts((m) => ({ ...m, [caseId]: { ...env } }));
    },
    [ensureDraft],
  );

  const patchDraft = useCallback(
    async (caseId: string, opLabel: string, fn: (value: CaseFile, env: DraftEnvelope) => void) => {
      const env = await ensureDraft(caseId);
      if (!env) return null;
      fn(env.value, env);
      env.updatedAt = Date.now();
      await saveDraft(env);
      setDrafts((m) => ({ ...m, [caseId]: { ...env } }));

      const op: OutboxOp = {
        id: uid('op'),
        caseId,
        tabId,
        actorId: actorRef.current?.id ?? 'anonymous',
        label: opLabel,
        at: Date.now(),
        baseRev: env.baseRev,
        status: 'queued',
      };
      await addOp(op);
      await refreshOutbox();
      return env;
    },
    [actor?.id, ensureDraft, refreshOutbox, tabId],
  );

  const setGranularity = useCallback(
    async (caseId: string, g: Granularity) => {
      await patchDraftSilent(caseId, (_v, env) => {
        env.granularity = g;
      });
    },
    [patchDraftSilent],
  );

  const discardDraft = useCallback(
    async (caseId: string) => {
      await deleteDraft(tabId, caseId);
      setDrafts((m) => {
        const n = { ...m };
        delete n[caseId];
        return n;
      });
      pushToast('已丢弃本机草稿，重新以远端版本为基线', 'info');
    },
    [pushToast, tabId],
  );

  // ---------------- 三方分析 / 同步 ----------------
  const prepareAnalysis = useCallback(
    async (caseId: string) => {
      let env = drafts[caseId] ?? (await loadDraft(tabId, caseId));
      if (!env) return { kind: 'no-draft' as const };
      if (!online) return { kind: 'offline' as const };

      let current: CaseFile;
      try {
        current = await apiGetCase(caseId, actor);
      } catch (e) {
        if ((e as { code?: string })?.code === 'NETWORK') return { kind: 'offline' as const };
        return { kind: 'error' as const, message: (e as Error).message };
      }
      const cleanCurrent = stripSecret(current);
      try {
        const analysis = await runMerge(
          caseId,
          env.base,
          env.value,
          cleanCurrent,
          env.granularity,
        );
        return { kind: 'ok' as const, result: { env, current: cleanCurrent, analysis } };
      } catch (e) {
        return { kind: 'error' as const, message: (e as Error).message };
      }
    },
    [actor, drafts, online, tabId],
  );

  // commitAnalysis 在下方定义；用 ref 打破声明顺序
  const commitRef = useRef<
    | ((
        caseId: string,
        env: DraftEnvelope,
        analysis: MergeAnalysis,
        candidate: CaseFile,
        auditEvents?: AuditDesc[],
        expectedRev?: number,
      ) => Promise<unknown>)
    | null
  >(null);

  const quickSync = useCallback(
    async (caseId: string) => {
      const prep = await prepareAnalysis(caseId);
      if (prep.kind === 'offline') return { kind: 'offline' as const };
      if (prep.kind === 'no-draft') return { kind: 'error' as const, message: '没有待同步草稿' };
      if (prep.kind === 'error') return { kind: 'error' as const, message: prep.message };

      const { env, current, analysis } = prep.result;
      if (current.rev !== env.baseRev || unresolvedItems(analysis).length > 0) {
        return { kind: 'conflict' as const };
      }
      const candidate = buildCandidate(env.value, current, analysis);
      const res = (await commitRef.current?.(caseId, env, analysis, candidate)) as
        | { kind: 'synced'; result: { case: { rev: number } } }
        | { kind: 'guard'; violations: Violation[] }
        | { kind: 'conflict' }
        | { kind: 'offline' }
        | { kind: 'error'; message: string }
        | undefined;
      if (!res) return { kind: 'error' as const, message: '同步模块未就绪' };
      if (res.kind === 'synced') return { kind: 'synced' as const, rev: res.result.case.rev };
      if (res.kind === 'guard') return { kind: 'guard' as const, violations: res.violations };
      if (res.kind === 'conflict') return { kind: 'conflict' as const };
      if (res.kind === 'offline') return { kind: 'offline' as const };
      return { kind: 'error' as const, message: res.kind === 'error' ? res.message : '同步失败' };
    },
    [prepareAnalysis],
  );

  const commitAnalysis = useCallback(
    async (
      caseId: string,
      env: DraftEnvelope,
      analysis: MergeAnalysis,
      candidate: CaseFile,
      auditEvents?: AuditDesc[],
      expectedRev?: number,
    ) => {
      if (!online) return { kind: 'offline' as const };
      if (!actor) return { kind: 'error' as const, message: '未登录' };

      setOutbox((ops) => ops.map((o) => (o.caseId === caseId && o.status === 'queued' ? { ...o, status: 'syncing' as const } : o)));

      let result: CommitResult;
      try {
        result = await apiCommitCase({
          actor,
          tabId,
          caseId,
          baseRev: expectedRev ?? env.baseRev,
          candidate,
          auditEvents,
        });
      } catch (e) {
        setOutbox((ops) => ops.map((o) => (o.caseId === caseId && o.status === 'syncing' ? { ...o, status: 'queued' as const } : o)));
        if ((e as { code?: string })?.code === 'NETWORK') return { kind: 'offline' as const };
        return { kind: 'error' as const, message: (e as Error).message };
      }

      if (!result.ok && result.code === 'CONFLICT') {
        await refreshCases();
        setOutbox((ops) => ops.map((o) => (o.caseId === caseId && o.status === 'syncing' ? { ...o, status: 'queued' as const } : o)));
        return { kind: 'conflict' as const, result };
      }
      if (!result.ok && result.code === 'GUARD') {
        setOutbox((ops) => ops.map((o) => (o.caseId === caseId && o.status === 'syncing' ? { ...o, status: 'blocked' as const } : o)));
        await refreshOutbox();
        return { kind: 'guard' as const, violations: result.violations };
      }
      if (!result.ok) {
        return { kind: 'error' as const, message: '提交被拒绝' };
      }

      // 成功：处理暂缓项的 rebase
      const deferredCount = analysis.items.filter((i) => i.decision === 'defer').length;
      const rebased = rebaseDeferredOntoNewRemote(env.value, result.case, analysis);
      if (rebased) {
        const newEnv: DraftEnvelope = {
          ...env,
          baseRev: result.case.rev,
          base: structuredClone(result.case),
          value: rebased,
          updatedAt: Date.now(),
        };
        await saveDraft(newEnv);
        setDrafts((m) => ({ ...m, [caseId]: newEnv }));
        await addOp({
          id: uid('op'),
          caseId,
          tabId,
          actorId: actor.id,
          label: `暂缓 ${deferredCount} 个裁决项，已 rebase 到 rev ${result.case.rev}`,
          at: Date.now(),
          baseRev: result.case.rev,
          status: 'queued',
        });
      } else {
        await deleteDraft(tabId, caseId);
        setDrafts((m) => {
          const n = { ...m };
          delete n[caseId];
          return n;
        });
      }
      setOutbox((ops) =>
        ops.map((o) =>
          o.caseId === caseId && o.status === 'syncing'
            ? { ...o, status: 'synced' as const, syncedRev: result.case.rev }
            : o,
        ),
      );
      await refreshOutbox();
      await Promise.all([refreshCases(), refreshAudits()]);
      return { kind: 'synced' as const, result, deferred: deferredCount };
    },
    [actor, online, refreshAudits, refreshCases, refreshOutbox, tabId],
  );

  commitRef.current = commitAnalysis;

  // ---------------- 主管 / 远端脚本 ----------------
  const supervisorDecision = useCallback(
    async (args: {
      caseId: string;
      recordId: string;
      decision: 'return' | 'confirm';
      note: string;
      ownerName?: string;
    }) => {
      if (!actor) return { ok: false, message: '未登录' };
      if (!online) return { ok: false, message: '当前离线，主管动作需在线执行' };
      const r = await apiSupervisorDecision({ actor, tabId, ...args });
      if (r.ok) {
        await Promise.all([refreshCases(), refreshAudits()]);
        pushToast(args.decision === 'return' ? '已退回：旧草稿将被退回锁拦截' : '已确认：记录进入服务计划', 'success');
        announce(args.decision === 'return' ? '主管已退回该服务目标' : '主管已确认，进入服务计划');
      }
      return r;
    },
    [actor, online, refreshAudits, refreshCases, announce, pushToast, tabId],
  );

  const remoteScript = useCallback(
    async (args: Parameters<typeof apiRemoteScript>[0]) => {
      await apiRemoteScript(args);
      await Promise.all([refreshCases(), refreshAudits()]);
    },
    [refreshAudits, refreshCases],
  );

  // ---------------- 授权 / 敏感缓存 ----------------
  const grantFor = useCallback(
    (caseId: string) =>
      grants.find(
        (g) =>
          g.caseId === caseId &&
          g.granteeActorId === actor?.id &&
          !g.revoked &&
          g.expiresAt > now,
      ) ??
      // 也返回失效凭据，便于 UI 显示“已到期/已撤回”状态
      grants
        .filter((g) => g.caseId === caseId && g.granteeActorId === actor?.id)
        .sort((a, b) => b.issuedAt - a.issuedAt)[0],
    [grants, actor?.id, now],
  );

  const secretFor = useCallback(
    (caseId: string) => secretEntries.find((s) => s.cacheKey === secretCacheKey(actor?.id ?? '', caseId)),
    [secretEntries, actor?.id],
  );

  const requestGrant = useCallback(
    async (caseId: string, ttlMs: number, ttlLabel: string) => {
      if (!actor) return false;
      try {
        const { grant, secret } = await apiIssueGrant({
          caseId,
          actor,
          tabId,
          ttlMs,
          ttlLabel,
          reason: '社工现场核实紧急联系人与用药联络需要（模拟家属口头授权）',
        });
        const entry: SensitiveCacheEntry = {
          cacheKey: secretCacheKey(actor.id, caseId),
          caseId,
          field: 'client.emergencyContact',
          value: secret,
          grantId: grant.id,
          expiresAt: grant.expiresAt,
          cachedAt: Date.now(),
        };
        await putSecret(entry);
        await reloadSecrets();
        await refreshGrants();
        pushToast(`已获授权，紧急联系人将在 ${ttlLabel} 后到期并自动从本机缓存清除`, 'success');
        return true;
      } catch (e) {
        pushToast(`授权失败：${(e as Error).message}`, 'error');
        return false;
      }
    },
    [actor, pushToast, refreshGrants, reloadSecrets, tabId],
  );

  const revokeGrant = useCallback(
    async (grantId: string, reason: string) => {
      await apiRevokeGrant({
        grantId,
        actor: { id: actor?.id ?? 'family', name: '家属（模拟撤权）' },
        tabId,
        reason,
      });
      await refreshGrants();
      await purgeGrantEverywhere(grantId);
    },
    [actor?.id, purgeGrantEverywhere, refreshGrants, tabId],
  );

  // ---------------- 重置 ----------------
  const resetAllDemo = useCallback(async () => {
    await resetRemote();
    await clearAllLocalData();
    setDrafts({});
    setOutbox([]);
    setSecretEntries([]);
    await Promise.all([refreshCases(), refreshAudits(), refreshGrants(), refreshOutbox()]);
    pushToast('已重置：恢复到 2026-11-25 9:00 的 rev 7 标准样例', 'success');
  }, [pushToast, refreshAudits, refreshCases, refreshGrants, refreshOutbox]);

  const presence = useMemo(() => Object.values(presenceMap), [presenceMap]);

  const value: AppContextValue = {
    tabId,
    actor,
    now,
    onlinePref,
    online,
    browserOnline,
    cacheStale,
    cases,
    audits,
    grants,
    drafts,
    outbox,
    secretEntries,
    presence,
    toasts,
    liveMessage,
    login,
    loginAs,
    logout,
    setOnlinePref,
    pushToast,
    announce,
    refreshCases,
    refreshAudits,
    refreshGrants,
    getDraft,
    ensureDraft,
    patchDraft,
    patchDraftSilent,
    setGranularity,
    discardDraft,
    prepareAnalysis,
    quickSync,
    commitAnalysis,
    supervisorDecision,
    remoteScript,
    grantFor,
    secretFor,
    requestGrant,
    revokeGrant,
    resetAllDemo,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
