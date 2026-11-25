import { describe, expect, it } from 'vitest';
import { chenCase } from '../src/data/seed';
import { analyzeMerge, buildCandidate, unresolvedItems } from '../src/lib/merge';
import { validateCandidate } from '../src/lib/rules';
import type { CaseFile, MergeAnalysis, MergeItem } from '../src/types';

// 构造题目指定的 9:00 rev7 样例三方文档
function triad() {
  const base = chenCase(); // rev 7
  const localA: CaseFile = structuredClone(base);
  const remoteBRev9: CaseFile = structuredClone(base);

  // A 在地下室：补观察、签到、时长、履约结论（旧标签草稿）
  const v = localA.visits.find((x) => x.id === 'visit-main')!;
  v.observations +=
    ' 现场核实：药盒周一、周三两格未动；老人称“忘了吃过没有”。助餐午餐吃完约七成。已当场演示分格药盒。';
  v.checkInAt = '2026-11-25T09:32:00+08:00';
  v.checkOutAt = '2026-11-25T10:28:00+08:00';
  v.serviceMinutes = 56;
  v.fulfillment = 'completed';

  // B 在线：把未来预约从周五改到下周三 10:00（rev 8）
  const appt = remoteBRev9.appointments.find((a) => a.id === 'appt-next')!;
  appt.startAt = '2026-12-02T10:00:00+08:00';

  // 主管随后退回当前服务目标（rev 9）
  const goal = remoteBRev9.goals.find((g) => g.id === 'goal-meal')!;
  goal.publishState = 'returned';
  goal.returnNote = '请补充药品名称、漏服次数，以及连续三日进食观察。';
  goal.returnedByName = '王敏';
  goal.returnedAt = Date.parse('2026-11-25T10:05:00+08:00');
  const rv = remoteBRev9.visits.find((x) => x.id === 'visit-main')!;
  rv.status = 'returned';
  rv.supervisorNote = goal.returnNote;
  remoteBRev9.rev = 9;

  return { base, localA, remote: remoteBRev9 };
}

function findItem(a: MergeAnalysis, pred: (i: MergeItem) => boolean): MergeItem {
  const it = a.items.find(pred);
  if (!it) throw new Error('merge item not found');
  return it;
}

describe('字段级三方合并 —— 题目标准样例', () => {
  it('观察记录作为独立字段自动保留本地', () => {
    const { base, localA, remote } = triad();
    const a = analyzeMerge('case-chen', base, localA, remote, 'field');
    const obs = findItem(a, (i) => i.paths.length === 1 && i.paths[0] === 'visits[visit-main].observations');
    expect(obs.auto).toBe('auto-local');
    expect(obs.decision).toBe('local');
  });

  it('未来预约时间作为独立字段自动采用远端周三', () => {
    const { base, localA, remote } = triad();
    const a = analyzeMerge('case-chen', base, localA, remote, 'field');
    const appt = findItem(a, (i) => i.paths[0] === 'appointments[appt-next].startAt');
    expect(appt.auto).toBe('auto-remote');
    const row = a.paths.find((p) => p.path === 'appointments[appt-next].startAt')!;
    expect(String(row.remote)).toContain('2026-12-02');
  });

  it('服务目标/履约关联组即使两侧改不同子字段也必须人工整体裁决', () => {
    const { base, localA, remote } = triad();
    const a = analyzeMerge('case-chen', base, localA, remote, 'field');
    const corr = findItem(a, (i) => i.kind === 'correlated');
    expect(corr.auto).toBe('needs-decision');
    expect(corr.decision).toBeNull();
    expect(unresolvedItems(a)).toHaveLength(1);
    // 组内同时包含目标发布状态与履约/记录状态
    expect(corr.paths).toEqual(expect.arrayContaining(['goals[goal-meal].publishState']));
    expect(corr.paths).toEqual(expect.arrayContaining(['visits[visit-main].fulfillment']));
    expect(corr.paths).toEqual(expect.arrayContaining(['visits[visit-main].status']));
  });

  it('未裁决时不允许构造提交；强行选本地会被退回锁拦截，补事实后放行', () => {
    const { base, localA, remote } = triad();
    const a = analyzeMerge('case-chen', base, localA, remote, 'field');

    // 默认决策下仍有未解决项
    expect(unresolvedItems(a).length).toBeGreaterThan(0);

    const corr = findItem(a, (i) => i.kind === 'correlated');
    corr.decision = 'local'; // 社工坚持用本地整组重新发布
    expect(unresolvedItems(a)).toHaveLength(0);

    const candidate = buildCandidate(localA, remote, a);
    const blocked = validateCandidate(candidate, { current: remote, now: 1_764_000_000_000 });
    expect(blocked.some((v) => v.code === 'GOAL_RETURNED_LOCK')).toBe(true);
    expect(blocked.some((v) => v.code === 'MISSING_SUPPLEMENT')).toBe(true);

    // 社工在裁决界面回应退回意见，补充事实
    corr.manual['visits[visit-main].supplementNote'] =
      '已补充：药盒周一、周三两格未动（每周漏服约 2 次）；连续三日午餐进食约七成；药品为苯磺酸氨氯地平。';
    const candidate2 = buildCandidate(localA, remote, a);
    const after = validateCandidate(candidate2, { current: remote });
    expect(after.some((v) => v.code === 'GOAL_RETURNED_LOCK')).toBe(false);
    expect(after.some((v) => v.code === 'MISSING_SUPPLEMENT')).toBe(false);
  });

  it('选择保留远端：接受主管退回，观察记录仍作为独立本地项保留', () => {
    const { base, localA, remote } = triad();
    const a = analyzeMerge('case-chen', base, localA, remote, 'field');
    const corr = findItem(a, (i) => i.kind === 'correlated');
    corr.decision = 'remote';
    const candidate = buildCandidate(localA, remote, a);
    expect(candidate.goals.find((g) => g.id === 'goal-meal')!.publishState).toBe('returned');
    expect(candidate.visits.find((v) => v.id === 'visit-main')!.status).toBe('returned');
    // 观察字段决策仍为 local
    expect(candidate.visits.find((v) => v.id === 'visit-main')!.observations).toContain('分格药盒');
  });
});

describe('整次家访确认单元', () => {
  it('所有记录字段+关联目标+被捆绑的未来预约形成一个整包裁决项', () => {
    const { base, localA, remote } = triad();
    // A 离线时还把下次改约提议（周四）并入了确认单元
    const av = localA.visits.find((v) => v.id === 'visit-main')!;
    av.bundledAppointmentId = 'appt-next';
    localA.appointments.find((x) => x.id === 'appt-next')!.startAt = '2026-12-03T15:00:00+08:00';

    const a = analyzeMerge('case-chen', base, localA, remote, 'unit');
    const unit = findItem(a, (i) => i.kind === 'unit');
    expect(unit.auto).toBe('needs-decision');
    // 无关的约访改动也在单元内等待
    expect(unit.paths).toContain('appointments[appt-next].startAt');
    expect(unit.paths).toContain('visits[visit-main].observations');
    expect(unit.paths).toContain('goals[goal-meal].publishState');

    // 该预约时间不应再作为独立字段项出现
    const standalone = a.items.find(
      (i) => i.kind === 'independent' && i.paths.includes('appointments[appt-next].startAt'),
    );
    expect(standalone).toBeUndefined();
  });
});

describe('预约先取消、签到后上传', () => {
  it('迟到签到只能形成待核材料，不能把 canceled 改成 fulfilled', () => {
    const base = chenCase();
    const local: CaseFile = structuredClone(base);
    const remote: CaseFile = structuredClone(base);

    remote.appointments.find((x) => x.id === 'appt-main')!.status = 'canceled';
    remote.appointments.find((x) => x.id === 'appt-main')!.cancelReason = '家属 9:10 来电改期';
    remote.rev = 8;

    const v = local.visits.find((x) => x.id === 'visit-main')!;
    v.checkInAt = '2026-11-25T09:41:00+08:00';
    v.serviceMinutes = 20;
    v.observations = '迟到 11 分钟到场，敲门无人应答，邻居称老人被侄子接走。';
    v.fulfillment = 'completed';

    const a = analyzeMerge('case-chen', base, local, remote, 'field');
    // 所有自动项采用默认决策后构造候选
    for (const it of a.items) if (it.decision === null) it.decision = 'local';
    const candidate = buildCandidate(local, remote, a);

    const violations = validateCandidate(candidate, { current: remote });
    expect(violations.some((x) => x.code === 'APPT_CANCELED_CHECKIN')).toBe(true);
    expect(violations.some((x) => x.code === 'FULFILLMENT_NEEDS_FACTS')).toBe(true);
    // 远端取消态在默认合并中保留
    expect(candidate.appointments.find((x) => x.id === 'appt-main')!.status).toBe('canceled');
  });
});
