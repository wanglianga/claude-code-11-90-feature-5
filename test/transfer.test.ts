import { describe, expect, it } from 'vitest';
import { c21Case } from '../src/data/seed';
import {
  applyFollowUpPlan,
  applyProviderReceipt,
  buildFollowUpPlan,
  canContact,
  canReadClientContact,
  checkCloseable,
  completeFollowUpTask,
  findFollowUp,
  recordClientContact,
  recordProviderContact,
  referralSummariesFor,
  replayLateSync,
  returnDedupeKey,
  sortedTimeline,
  validateTransfer,
  visibleTimelineEvent,
  visitAttribution,
} from '../src/lib/transfer';
import { comparePolicies, runTransferReplay, C21, ORIGIN_WORKER, RECEIVING_WORKER } from '../src/lib/transferFlow';
import type { CaseFile, FollowUpTask, TransferPolicy } from '../src/types';

function plan(policy: TransferPolicy, clientNotified = '已告知客户由唯一机构负责补件与联系。'): CaseFile {
  const c = c21Case();
  const plans = buildFollowUpPlan({
    c,
    policy,
    originWorker: ORIGIN_WORKER,
    receivingWorker: RECEIVING_WORKER,
    clientNotified,
    clientNotifiedAt: '2026-06-01T12:00:00+08:00',
  });
  return applyFollowUpPlan(c, plans);
}

describe('C-21 迁居移交：样例事实', () => {
  it('样例包含两条完成家访、06-03 预约、RH-4 转介与两条组织', () => {
    const c = c21Case();
    expect(c.id).toBe('case-c21');
    expect(c.transfer?.moveInDate).toBe('2026-06-01');
    expect(c.visits.filter((v) => v.fulfillment === 'completed')).toHaveLength(2);
    expect(c.appointments.find((a) => a.id === 'c21-appt-0603')).toBeTruthy();
    const rh4 = c.referrals.find((r) => r.id === C21.referralId)!;
    expect(rh4.applicationNo).toBe('RH-4');
    expect(rh4.submittedMaterials?.length).toBeGreaterThan(0);
    expect(c.transfer?.originOrg.id).toBe('org-qinghe');
    expect(c.transfer?.receivingOrg.id).toBe('org-xinqiao');
    expect(c.transfer?.pendingOffline?.length).toBe(1);
  });
});

describe('原机构续办：熟悉情况的社工继续沟通', () => {
  it('责任留在原机构，下一次联系期限不晚于补齐截止日', () => {
    const c = plan('origin_keeps');
    const fu = findFollowUp(c.transfer, C21.referralId)!;
    expect(fu.ownerOrgId).toBe('org-qinghe');
    expect(fu.ownerName).toBe('林晓');
    expect(fu.policy).toBe('origin_keeps');
    expect(fu.nextContactDue).toBe('2026-06-05');
    expect(fu.nextContactDue <= C21.supplementDue).toBe(true);
    expect(fu.clientNotifiedBy).toBe('清河街道综合服务中心');
    expect(fu.clientNotified).toBe('已告知客户由唯一机构负责补件与联系。');
    expect(fu.movedCount).toBe(0);
  });

  it('原机构可以发起客户联系，新机构不能', () => {
    const c = plan('origin_keeps');
    const r = c.referrals.find((x) => x.id === C21.referralId)!;
    expect(canContact(r, c.transfer, 'org-qinghe').ok).toBe(true);
    expect(canContact(r, c.transfer, 'org-xinqiao').ok).toBe(false);
    expect(canContact(r, c.transfer, 'org-xinqiao').ownerOrgId).toBe('org-qinghe');
  });
});

describe('迁入日转给新机构：接续既有沟通并停止原团队联系', () => {
  it('责任在迁入日归新机构，客户通知由新机构接续', () => {
    const c = plan('transfer_on_move_in');
    const fu = findFollowUp(c.transfer, C21.referralId)!;
    expect(fu.ownerOrgId).toBe('org-xinqiao');
    expect(fu.ownerName).toBe('孙丽');
    expect(fu.assignedAt.startsWith('2026-06-01')).toBe(true);
    expect(fu.clientNotifiedBy).toBe('新桥街道综合服务中心');
    expect(fu.clientNotified).toMatch(/接续说明/);
  });

  it('原机构被拒绝发起客户/服务方联系，新机构可发起', () => {
    const c = plan('transfer_on_move_in');
    const clientAttempt = recordClientContact({
      caseFile: c,
      referralId: C21.referralId,
      callerOrgId: 'org-qinghe',
      callerName: '林晓',
      at: '2026-06-03T09:30:00+08:00',
      content: '原机构尝试联系。',
    });
    expect('rejected' in clientAttempt).toBe(true);
    const providerAttempt = recordProviderContact({
      caseFile: c,
      referralId: C21.referralId,
      callerOrgId: 'org-qinghe',
      callerName: '林晓',
      at: '2026-06-03T09:31:00+08:00',
      content: '原机构尝试联系服务方。',
    });
    expect('rejected' in providerAttempt).toBe(true);
    const ok = recordClientContact({
      caseFile: c,
      referralId: C21.referralId,
      callerOrgId: 'org-xinqiao',
      callerName: '孙丽',
      at: '2026-06-03T10:00:00+08:00',
      content: '新机构接续向客户说明补件安排。',
    });
    expect('caseFile' in ok).toBe(true);
  });
});

describe('服务方回执与任务幂等', () => {
  function withReturn(policy: TransferPolicy): CaseFile {
    const c = plan(policy);
    const res = applyProviderReceipt({
      caseFile: c,
      referralId: C21.referralId,
      decision: 'returned',
      referenceNo: C21.returnReference,
      receivedAt: C21.returnAt,
      reason: '缺少行动能力评估',
      missingMaterials: ['行动能力评估'],
      supplementDue: C21.supplementDue,
      actorName: '康复服务方',
      orgId: 'org-rehab',
    });
    expect(res.newTasks).toHaveLength(1);
    return res.caseFile;
  }

  it('退回生成一条补齐任务，补齐截止日=06-05，负责人=唯一责任机构', () => {
    for (const policy of ['origin_keeps', 'transfer_on_move_in'] as TransferPolicy[]) {
      const c = withReturn(policy);
      const r = c.referrals.find((x) => x.id === C21.referralId)!;
      expect(r.status).toBe('已退回补件');
      expect(r.providerReturn?.supplementDue).toBe('2026-06-05');
      const fu = findFollowUp(c.transfer, C21.referralId)!;
      expect(fu.nextContactDue).toBe('2026-06-05');
      const tasks = c.transfer!.tasks.filter((t) => t.referralId === C21.referralId && t.status === 'open');
      expect(tasks).toHaveLength(1);
      expect(tasks[0].ownerOrgId).toBe(policy === 'origin_keeps' ? 'org-qinghe' : 'org-xinqiao');
    }
  });

  it('重复送达同一退回回执不生成第二次催办', () => {
    const first = withReturn('origin_keeps');
    const dup = applyProviderReceipt({
      caseFile: first,
      referralId: C21.referralId,
      decision: 'returned',
      referenceNo: C21.returnReference,
      receivedAt: '2026-06-02T10:04:00+08:00',
      reason: '缺少行动能力评估',
      missingMaterials: ['行动能力评估'],
      supplementDue: C21.supplementDue,
      actorName: '康复服务方',
      orgId: 'org-rehab',
    });
    expect(dup.duplicate).toBe(true);
    expect(dup.newTasks).toHaveLength(0);
    const tasks = dup.caseFile.transfer!.tasks.filter((t) => t.referralId === C21.referralId);
    expect(tasks).toHaveLength(1);
    const r = dup.caseFile.referrals.find((x) => x.id === C21.referralId)!;
    // 仍留在同一时间线，且追加了一条去重痕迹
    expect(r.timeline?.some((e) => e.dedupeKey === returnDedupeKey(C21.referralId, C21.returnReference))).toBe(true);
    expect(r.timeline?.some((e) => e.kind === 'duplicate_receipt')).toBe(true);
  });

  it('服务方正式接收后转入 none，未完成任务被关闭', () => {
    const c = withReturn('transfer_on_move_in');
    const res = applyProviderReceipt({
      caseFile: c,
      referralId: C21.referralId,
      decision: 'accepted',
      referenceNo: 'RH-4-接收-0604',
      receivedAt: '2026-06-04T15:00:00+08:00',
      actorName: '康复服务方',
      orgId: 'org-rehab',
    });
    const r = res.caseFile.referrals.find((x) => x.id === C21.referralId)!;
    expect(r.status).toBe('已接收回执');
    const fu = findFollowUp(res.caseFile.transfer, C21.referralId)!;
    expect(fu.nextAction).toBe('none');
    expect(res.caseFile.transfer!.tasks.every((t) => t.status !== 'open')).toBe(true);
  });
});

describe('迟到同步与历史归属', () => {
  it('原机构 05-31 的离线记录 06-03 补传后只归档，不夺权、不结案', () => {
    const c = plan('transfer_on_move_in');
    const before = findFollowUp(c.transfer, C21.referralId)!;
    const pending = c.transfer!.pendingOffline!.filter((e) => e.referralId === C21.referralId);
    const after = replayLateSync(c, pending);
    const fu = findFollowUp(after.transfer, C21.referralId)!;
    expect(fu.ownerOrgId).toBe(before.ownerOrgId);
    expect(fu.movedCount).toBe(0);
    const r = after.referrals.find((x) => x.id === C21.referralId)!;
    expect(r.status).not.toBe('已办结');
    const late = r.timeline?.filter((e) => e.lateSync) ?? [];
    expect(late).toHaveLength(1);
    expect(late[0].at).toBe(C21.lateContactAt);
    expect(late[0].orgId).toBe('org-qinghe');
    expect(after.transfer!.pendingOffline).toEqual([]);
  });

  it('交接后已完成家访仍归属原机构，06-03 预约不受影响', () => {
    const c = plan('transfer_on_move_in');
    expect(visitAttribution(c, c.visits.find((v) => v.id === 'c21-visit-0518')!)).toBe('org-qinghe');
    expect(visitAttribution(c, c.visits.find((v) => v.id === 'c21-visit-0526')!)).toBe('org-qinghe');
    expect(c.appointments.find((a) => a.id === 'c21-appt-0603')?.status).toBe('scheduled');
  });

  it('篡改已完成家访归属会被不变量拦截', () => {
    const c = plan('origin_keeps');
    const tampered = structuredClone(c);
    const v = tampered.visits.find((x) => x.id === 'c21-visit-0518')!;
    v.attributedOrgId = 'org-xinqiao';
    tampered.transfer!.historyAttribution['c21-visit-0518'] = 'org-xinqiao';
    const violations = validateTransfer(tampered, { previous: c });
    expect(violations.some((x) => x.code === 'TRANSFER_HISTORY_REATTRIBUTED')).toBe(true);
  });
});

describe('结案守卫与唯一责任不变量', () => {
  it('服务方最终回执前把 RH-4 标成已办结会被拦截', () => {
    const c = plan('origin_keeps');
    const bad = structuredClone(c);
    bad.referrals.find((x) => x.id === C21.referralId)!.status = '已办结';
    const violations = validateTransfer(bad, { previous: c });
    expect(violations.some((x) => x.code === 'TRANSFER_CLOSE_WITH_OPEN_REFERRAL')).toBe(true);
    expect(checkCloseable(bad).allowed).toBe(false);
  });

  it('同一转介出现第二个责任机构会被拦截', () => {
    const c = plan('transfer_on_move_in');
    const bad = structuredClone(c);
    const fu = bad.transfer!.followUps.find((x) => x.referralId === C21.referralId)!;
    bad.transfer!.followUps.push({ ...fu, id: 'fu-duplicate', ownerOrgId: 'org-qinghe', ownerName: '林晓' });
    const violations = validateTransfer(bad);
    expect(violations.some((x) => x.code === 'TRANSFER_DUAL_OWNER')).toBe(true);
  });

  it('迁入日转交但 owner 仍是原机构会被识别为模式不匹配', () => {
    const c = plan('transfer_on_move_in');
    const bad = structuredClone(c);
    const fu = bad.transfer!.followUps.find((x) => x.referralId === C21.referralId)!;
    fu.ownerOrgId = 'org-qinghe';
    const violations = validateTransfer(bad);
    expect(violations.some((x) => x.code === 'TRANSFER_OWNER_MISMATCH')).toBe(true);
  });

  it('先收到退回、后确定移交方式时，未完成任务随责任改派', () => {
    const c = c21Case();
    const receipt = applyProviderReceipt({
      caseFile: c,
      referralId: C21.referralId,
      decision: 'returned',
      referenceNo: C21.returnReference,
      receivedAt: C21.returnAt,
      missingMaterials: ['行动能力评估'],
      supplementDue: C21.supplementDue,
      actorName: '康复服务方',
      orgId: 'org-rehab',
    });
    // 此时尚未激活移交方式，任务暂挂原机构
    const before = receipt.caseFile.transfer!.tasks.find((t) => t.referralId === C21.referralId)!;
    expect(before.ownerOrgId).toBe('org-qinghe');

    const plans = buildFollowUpPlan({
      c: receipt.caseFile,
      policy: 'transfer_on_move_in',
      originWorker: ORIGIN_WORKER,
      receivingWorker: RECEIVING_WORKER,
      clientNotified: '已告知客户后续由新机构负责。',
      clientNotifiedAt: '2026-06-01T12:00:00+08:00',
    });
    const activated = applyFollowUpPlan(receipt.caseFile, plans);
    const task = activated.transfer!.tasks.find((t) => t.referralId === C21.referralId)!;
    expect(task.ownerOrgId).toBe('org-xinqiao');
    expect(task.ownerName).toBe('孙丽');
    expect(validateTransfer(activated).some((v) => v.code === 'TRANSFER_OWNER_MISMATCH')).toBe(false);
  });

  it('任务持有机构与唯一责任不一致会被拦截', () => {
    const c = plan('transfer_on_move_in');
    const bad = structuredClone(c);
    const task: FollowUpTask = {
      id: 'task-bad',
      referralId: C21.referralId,
      kind: 'supplement_due',
      ownerOrgId: 'org-qinghe',
      ownerName: '林晓',
      dueAt: '2026-06-05',
      status: 'open',
      createdAt: '2026-06-02T10:00:00+08:00',
      note: '补齐行动能力评估',
      dedupeKey: 'task-mismatch',
    };
    bad.transfer!.tasks.push(task);
    const violations = validateTransfer(bad);
    expect(violations.some((x) => x.code === 'TRANSFER_OWNER_MISMATCH')).toBe(true);
  });

  it('非责任机构写入的联系记录会被不变量拦截', () => {
    const c = plan('transfer_on_move_in');
    const bad = structuredClone(c);
    const r = bad.referrals.find((x) => x.id === C21.referralId)!;
    r.timeline = r.timeline ?? [];
    r.timeline.push({
      id: 'evt-bad',
      referralId: r.id,
      at: '2026-06-03T11:00:00+08:00',
      recordedAt: '2026-06-03T11:00:00+08:00',
      orgId: 'org-qinghe',
      actorName: '林晓',
      kind: 'client_contact',
      summary: '原机构在责任已转交后仍尝试联系客户。',
    });
    const violations = validateTransfer(bad, { previous: c });
    expect(violations.some((x) => x.code === 'TRANSFER_CONTACT_BY_NON_OWNER')).toBe(true);
  });

  it('任务只允许持有机构完成', () => {    const c = plan('origin_keeps');
    const res = applyProviderReceipt({
      caseFile: c,
      referralId: C21.referralId,
      decision: 'returned',
      referenceNo: C21.returnReference,
      receivedAt: C21.returnAt,
      missingMaterials: ['行动能力评估'],
      supplementDue: C21.supplementDue,
      actorName: '康复服务方',
      orgId: 'org-rehab',
    });
    const task = res.caseFile.transfer!.tasks.find((t) => t.referralId === C21.referralId)!;
    const rejected = completeFollowUpTask(res.caseFile, task.id, 'org-xinqiao', '2026-06-04T09:00:00+08:00');
    expect('rejected' in rejected).toBe(true);
    const done = completeFollowUpTask(res.caseFile, task.id, 'org-qinghe', '2026-06-04T09:00:00+08:00');
    expect('caseFile' in done).toBe(true);
    const fu = findFollowUp((done as { caseFile: CaseFile }).caseFile.transfer, C21.referralId)!;
    expect(fu.nextAction).toBe('contact_client');
  });
});

describe('跨机构摘要范围', () => {
  it('两机构只能读到被授权摘要；客户联系仅对同时有家访历史的机构可见', () => {
    const base = plan('transfer_on_move_in');
    const c = replayLateSync(base, base.transfer!.pendingOffline!);
    const r = c.referrals.find((x) => x.id === C21.referralId)!;
    const originView = referralSummariesFor(c.transfer, r, 'org-qinghe');
    const receivingView = referralSummariesFor(c.transfer, r, 'org-xinqiao');
    const providerView = referralSummariesFor(c.transfer, r, 'org-rehab');
    const unknownView = referralSummariesFor(c.transfer, r, 'org-unknown');
    expect(originView.visible).toBe(true);
    expect(receivingView.visible).toBe(true);
    expect(providerView.visible).toBe(true);
    expect(unknownView.visible).toBe(false);
    expect(unknownView.summary).toMatch(/需在授权范围内/);

    // 服务方只被授予“转介摘要”，不能读取完整客户联系记录
    expect(canReadClientContact(c.transfer!.orgScopes, 'org-rehab')).toBe(false);
    const contactEv = r.timeline!.find((e) => e.kind === 'client_contact' || e.kind === 'late_sync')!;
    expect(visibleTimelineEvent(contactEv, c.transfer, 'org-rehab').summary).toMatch(/未在贵机构授权范围内/);
    // 原机构/新机构均有“家访历史”，可读全文
    expect(visibleTimelineEvent(contactEv, c.transfer, 'org-qinghe').summary).toBe(contactEv.summary);
  });
});

describe('两种方式回放对照', () => {
  it('两种方式全部核对通过，且唯一责任机构不同', () => {
    const both = comparePolicies();
    for (const r of [both.originKeeps, both.transferOnMoveIn]) {
      expect(r.violations).toHaveLength(0);
      expect(r.checks.every((c) => c.ok)).toBe(true);
      expect(r.duplicateReceipt.duplicate).toBe(true);
      expect(r.duplicateReceipt.newTaskCount).toBe(0);
      expect(r.close.allowed).toBe(false);
      expect(r.lateSyncChangedOwner).toBe(false);
    }
    const ownerOf = (r: typeof both.originKeeps) =>
      r.checks.find((c) => c.key === 'unique-owner')!.value;
    expect(ownerOf(both.originKeeps)).toMatch(/林晓/);
    expect(ownerOf(both.originKeeps)).toMatch(/清河/);
    expect(ownerOf(both.transferOnMoveIn)).toMatch(/孙丽/);
    expect(ownerOf(both.transferOnMoveIn)).toMatch(/新桥/);
  });

  it('回放时间线包含服务方退回、迟到同步与责任归属，共处一条线', () => {
    const r = runTransferReplay('origin_keeps');
    const r2 = r.caseFile.referrals.find((x) => x.id === C21.referralId)!;
    const timeline = sortedTimeline(r2);
    expect(timeline.some((e) => e.kind === 'provider_return')).toBe(true);
    expect(timeline.some((e) => e.lateSync)).toBe(true);
    expect(timeline.some((e) => e.kind === 'ownership_assigned' || e.kind === 'ownership_moved')).toBe(true);
    expect(timeline.some((e) => e.kind === 'client_contact' || e.kind === 'late_sync')).toBe(true);
  });

  it('两种方式都保证补齐截止日前有人处理（任务持有机构与期限）', () => {
    const both = comparePolicies();
    for (const r of [both.originKeeps, both.transferOnMoveIn]) {
      const task = r.caseFile.transfer!.tasks.find((t) => t.referralId === C21.referralId)!;
      expect(task.dueAt).toBe('2026-06-05');
      expect(['org-qinghe', 'org-xinqiao']).toContain(task.ownerOrgId);
      const fu = findFollowUp(r.caseFile.transfer, C21.referralId)!;
      expect(fu.nextContactDue <= '2026-06-05').toBe(true);
    }
  });
});
