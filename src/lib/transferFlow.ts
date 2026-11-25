// ============================================================
// 迁居移交回放：样例 C-21 的两种合规处理
// ------------------------------------------------------------
// 纯函数、确定性：同一输入总是得到同一输出，便于 UI 逐步播放与自动化断言。
// 关键事实均来自题目：
//  - C-21 于 2026-06-01 迁入新机构；两条完成家访（05-18、05-26）+ 06-03 预约
//  - RH-4 于 05-28 送康复服务方，要求 06-05 前补齐行动能力评估
//  - 客户优先希望熟悉的原社工说明材料，但同意责任转交后由新机构社工接续
//  - 服务方 06-02 10:00 退回缺评估
//  - 原社工 05-31 的记录因离线到 06-03 才同步（归入同一转介时间线，标记迟到）
// ============================================================

import type {
  CaseFile,
  CaseTransfer,
  FollowUpTask,
  Referral,
  ReferralTimelineEvent,
  TransferPolicy,
  Violation,
} from '../types';
import { c21Case } from '../data/seed';
import {
  applyFollowUpPlan,
  applyProviderReceipt,
  buildFollowUpPlan,
  checkCloseable,
  findFollowUp,
  recordClientContact,
  replayLateSync,
  sortedTimeline,
  validateTransfer,
  visitAttribution,
} from './transfer';

export const C21 = {
  caseId: 'case-c21',
  moveInDate: '2026-06-01',
  referralId: 'ref-rh4',
  applicationNo: 'RH-4',
  returnReference: 'RH-4-退回-0602',
  returnAt: '2026-06-02T10:00:00+08:00',
  supplementDue: '2026-06-05',
  lateContactAt: '2026-05-31T16:20:00+08:00',
  lateContactRecordedAt: '2026-06-03T09:05:00+08:00',
};

export const ORIGIN_WORKER = { id: 'lin', name: '林晓', orgId: 'org-qinghe' };
export const RECEIVING_WORKER = { id: 'sun', name: '孙丽', orgId: 'org-xinqiao' };

export interface ReplayStep {
  key: string;
  title: string;
  detail: string;
  at: string;
  tone: 'info' | 'success' | 'warn' | 'error';
}

export interface ReplayResult {
  policy: TransferPolicy;
  caseFile: CaseFile;
  steps: ReplayStep[];
  /** 校验：唯一责任人、任务、客户通知、补齐截止日、历史归属 */
  checks: TransferCheck[];
  violations: Violation[];
  /** 重复回执是否被正确去重 */
  duplicateReceipt: { duplicate: boolean; newTaskCount: number; timelineCount: number };
  /** 结案检查 */
  close: { allowed: boolean; reasons: string[] };
  /** 迟到同步是否改变过责任（预期 false） */
  lateSyncChangedOwner: boolean;
}

export interface TransferCheck {
  key: string;
  label: string;
  ok: boolean;
  value: string;
}

function baseCaseWithPlan(policy: TransferPolicy): { c: CaseFile; steps: ReplayStep[] } {
  const c = c21Case();
  const steps: ReplayStep[] = [];
  const plans = buildFollowUpPlan({
    c,
    policy,
    originWorker: ORIGIN_WORKER,
    receivingWorker: RECEIVING_WORKER,
    clientNotified:
      policy === 'origin_keeps'
        ? '原社工已向客户说明：由熟悉情况的林晓继续与康复服务方沟通并补齐行动能力评估，客户无需另找新机构。'
        : '原社工已向客户说明：迁入后由新机构社工接续跟进 RH-4，材料补齐与联系新机构负责。',
    clientNotifiedAt: `${C21.moveInDate}T12:00:00+08:00`,
  });
  const withPlan = applyFollowUpPlan(c, plans);
  const owner = findFollowUp(withPlan.transfer, C21.referralId)!;
  steps.push({
    key: 'plan',
    title:
      policy === 'origin_keeps'
        ? '① 选择“原机构续办”：责任留在清河，直至服务方接收或明确拒绝'
        : '① 选择“迁入日转给新机构”：2026-06-01 起责任交给新桥',
    detail: `唯一责任人：${owner.ownerName}（${withPlan.transfer!.followUps[0].ownerOrgId === 'org-qinghe' ? '清河街道' : '新桥街道'}）。客户告知：${owner.clientNotified}`,
    at: `${C21.moveInDate}T12:05:00+08:00`,
    tone: 'info',
  });
  return { c: withPlan, steps };
}

export function runTransferReplay(policy: TransferPolicy): ReplayResult {
  const { c: planned, steps } = baseCaseWithPlan(policy);
  const ownerBeforeLate = findFollowUp(planned.transfer, C21.referralId)?.ownerOrgId;
  const t = planned.transfer!;

  // ② 服务方 06-02 10:00 退回缺评估
  const receipt = applyProviderReceipt({
    caseFile: planned,
    referralId: C21.referralId,
    decision: 'returned',
    referenceNo: C21.returnReference,
    receivedAt: C21.returnAt,
    reason: '缺少行动能力评估，无法确定康复训练方案',
    missingMaterials: ['行动能力评估'],
    supplementDue: C21.supplementDue,
    actorName: '区康复服务指导中心',
    orgId: 'org-rehab',
  });
  const afterReturn = receipt.caseFile;
  const ownerAfterReturn = findFollowUp(afterReturn.transfer, C21.referralId)!;
  const taskAfterReturn = afterReturn.transfer!.tasks.filter((x) => x.referralId === C21.referralId);
  steps.push({
    key: 'return',
    title: '② 服务方 06-02 10:00 退回：缺少行动能力评估',
    detail: `生成 1 条补齐/催办任务，负责人 ${ownerAfterReturn.ownerName}；补齐截止 ${C21.supplementDue}。下一次联系期限同步改为 ${C21.supplementDue}。`,
    at: C21.returnAt,
    tone: 'warn',
  });

  // ③ 重复送达同一退回回执 → 不生成第二次催办
  const dup = applyProviderReceipt({
    caseFile: afterReturn,
    referralId: C21.referralId,
    decision: 'returned',
    referenceNo: C21.returnReference,
    receivedAt: C21.returnAt,
    reason: '缺少行动能力评估，无法确定康复训练方案',
    missingMaterials: ['行动能力评估'],
    supplementDue: C21.supplementDue,
    actorName: '区康复服务指导中心',
    orgId: 'org-rehab',
  });
  const afterDup = dup.caseFile;
  const tasksAfterDup = afterDup.transfer!.tasks.filter(
    (x) => x.referralId === C21.referralId && x.status !== 'superseded',
  );
  steps.push({
    key: 'duplicate',
    title: '③ 同一退回回执重复送达：幂等忽略',
    detail: `重复=${dup.duplicate}；本次新增任务 ${dup.newTasks.length} 条；该转介仍未关闭。`,
    at: '2026-06-02T10:04:00+08:00',
    tone: 'info',
  });

  // ④ 原社工 05-31 离线记录于 06-03 补传 → 只入时间线
  const pending: ReferralTimelineEvent[] = (planned.transfer?.pendingOffline ?? []).filter(
    (e) => e.referralId === C21.referralId,
  );
  const afterLate = replayLateSync(afterDup, pending);
  const ownerAfterLate = findFollowUp(afterLate.transfer, C21.referralId)!;
  steps.push({
    key: 'late',
    title: '④ 原社工 05-31 的离线记录 06-03 才同步',
    detail: `已归入同一转介时间线并标记“迟到同步”；责任归属 ${ownerBeforeLate === ownerAfterLate.ownerOrgId ? '保持不变' : '被改变（异常）'}；转介状态仍为“${afterLate.referrals.find((r) => r.id === C21.referralId)!.status}”。`,
    at: C21.lateContactRecordedAt,
    tone: 'info',
  });

  // ⑤ 尝试由原机构在责任已转交后联系客户 → 被拒
  let afterContactAttempt = afterLate;
  let contactAttempt = '';
  if (policy === 'transfer_on_move_in') {
    const attempt = recordClientContact({
      caseFile: afterLate,
      referralId: C21.referralId,
      callerOrgId: ORIGIN_WORKER.orgId,
      callerName: ORIGIN_WORKER.name,
      at: '2026-06-03T09:30:00+08:00',
      content: '原社工尝试再次联系客户说明补件安排。',
    });
    if ('rejected' in attempt) {
      contactAttempt = `原机构被拒绝发起联系（原因：${attempt.rejected.reason}），实际责任人 ${attempt.rejected.ownerOrgId}。`;
    } else {
      afterContactAttempt = attempt.caseFile;
      contactAttempt = '原机构成功写入联系记录（不合规）。';
    }
    steps.push({
      key: 'owner-guard',
      title: '⑤ 任何时刻只允许一个机构发起联系',
      detail: contactAttempt,
      at: '2026-06-03T09:31:00+08:00',
      tone: 'info',
    });
  } else {
    // 原机构续办：由其记录一条催办联系（合规）
    const okContact = recordClientContact({
      caseFile: afterLate,
      referralId: C21.referralId,
      callerOrgId: ORIGIN_WORKER.orgId,
      callerName: ORIGIN_WORKER.name,
      at: '2026-06-03T09:30:00+08:00',
      content: '原社工记录：已向客户解释补件原因，约定 06-04 前补做评估。',
    });
    if ('caseFile' in okContact) {
      afterContactAttempt = okContact.caseFile;
      contactAttempt = '唯一责任人（原机构）成功记录一次客户联系，归入同一时间线。';
    }
    steps.push({
      key: 'owner-guard',
      title: '⑤ 任何时刻只允许一个机构发起联系',
      detail: contactAttempt,
      at: '2026-06-03T09:31:00+08:00',
      tone: 'info',
    });
  }

  // ⑥ 尝试把未完成转介标成已办结 → 被守卫拦截
  const breakClose = structuredClone(afterContactAttempt);
  const closedReferral = breakClose.referrals.find((r) => r.id === C21.referralId)!;
  closedReferral.status = '已办结';
  const closeViolations = validateTransfer(breakClose, { previous: afterContactAttempt });
  const closeBlocked = closeViolations.some((v) => v.code === 'TRANSFER_CLOSE_WITH_OPEN_REFERRAL');
  steps.push({
    key: 'close',
    title: '⑥ 服务方最终回执前不得结案',
    detail: closeBlocked
      ? '尝试把 RH-4 标成“已办结”被守卫拦截：尚缺服务方最终回执，客户复核窗口可能被错过。'
      : '异常：未拦截。',
    at: '2026-06-03T09:40:00+08:00',
    tone: closeBlocked ? 'info' : 'error',
  });

  const referral = afterContactAttempt.referrals.find((r) => r.id === C21.referralId)!;
  const owner = findFollowUp(afterContactAttempt.transfer, C21.referralId)!;
  const closeCheck = checkCloseable(afterContactAttempt);
  const lateTimeline = referral.timeline?.find((e) => e.lateSync) ?? null;

  const checks: TransferCheck[] = [
    {
      key: 'unique-owner',
      label: '唯一跟进责任机构',
      ok: owner.ownerOrgId === (policy === 'origin_keeps' ? 'org-qinghe' : 'org-xinqiao'),
      value: `${owner.ownerName}（${owner.ownerOrgId === 'org-qinghe' ? '清河街道' : '新桥街道'}），movedCount=${owner.movedCount}`,
    },
    {
      key: 'next-task',
      label: '下一次联系任务',
      ok: owner.nextAction === 'contact_provider' && owner.nextContactDue === C21.supplementDue,
      value: `${owner.nextContactNote} / 截止 ${owner.nextContactDue}`,
    },
    {
      key: 'client-notice',
      label: '客户已获告知',
      ok: Boolean(owner.clientNotified) && owner.clientNotifiedBy.length > 0,
      value: `${owner.clientNotifiedBy}：${owner.clientNotified}`,
    },
    {
      key: 'supplement-due',
      label: '退回材料的补齐截止日',
      ok: referral.providerReturn?.supplementDue === C21.supplementDue,
      value: `${referral.providerReturn?.supplementDue}（缺 ${referral.providerReturn?.missingMaterials.join('、')}）`,
    },
    {
      key: 'late-sync',
      label: '迟到记录的归属',
      ok: Boolean(lateTimeline) && lateTimeline?.orgId === 'org-qinghe' && owner.ownerOrgId === ownerBeforeLate,
      value: lateTimeline
        ? `${lateTimeline.at} 的原机构记录已归档（补传于 ${lateTimeline.recordedAt}），不改变当前责任。`
        : '未找到迟到记录',
    },
    {
      key: 'history',
      label: '已完成家访历史归属不变',
      ok: afterContactAttempt.visits
        .filter((v) => v.fulfillment === 'completed')
        .every((v) => visitAttribution(afterContactAttempt, v) === 'org-qinghe'),
      value: `05-18 / 05-26 均归属清河街道；06-03 预约（${afterContactAttempt.appointments[0]?.id ?? 'c21-appt-0603'}）仍为待访。`,
    },
    {
      key: 'dedupe',
      label: '重复回执不生成第二次催办',
      ok: tasksAfterDup.length === 1,
      value: `去重后任务 ${tasksAfterDup.length} 条（幂等键 ${tasksAfterDup[0]?.dedupeKey ?? '—'}）`,
    },
    {
      key: 'close',
      label: '未完成转介不得标成已结案',
      ok: !closeCheck.allowed && closeBlocked,
      value: closeCheck.reasons[0] ?? '异常：可结案',
    },
    {
      key: 'timeline',
      label: '服务方回执与客户联系同一条时间线',
      ok: (referral.timeline ?? []).filter((e) => e.kind === 'provider_return').length === 1 &&
        (referral.timeline ?? []).some((e) => e.lateSync),
      value: `共 ${referral.timeline?.length ?? 0} 条事件，含服务方退回与迟到客户联系`,
    },
  ];

  if (policy === 'transfer_on_move_in') {
    checks.push({
      key: 'old-org-stopped',
      label: '原机构停止联系',
      ok: contactAttempt.includes('拒绝'),
      value: contactAttempt,
    });
  } else {
    checks.push({
      key: 'origin-continues',
      label: '熟悉情况的社工继续沟通',
      ok: contactAttempt.includes('成功'),
      value: contactAttempt,
    });
  }

  return {
    policy,
    caseFile: afterContactAttempt,
    steps,
    checks,
    violations: validateTransfer(afterContactAttempt, { previous: afterLate }),
    duplicateReceipt: {
      duplicate: dup.duplicate,
      newTaskCount: dup.newTasks.length,
      timelineCount: (referral.timeline ?? []).length,
    },
    close: { allowed: closeCheck.allowed, reasons: closeCheck.reasons },
    lateSyncChangedOwner: owner.ownerOrgId !== ownerBeforeLate,
  };
}

/** 两种方式并排对比，供场景页与测试复用 */
export function comparePolicies(): {
  originKeeps: ReplayResult;
  transferOnMoveIn: ReplayResult;
} {
  return {
    originKeeps: runTransferReplay('origin_keeps'),
    transferOnMoveIn: runTransferReplay('transfer_on_move_in'),
  };
}

/** 时间线（含迟到事件）按业务时间稳定排序，供 UI 展示 */
export function timelineOf(result: ReplayResult): ReferralTimelineEvent[] {
  const r = result.caseFile.referrals.find((x) => x.id === C21.referralId);
  if (!r) return [];
  return sortedTimeline(r);
}

/** 供移交给真实案卷时使用：以某种方式激活责任并返回新案卷 */
export function activateTransferOnCase(
  base: CaseFile,
  policy: TransferPolicy,
  clientNotified: string,
  clientNotifiedAt: string,
): CaseFile {
  const plans = buildFollowUpPlan({
    c: base,
    policy,
    originWorker: ORIGIN_WORKER,
    receivingWorker: RECEIVING_WORKER,
    clientNotified,
    clientNotifiedAt,
  });
  return applyFollowUpPlan(base, plans);
}

export interface TaskView {
  task: FollowUpTask;
  referral: Referral | undefined;
}

export function openTasks(c: CaseFile): TaskView[] {
  const t = c.transfer;
  if (!t) return [];
  return t.tasks
    .filter((x) => x.status === 'open')
    .map((task) => ({ task, referral: c.referrals.find((r) => r.id === task.referralId) }))
    .sort((a, b) => a.task.dueAt.localeCompare(b.task.dueAt));
}

/** 仅用于断言：某机构是否能查看转介摘要 */
export function canViewReferralSummary(t: CaseTransfer | undefined, orgId: string | undefined): boolean {
  if (!t || !orgId) return false;
  return (t.orgScopes[orgId] ?? []).includes('转介摘要');
}
