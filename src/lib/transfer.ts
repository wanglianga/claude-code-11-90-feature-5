// ============================================================
// 迁居移交：唯一跟进责任
// ------------------------------------------------------------
// 纯函数实现（客户端 UI、模拟服务端与测试共用）：
//  - 两种合规移交方式：原机构续办 / 迁入日转给新机构
//  - 每项未结转介在任何时刻只有一个可发起客户/服务方联系的机构
//  - 服务方回执幂等：重复送达同一退回回执不生成第二次催办
//  - 旧机构离线迟到同步：只入时间线并标记，不夺回责任、不结案
//  - 交接不改变已完成家访的历史归属
// 所有机构、编号、客户资料均为虚构，仅用于浏览器内演示。
// ============================================================

import type {
  CaseFile,
  CaseTransfer,
  FollowUpTask,
  ProviderDecision,
  ProviderReturn,
  Referral,
  ReferralFollowUp,
  ReferralTimelineEvent,
  TransferPolicy,
  Violation,
  VisitRecord,
} from '../types';
import { uid } from './ids';

// ---------- 组织与摘要范围 ----------

export const DEFAULT_SCOPES = ['转介摘要', '家访历史'];

/** 当前账号所属机构；未标注 orgId 的账号默认属于原机构（保持既有样例可用） */
export function actorOrgId(actor: { id: string; orgId?: string } | null | undefined, t?: CaseTransfer): string | undefined {
  if (!actor) return undefined;
  return actor.orgId ?? t?.originOrg?.id;
}

/** 依据授权范围裁剪跨机构摘要：双方都只能看到被授权的必要摘要 */
export function summaryVisibleTo(orgScopes: Record<string, string[]> | undefined, orgId: string | undefined): boolean {
  if (!orgId) return false;
  return (orgScopes?.[orgId] ?? []).includes('转介摘要');
}

/** 某机构能否读取完整客户联系记录：同时获得“转介摘要”与“家访历史”授权 */
export function canReadClientContact(orgScopes: Record<string, string[]> | undefined, orgId: string | undefined): boolean {
  if (!orgId) return false;
  const scopes = orgScopes?.[orgId] ?? [];
  return scopes.includes('转介摘要') && scopes.includes('家访历史');
}

/**
 * 按授权范围裁剪单条时间线事件（供跨机构展示）：
 * - 服务方回执/退回/责任归属：有“转介摘要”即可见；
 * - 客户联系（含迟到同步）：仅同时有“家访历史”的机构可读全文，其余显示“已记录、内容未授权”。
 */
export function visibleTimelineEvent(
  ev: ReferralTimelineEvent,
  transfer: CaseTransfer | undefined,
  orgId: string | undefined,
): ReferralTimelineEvent {
  if (!transfer || !orgId) return { ...ev, summary: '（未识别机构，仅可确认存在该事件）' };
  if (ev.kind === 'client_contact' || ev.kind === 'late_sync') {
    if (!canReadClientContact(transfer.orgScopes, orgId)) {
      return { ...ev, summary: '已记录一条客户联系（内容未在贵机构授权范围内，仅确认存在）。' };
    }
  }
  return ev;
}

export interface RedactedReferralSummary {
  id: string;
  applicationNo: string;
  service: string;
  summary: string;
  status: Referral['status'];
  visible: boolean;
}

/** 返回某机构可读取的必要摘要（不泄露完整客户联系记录） */
export function referralSummariesFor(
  transfer: CaseTransfer | undefined,
  referral: Referral,
  orgId: string,
): RedactedReferralSummary {
  const visible = summaryVisibleTo(transfer?.orgScopes, orgId);
  const contactCount = (referral.timeline ?? []).filter(
    (e) => e.kind === 'client_contact' || e.kind === 'late_sync',
  ).length;
  return {
    id: referral.id,
    applicationNo: referral.applicationNo ?? '—',
    service: referral.service,
    summary: visible
      ? `${referral.shareSummary ?? referral.reason}（时间线含 ${contactCount} 条客户联系记录，均已归并同一转介时间线）`
      : '仅可确认该转介存在；详细摘要需在授权范围内查看。',
    status: referral.status,
    visible,
  };
}

// ---------- 归属读取 ----------

export function findFollowUp(t: CaseTransfer | undefined, referralId: string): ReferralFollowUp | undefined {
  return t?.followUps.find((f) => f.referralId === referralId);
}

/** 已完成家访的历史归属：优先取冻结表，其次取记录自身快照 */
export function visitAttribution(c: CaseFile, visit: VisitRecord): string | undefined {
  return visit.attributedOrgId ?? c.transfer?.historyAttribution?.[visit.id];
}

export function isCompletedVisit(v: VisitRecord): boolean {
  return v.fulfillment === 'completed' && v.status !== 'draft';
}

// ---------- 催办/补齐任务（幂等） ----------

/** 同一退回回执只应产生一条催办/补齐任务；幂等键由转介 + 回执编号构成 */
export function returnDedupeKey(referralId: string, referenceNo: string): string {
  return `return:${referralId}:${referenceNo}`;
}

export interface ReceiptResult {
  caseFile: CaseFile;
  /** 与已有任务去重后真正需要新增的任务（重复送达时为空） */
  newTasks: FollowUpTask[];
  /** 因重复送达而被跳过的任务数 */
  skipped: number;
  duplicate: boolean;
}

/**
 * 登记服务方回执（接收 / 退回 / 明确拒绝）到案卷中的转介。
 * - 以 dedupeKey 幂等：重复送达同一退回回执不新增时间线重复项、不新增任务；
 * - 退回：生成一条“补齐材料并催办”任务，负责人=当前唯一责任机构；
 * - 接收：责任终止（nextAction=none），补齐任务置为 superseded；
 * - 拒绝：责任终止（服务方明确拒绝，催办结束）。
 * 本函数是纯函数：返回新案卷与本次实际新增的任务，不改入参。
 */
export function applyProviderReceipt(args: {
  caseFile: CaseFile;
  referralId: string;
  decision: ProviderDecision;
  referenceNo: string;
  receivedAt: string;
  reason?: string;
  missingMaterials?: string[];
  supplementDue?: string;
  actorName: string;
  /** 送达机构：通常是服务方 */
  orgId?: string;
  /** 迟到送达（例如离线补传） */
  lateSync?: boolean;
}): ReceiptResult {
  const c: CaseFile = structuredClone(args.caseFile);
  const referral = c.referrals.find((r) => r.id === args.referralId);
  if (!referral) throw new Error(`referral not found: ${args.referralId}`);
  const t = c.transfer;
  referral.timeline = referral.timeline ?? [];

  const dedupeKey = returnDedupeKey(args.referralId, args.referenceNo);
  const already = referral.timeline.some((e) => e.dedupeKey === dedupeKey);
  const owner = findFollowUp(t, args.referralId);
  const ownerOrgId = owner?.ownerOrgId ?? t?.originOrg?.id ?? 'origin';
  const ownerName = owner?.ownerName ?? t?.originOrg?.name ?? '原机构';
  const orgId = args.orgId ?? c.transfer?.originOrg?.id ?? 'provider';

  const newTasks: FollowUpTask[] = [];
  let skipped = 0;

  if (already) {
    // 重复送达：只追加一条去重痕迹，不重复生成任务
    skipped = 1;
    referral.timeline.push({
      id: uid('evt'),
      referralId: referral.id,
      at: args.receivedAt,
      recordedAt: new Date().toISOString(),
      orgId,
      actorName: '模拟服务方接口',
      kind: 'duplicate_receipt',
      summary: `重复送达的服务方回执 ${args.referenceNo}，已按幂等键忽略，不生成第二次催办。`,
      dedupeKey: `${dedupeKey}:dup:${uid('d')}`,
    });
    return { caseFile: c, newTasks, skipped, duplicate: true };
  }

  // 写入回执本身
  referral.providerDecision = args.decision;
  if (args.decision === 'accepted') {
    referral.status = '已接收回执';
    referral.receiptNo = args.referenceNo;
    referral.receiptAt = args.receivedAt;
    referral.providerAcceptedAt = args.receivedAt;
    referral.providerReturn = undefined;
    referral.timeline.push({
      id: uid('evt'),
      referralId: referral.id,
      at: args.receivedAt,
      recordedAt: new Date().toISOString(),
      orgId,
      actorName: args.actorName,
      kind: 'provider_receipt',
      summary: `服务方正式接收转介（回执 ${args.referenceNo}）。跟进责任到此终止，无新增催办。`,
      dedupeKey,
    });
    if (t) {
      for (const task of t.tasks) {
        if (task.referralId === referral.id && task.status === 'open') {
          task.status = 'superseded';
          task.note += '（服务方已接收，催办任务关闭）';
        }
      }
      const fu = findFollowUp(t, referral.id);
      if (fu) {
        fu.nextAction = 'none';
        fu.nextContactNote = `服务方已接收（回执 ${args.referenceNo}），无需继续催办。`;
      }
    }
    return { caseFile: c, newTasks, skipped, duplicate: false };
  }
  if (args.decision === 'declined') {
    referral.status = '已办结';
    referral.receiptNo = args.referenceNo;
    referral.receiptAt = args.receivedAt;
    referral.providerDeclineReason = args.reason ?? '服务方明确拒绝';
    referral.timeline.push({
      id: uid('evt'),
      referralId: referral.id,
      at: args.receivedAt,
      recordedAt: new Date().toISOString(),
      orgId,
      actorName: args.actorName,
      kind: 'provider_receipt',
      summary: `服务方明确拒绝（回执 ${args.referenceNo}）：${args.reason ?? '原因未注明'}。拒绝即结束催办，可结案。`,
      dedupeKey,
    });
    if (t) {
      for (const task of t.tasks) {
        if (task.referralId === referral.id && task.status === 'open') task.status = 'superseded';
      }
      const fu = findFollowUp(t, referral.id);
      if (fu) {
        fu.nextAction = 'none';
        fu.nextContactNote = `服务方明确拒绝（回执 ${args.referenceNo}），催办结束。`;
      }
    }
    return { caseFile: c, newTasks, skipped, duplicate: false };
  }

  // 退回补件
  const providerReturn: ProviderReturn = {
    referenceNo: args.referenceNo,
    receivedAt: args.receivedAt,
    reason: args.reason ?? '材料不齐',
    missingMaterials: args.missingMaterials?.length ? args.missingMaterials : ['行动能力评估'],
    supplementDue: args.supplementDue ?? defaultSupplementDue(args.receivedAt),
  };
  referral.status = '已退回补件';
  referral.receiptNo = args.referenceNo;
  referral.receiptAt = args.receivedAt;
  referral.providerReturn = providerReturn;
  referral.followUpDue = providerReturn.supplementDue;
  referral.timeline.push({
    id: uid('evt'),
    referralId: referral.id,
    at: args.receivedAt,
    recordedAt: new Date().toISOString(),
    orgId,
    actorName: args.actorName,
    kind: 'provider_return',
    summary: `服务方退回（回执 ${args.referenceNo}）：缺 ${providerReturn.missingMaterials.join('、')}，须于 ${providerReturn.supplementDue} 前补齐。责任机构：${ownerName}。`,
    dedupeKey,
  });

  // 唯一一条补齐/催办任务；dueAt 取补齐截止日（同时作为下一次联系期限）
  const task: FollowUpTask = {
    id: uid('task'),
    referralId: referral.id,
    kind: 'supplement_due',
    ownerOrgId,
    ownerName,
    dueAt: providerReturn.supplementDue,
    status: 'open',
    createdAt: args.receivedAt,
    note: `补齐 ${providerReturn.missingMaterials.join('、')} 并联系服务方确认（回执 ${args.referenceNo}）。`,
    dedupeKey,
  };
  if (t) {
    const dup = t.tasks.some((x) => x.dedupeKey === dedupeKey);
    if (!dup) {
      t.tasks.push(task);
      newTasks.push(task);
    } else {
      skipped += 1;
    }
    const fu = findFollowUp(t, referral.id);
    if (fu) {
      fu.nextAction = 'contact_provider';
      fu.nextContactDue = providerReturn.supplementDue;
      fu.nextContactNote = `补齐 ${providerReturn.missingMaterials.join('、')} 后联系服务方确认接收（回执 ${args.referenceNo}）。`;
    }
  }
  return { caseFile: c, newTasks, skipped, duplicate: false };
}

function defaultSupplementDue(receivedAt: string): string {
  const d = new Date(receivedAt);
  if (Number.isNaN(d.getTime())) return receivedAt.slice(0, 10);
  d.setDate(d.getDate() + 3);
  return d.toISOString().slice(0, 10);
}

// ---------- 唯一责任：派生与转换 ----------

export interface FollowUpPlan {
  referralId: string;
  policy: TransferPolicy;
  ownerOrgId: string;
  ownerName: string;
  nextAction: ReferralFollowUp['nextAction'];
  nextContactDue: string;
  nextContactNote: string;
  clientNotified: string;
  clientNotifiedBy: string;
  clientNotifiedAt: string;
}

/**
 * 按移交方式生成每项未结束转介的唯一跟进责任。
 * - origin_keeps：负责人=原机构社工，熟悉情况的社工继续沟通；下一次联系最迟不晚于补齐截止日。
 * - transfer_on_move_in：迁入日把责任交给新机构，客户通知改由新机构社工接续；
 *   原机构此后不得再发起客户/服务方联系，但仍可读取历史。
 * 已接收回执/已明确拒绝/已办结的转介不再产生跟进责任。
 */
export function buildFollowUpPlan(args: {
  c: CaseFile;
  policy: TransferPolicy;
  originWorker: { id: string; name: string; orgId: string };
  receivingWorker: { id: string; name: string; orgId: string };
  clientNotified: string;
  clientNotifiedAt: string;
  /** 已有的责任人姓名覆盖（例如按机构登记的责任人） */
  ownerNameOverride?: string;
}): FollowUpPlan[] {
  const { c, policy } = args;
  const t = c.transfer;
  if (!t) return [];
  const originOrg = t.originOrg;
  const receivingOrg = t.receivingOrg;
  const plans: FollowUpPlan[] = [];
  for (const r of c.referrals) {
    if (r.status === '已接收回执' || r.status === '已办结') continue;
    const ownerIsOrigin = policy === 'origin_keeps';
    const ownerOrgId = ownerIsOrigin ? originOrg.id : receivingOrg.id;
    const notifier = ownerIsOrigin ? originOrg.name : receivingOrg.name;
    const defaultOwnerName = ownerIsOrigin ? args.originWorker.name : args.receivingWorker.name;
    const ownerName = args.ownerNameOverride ?? defaultOwnerName;

    let nextAction: ReferralFollowUp['nextAction'] = 'contact_provider';
    let nextContactDue = r.followUpDue ?? t.moveInDate;
    let nextContactNote = `向服务方确认转介进展并催办回执（送件时要求 ${nextContactDue} 前完成补充）。`;
    if (r.providerDecision === 'returned' && r.providerReturn) {
      nextAction = 'contact_provider';
      nextContactDue = r.providerReturn.supplementDue;
      nextContactNote = `补齐 ${r.providerReturn.missingMaterials.join('、')} 后联系服务方确认（回执 ${r.providerReturn.referenceNo}）。`;
    }

    const notified = ownerIsOrigin
      ? args.clientNotified
      : `由${receivingOrg.name}社工${args.receivingWorker.name}接续说明：${args.clientNotified} 后续材料与联系由新机构负责，原机构不再重复联系。`;

    plans.push({
      referralId: r.id,
      policy,
      ownerOrgId,
      ownerName,
      nextAction,
      nextContactDue,
      nextContactNote,
      clientNotified: notified,
      clientNotifiedBy: notifier,
      clientNotifiedAt: args.clientNotifiedAt,
    });
  }
  return plans;
}

/** 把计划写入案卷：生成 followUps 与随附任务；保留历史冻结归属。会做一次结构幂等（同 referralId 覆盖） */
export function applyFollowUpPlan(c: CaseFile, plans: FollowUpPlan[]): CaseFile {
  const next: CaseFile = structuredClone(c);
  const t = next.transfer;
  if (!t) return next;
  const nowIso = new Date().toISOString();
  const existing = new Map(t.followUps.map((f) => [f.referralId, f]));
  t.followUps = plans.map((p) => {
    const prev = existing.get(p.referralId);
    const moved = prev && prev.ownerOrgId !== p.ownerOrgId ? prev.movedCount + 1 : prev?.movedCount ?? 0;
    // 重新选择同一方式时保留首次确定的责任人与告知快照，只更新下一动作/期限
    const samePolicy = prev?.policy === p.policy;
    return {
      id: prev?.id ?? uid('fu'),
      referralId: p.referralId,
      policy: p.policy,
      ownerOrgId: p.ownerOrgId,
      ownerName: prev && samePolicy ? prev.ownerName : p.ownerName,
      nextAction: p.nextAction,
      nextContactDue: p.nextContactDue,
      nextContactNote: p.nextContactNote,
      assignedAt:
        prev && samePolicy
          ? prev.assignedAt
          : p.policy === 'transfer_on_move_in'
            ? `${t.moveInDate}T00:00:00+08:00`
            : nowIso,
      clientNotified: p.clientNotified,
      clientNotifiedBy: p.clientNotifiedBy,
      clientNotifiedAt: p.clientNotifiedAt,
      movedCount: moved,
    };
  });
  t.activatedAt = t.activatedAt ?? nowIso;

  // 若回执先于移交方式到达，未完成任务应随唯一责任一并改派，避免出现“责任在新机构、任务在原机构”
  const byReferral = new Map(t.followUps.map((f) => [f.referralId, f]));
  for (const task of t.tasks) {
    if (task.status !== 'open') continue;
    const fu = byReferral.get(task.referralId);
    if (!fu) continue;
    if (task.ownerOrgId !== fu.ownerOrgId) {
      task.ownerOrgId = fu.ownerOrgId;
      task.ownerName = fu.ownerName;
      task.note += `（随移交改派给 ${fu.ownerName}）`;
    }
  }

  // 责任转移事件入同一转介时间线
  for (const fu of t.followUps) {
    const r = next.referrals.find((x) => x.id === fu.referralId);
    if (!r) continue;
    r.timeline = r.timeline ?? [];
    const kind: ReferralTimelineEvent['kind'] = fu.policy === 'transfer_on_move_in' ? 'ownership_moved' : 'ownership_assigned';
    const dedupeKey = `${kind}:${fu.referralId}:${fu.ownerOrgId}`;
    if (r.timeline.some((e) => e.dedupeKey === dedupeKey)) continue;
    r.timeline.push({
      id: uid('evt'),
      referralId: r.id,
      at: fu.assignedAt,
      recordedAt: nowIso,
      orgId: fu.ownerOrgId,
      actorName: fu.ownerName,
      kind,
      summary:
        kind === 'ownership_assigned'
          ? `唯一跟进责任留在${fu.ownerName}（原机构续办），直至服务方接收或明确拒绝。`
          : `迁入日 ${t.moveInDate} 起，唯一跟进责任转给${fu.ownerName}；原机构停止发起联系。`,
      dedupeKey,
    });
  }

  // 历史归属冻结：已完成的既有家访若缺失归属，补记到其完成时刻的机构（默认原机构）
  t.historyAttribution = { ...t.historyAttribution };
  for (const v of next.visits) {
    if (isCompletedVisit(v) && !t.historyAttribution[v.id]) {
      t.historyAttribution[v.id] = v.attributedOrgId ?? t.originOrg.id;
    }
  }
  return next;
}

// ---------- 联系归属校验：任何时刻只有一个机构能发起联系 ----------

export interface ContactGuardResult {
  ok: boolean;
  reason?: 'not_owner' | 'no_follow_up' | 'no_actor_org';
  ownerOrgId?: string;
}

export function canContact(referral: Referral, t: CaseTransfer | undefined, callerOrgId: string | undefined): ContactGuardResult {
  const fu = findFollowUp(t, referral.id);
  if (!fu) return { ok: false, reason: 'no_follow_up' };
  if (!callerOrgId) return { ok: false, reason: 'no_actor_org' };
  if (fu.ownerOrgId !== callerOrgId) return { ok: false, reason: 'not_owner', ownerOrgId: fu.ownerOrgId };
  if (fu.nextAction === 'none') return { ok: false, reason: 'no_follow_up' };
  return { ok: true, ownerOrgId: fu.ownerOrgId };
}

/**
 * 追加一条客户联系记录到同一转介时间线。
 * 仅唯一责任机构可调用；原机构在迁移后若尝试联系，返回结构化拒绝而不是写入。
 */
export function recordClientContact(args: {
  caseFile: CaseFile;
  referralId: string;
  callerOrgId: string | undefined;
  callerName: string;
  at: string;
  content: string;
  /** 是否为离线记录补传 */
  lateSync?: boolean;
  recordedAt?: string;
}): { caseFile: CaseFile; event: ReferralTimelineEvent } | { rejected: ContactGuardResult } {
  const referral = args.caseFile.referrals.find((r) => r.id === args.referralId);
  if (!referral) throw new Error(`referral not found: ${args.referralId}`);
  const guard = canContact(referral, args.caseFile.transfer, args.callerOrgId);
  if (!guard.ok) return { rejected: guard };

  const c: CaseFile = structuredClone(args.caseFile);
  const r = c.referrals.find((x) => x.id === args.referralId)!;
  r.timeline = r.timeline ?? [];
  const event: ReferralTimelineEvent = {
    id: uid('evt'),
    referralId: r.id,
    at: args.at,
    recordedAt: args.recordedAt ?? new Date().toISOString(),
    orgId: guard.ownerOrgId!,
    actorName: args.callerName,
    kind: args.lateSync ? 'late_sync' : 'client_contact',
    summary: args.lateSync
      ? `离线记录补传（发生于 ${args.at.slice(0, 16).replace('T', ' ')}）：${args.content}（归属责任机构的既有联系，不改变当前责任）`
      : args.content,
    lateSync: args.lateSync,
  };
  r.timeline.push(event);
  return { caseFile: c, event };
}

// ---------- 迟到同步：只补时间线，不夺权、不结案 ----------

/**
 * 旧机构离线记录补传。无论其发生时间早于或晚于责任转移：
 * - 仅向同一时间线追加（标记 lateSync）；
 * - 不改变 followUps 的 ownerOrgId / movedCount；
 * - 不把未完成转介标成已办结。
 */
export function replayLateSync(caseFile: CaseFile, events: ReferralTimelineEvent[]): CaseFile {
  const next: CaseFile = structuredClone(caseFile);
  const t = next.transfer;
  if (!t) return next;
  for (const ev of events) {
    const r = next.referrals.find((x) => x.id === ev.referralId);
    if (!r) continue;
    if (r.status === '已接收回执' || r.status === '已办结') continue;
    r.timeline = r.timeline ?? [];
    const dedupeKey = `late:${ev.id}`;
    if (r.timeline.some((e) => e.dedupeKey === dedupeKey)) continue;
    r.timeline.push({
      ...ev,
      id: uid('evt'),
      kind: ev.kind === 'client_contact' ? 'late_sync' : ev.kind,
      lateSync: true,
      recordedAt: ev.recordedAt ?? new Date().toISOString(),
      summary: `离线补传（业务时间 ${ev.at.slice(0, 16).replace('T', ' ')}）：${ev.summary}。仅归档，不改变当前唯一责任归属。`,
      dedupeKey,
    });
  }
  t.pendingOffline = [];
  return next;
}

// ---------- 结案守卫 ----------

export interface CloseCheck {
  allowed: boolean;
  openReferralIds: string[];
  reasons: string[];
}

/**
 * 结案前检查：仍有未完成转介（无回执 / 已退回补件未补齐）时禁止标成已办结。
 * 服务方回执（接收/拒绝）到达后才允许结案。
 */
export function checkCloseable(c: CaseFile): CloseCheck {
  const open: string[] = [];
  const reasons: string[] = [];
  for (const r of c.referrals) {
    const fu = findFollowUp(c.transfer, r.id);
    const stillOpen =
      r.status === '已发出' ||
      r.status === '已退回补件' ||
      (fu?.nextAction ?? 'none') !== 'none';
    const noReceipt = r.providerDecision !== 'accepted' && r.providerDecision !== 'declined';
    if (stillOpen && noReceipt) {
      open.push(r.id);
      reasons.push(`${r.id}（${r.org}）仍未有服务方最终回执，不能标成已办结`);
    }
  }
  return { allowed: open.length === 0, openReferralIds: open, reasons };
}

// ---------- 不变量校验（客户端与模拟服务端共用） ----------

/**
 * 校验整个移交案卷的不变量：
 *  1) 每项未结束转介恰好一个 owner，且属于两种合规移交方式之一；
 *  2) 同一退回回执的幂等任务不超过一条；
 *  3) 已完成家访的历史归属未被改写；
 *  4) 已有服务方最终回执前，不允许把转介标成已办结；
 *  5) 迟到同步不得改变 owner。
 */
export function validateTransfer(candidate: CaseFile, opts: { previous?: CaseFile | null; current?: CaseFile | null } = {}): Violation[] {
  const t = candidate.transfer;
  if (!t) return [];
  const prev = opts.previous ?? null;
  const violations: Violation[] = [];

  // 1) 唯一责任
  const seen = new Map<string, ReferralFollowUp>();
  for (const fu of t.followUps) {
    const r = candidate.referrals.find((x) => x.id === fu.referralId);
    if (!r) continue;
    const final = r.providerDecision === 'accepted' || r.providerDecision === 'declined' || r.status === '已办结';
    if (final) continue;
    if (seen.has(fu.referralId)) {
      violations.push({
        code: 'TRANSFER_DUAL_OWNER',
        path: `referrals[${fu.referralId}]`,
        title: '同一转介出现两个跟进责任机构',
        detail: '任何时刻只能有一个机构能发起客户或服务方联系；请合并为单一责任记录。',
      });
      continue;
    }
    seen.set(fu.referralId, fu);
    if (fu.policy !== 'origin_keeps' && fu.policy !== 'transfer_on_move_in') {
      violations.push({
        code: 'TRANSFER_OWNER_MISMATCH',
        path: `referrals[${fu.referralId}]`,
        title: '跟进方式不在两种合规模式内',
        detail: '责任要么留在原机构直至服务方最终回执，要么在迁入日转给新机构；不允许其他混合态。',
      });
    }
    if (fu.policy === 'transfer_on_move_in' && fu.ownerOrgId !== t.receivingOrg.id) {
      violations.push({
        code: 'TRANSFER_OWNER_MISMATCH',
        path: `referrals[${fu.referralId}]`,
        title: '迁入日转交后责任仍在原机构',
        detail: '选择“迁入日转给新机构”时，owner 应为新机构；否则原机构会被误认为仍可发起联系。',
      });
    }
    if (fu.policy === 'origin_keeps' && fu.ownerOrgId !== t.originOrg.id) {
      violations.push({
        code: 'TRANSFER_OWNER_MISMATCH',
        path: `referrals[${fu.referralId}]`,
        title: '原机构续办时责任不在原机构',
        detail: '选择“原机构续办”时，owner 应为原机构。',
      });
    }

    // 联系记录只能由当前唯一责任机构发起；责任生效前的历史事件与迟到同步除外
    const referral = candidate.referrals.find((x) => x.id === fu.referralId);
    const effectiveAt = Number.isNaN(Date.parse(fu.assignedAt)) ? null : Date.parse(fu.assignedAt);
    for (const ev of referral?.timeline ?? []) {
      if (ev.kind !== 'client_contact' && ev.kind !== 'provider_contact') continue;
      if (ev.orgId === fu.ownerOrgId) continue;
      if (ev.lateSync) continue;
      // 责任归属生效之前的既有联系记录属于历史沟通，不算违约
      if (effectiveAt !== null && Date.parse(ev.at) < effectiveAt) continue;
      violations.push({
        code: 'TRANSFER_CONTACT_BY_NON_OWNER',
        path: `referrals[${fu.referralId}].timeline`,
        title: '非责任机构发起了客户/服务方联系',
        detail: `事件由 ${ev.orgId} 发起，但当前唯一责任机构是 ${fu.ownerOrgId}。任何时刻只允许一个机构发起联系，避免客户收到重复询问。`,
      });
    }
  }

  // 2) 任务幂等，且未完成任务必须由当前唯一责任机构持有
  const seenKeys = new Set<string>();
  for (const task of t.tasks) {
    const key = task.dedupeKey;
    if (key) {
      if (seenKeys.has(key)) {
        violations.push({
          code: 'TRANSFER_DUPLICATE_TASK',
          path: `transfer.tasks[${task.id}]`,
          title: '同一回执生成了重复催办任务',
          detail: '重复送达的同一退回回执只能有一条补齐/催办任务；多余项应合并。',
        });
      }
      seenKeys.add(key);
    }
    if (task.status === 'open') {
      const fu = t.followUps.find((f) => f.referralId === task.referralId);
      if (fu && task.ownerOrgId !== fu.ownerOrgId) {
        violations.push({
          code: 'TRANSFER_OWNER_MISMATCH',
          path: `transfer.tasks[${task.id}]`,
          title: '任务持有机构与唯一责任机构不一致',
          detail: `任务 ${task.id} 在 ${task.ownerOrgId}，但该转介唯一责任在 ${fu.ownerOrgId}；任务应随责任一并改派。`,
        });
      }
    }
  }

  // 3) 历史归属冻结
  if (prev?.transfer) {
    for (const v of candidate.visits) {
      if (!isCompletedVisit(v)) continue;
      const before = prev.visits.find((x) => x.id === v.id);
      if (!before || !isCompletedVisit(before)) continue;
      const oldOrg = visitAttribution(prev, before);
      const newOrg = visitAttribution(candidate, v);
      if (oldOrg && newOrg && oldOrg !== newOrg) {
        violations.push({
          code: 'TRANSFER_HISTORY_REATTRIBUTED',
          path: `visits[${v.id}].attributedOrgId`,
          title: '交接改写了已完成家访的历史归属',
          detail: `记录 ${v.id} 原归属 ${oldOrg}，被改成 ${newOrg}。移交只改变未结束事项的跟进责任，不改变已完成家访归属。`,
        });
      }
    }
  }

  // 4) 结案守卫
  const close = checkCloseable(candidate);
  if (!close.allowed) {
    for (const id of close.openReferralIds) {
      const r = candidate.referrals.find((x) => x.id === id);
      if (r?.status === '已办结') {
        violations.push({
          code: 'TRANSFER_CLOSE_WITH_OPEN_REFERRAL',
          path: `referrals[${id}].status`,
          title: '未收到服务方最终回执就结案',
          detail: `${id} 尚未获得服务方接收/拒绝回执，不能标成“已办结”；否则客户会错过复核窗口。`,
        });
      }
    }
  }

  // 5) 迟到同步不得改变 owner
  if (prev?.transfer) {
    for (const pf of prev.transfer.followUps) {
      const cf = t.followUps.find((x) => x.referralId === pf.referralId);
      if (!cf) continue;
      if (cf.ownerOrgId !== pf.ownerOrgId && (cf.nextAction ?? 'none') !== 'none') {
        const hasLate = candidate.referrals
          .find((r) => r.id === pf.referralId)
          ?.timeline?.some((e) => e.lateSync);
        if (hasLate && pf.policy === 'transfer_on_move_in') {
          violations.push({
            code: 'TRANSFER_LATE_SYNC_USURPS',
            path: `transfer.followUps[${cf.id}]`,
            title: '迟到同步夺回了已转移的责任',
            detail: '旧机构的离线补传只能归档到时间线；迁入日已转给新机构的跟进责任不得被追溯改变。',
          });
        }
      }
    }
  }

  return violations;
}

/** 唯一责任机构记录一次“联系服务方”（催办/补件确认），与客户联系共用归属守卫 */
export function recordProviderContact(args: {
  caseFile: CaseFile;
  referralId: string;
  callerOrgId: string | undefined;
  callerName: string;
  at: string;
  content: string;
}): { caseFile: CaseFile; event: ReferralTimelineEvent } | { rejected: ContactGuardResult } {
  const referral = args.caseFile.referrals.find((r) => r.id === args.referralId);
  if (!referral) throw new Error(`referral not found: ${args.referralId}`);
  const guard = canContact(referral, args.caseFile.transfer, args.callerOrgId);
  if (!guard.ok) return { rejected: guard };

  const c: CaseFile = structuredClone(args.caseFile);
  const r = c.referrals.find((x) => x.id === args.referralId)!;
  r.timeline = r.timeline ?? [];
  const event: ReferralTimelineEvent = {
    id: uid('evt'),
    referralId: r.id,
    at: args.at,
    recordedAt: new Date().toISOString(),
    orgId: guard.ownerOrgId!,
    actorName: args.callerName,
    kind: 'provider_contact',
    summary: args.content,
  };
  r.timeline.push(event);
  return { caseFile: c, event };
}

/** 完成一条跟进任务（例如补齐材料后联系服务方确认）；只允许任务持有机构操作 */
export function completeFollowUpTask(
  caseFile: CaseFile,
  taskId: string,
  callerOrgId: string | undefined,
  at: string,
): { caseFile: CaseFile } | { rejected: ContactGuardResult } {
  const t = caseFile.transfer;
  if (!t) return { rejected: { ok: false, reason: 'no_follow_up' } };
  const task = t.tasks.find((x) => x.id === taskId);
  if (!task) return { rejected: { ok: false, reason: 'no_follow_up' } };
  if (!callerOrgId) return { rejected: { ok: false, reason: 'no_actor_org' } };
  if (task.ownerOrgId !== callerOrgId) {
    return { rejected: { ok: false, reason: 'not_owner', ownerOrgId: task.ownerOrgId } };
  }
  const c: CaseFile = structuredClone(caseFile);
  const ct = c.transfer!;
  const ctask = ct.tasks.find((x) => x.id === taskId)!;
  ctask.status = 'done';
  ctask.note += `（已于 ${at.slice(0, 10)} 由责任机构完成）`;
  const fu = findFollowUp(ct, task.referralId);
  if (fu) {
    fu.nextAction = 'contact_client';
    fu.nextContactDue = at.slice(0, 10);
    fu.nextContactNote = '材料已补齐并联系服务方，等待最终回执；下一次联系为客户说明进展。';
  }
  const r = c.referrals.find((x) => x.id === task.referralId);
  if (r) {
    r.timeline = r.timeline ?? [];
    r.timeline.push({
      id: uid('evt'),
      referralId: r.id,
      at,
      recordedAt: new Date().toISOString(),
      orgId: task.ownerOrgId,
      actorName: task.ownerName,
      kind: 'provider_contact',
      summary: `已补齐 ${task.note.replace(/^补齐 |并联系服务方确认.*$/g, '')} 并联系服务方，等待最终回执。`,
    });
  }
  return { caseFile: c };
}

// ---------- 展示辅助 ----------

export function policyLabel(p: TransferPolicy): string {
  return p === 'origin_keeps' ? '原机构续办' : '迁入日转给新机构';
}

export function nextActionLabel(a: ReferralFollowUp['nextAction']): string {
  switch (a) {
    case 'contact_provider':
      return '联系服务方催办/确认补件';
    case 'contact_client':
      return '联系客户说明进展';
    case 'none':
      return '无需继续联系';
    default:
      return a;
  }
}

export function taskKindLabel(k: FollowUpTaskKindLike): string {
  switch (k) {
    case 'provider_contact':
      return '联系服务方';
    case 'client_contact':
      return '联系客户';
    case 'supplement_due':
      return '补齐材料并催办';
    default:
      return k;
  }
}
type FollowUpTaskKindLike = FollowUpTask['kind'];

/** 转介时间线按业务时间排序（迟到同步也按其业务时间插入，但带标记） */
export function sortedTimeline(referral: Referral): ReferralTimelineEvent[] {
  return [...(referral.timeline ?? [])].sort((a, b) => +new Date(a.at) - +new Date(b.at));
}

/** 供导出/调试：把新案卷整体替换进就地编辑的草稿对象（保持引用不变） */
export function applyCaseInPlace(target: CaseFile, next: CaseFile): void {
  const keys = [
    'client',
    'appointments',
    'goals',
    'visits',
    'referrals',
    'reminders',
    'plan',
    'transfer',
  ] as const;
  for (const k of keys) {
    (target as unknown as Record<string, unknown>)[k] = structuredClone(
      (next as unknown as Record<string, unknown>)[k],
    );
  }
}

/** 供测试与场景：构造一份用于迁居演示的静态度量 */
export interface TransferSnapshot {
  policy: TransferPolicy | null;
  owners: { referralId: string; orgId: string; ownerName: string }[];
  openTasks: FollowUpTask[];
  referralStatuses: { id: string; status: Referral['status']; supplementDue?: string }[];
  closed: boolean;
}

export function snapshotTransfer(c: CaseFile): TransferSnapshot {
  const t = c.transfer;
  return {
    policy: t?.followUps[0]?.policy ?? null,
    owners: (t?.followUps ?? []).map((f) => ({ referralId: f.referralId, orgId: f.ownerOrgId, ownerName: f.ownerName })),
    openTasks: (t?.tasks ?? []).filter((x) => x.status === 'open'),
    referralStatuses: c.referrals.map((r) => ({
      id: r.id,
      status: r.status,
      supplementDue: r.providerReturn?.supplementDue,
    })),
    closed: c.visits.length > 0 && c.referrals.every((r) => r.status === '已办结'),
  };
}
