import 'fake-indexeddb/auto';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  apiCommitCase,
  apiGetCase,
  apiRemoteScript,
  apiSupervisorDecision,
  ensureSeeded,
  setServerNetworkOnline,
} from '../src/mock/server';
import { ACCOUNTS } from '../src/config/accounts';
import { analyzeMerge, buildCandidate } from '../src/lib/merge';
import { validateCandidate } from '../src/lib/rules';
import type { CaseFile } from '../src/types';

const lin = ACCOUNTS[0];
const zhou = ACCOUNTS[1];
const wang = ACCOUNTS[2];

beforeAll(async () => {
  setServerNetworkOnline(true);
  await ensureSeeded(true);
});

describe('双标签同步服务端链路', () => {
  it('rev7 → B 改约 rev8 → 主管退回 rev9 → A 旧 base7 提交先 409，合并补事实后以 base9 提交成功，主管确认入计划', async () => {
    const v7 = await apiGetCase('case-chen', lin);
    expect(v7.rev).toBe(7);

    // B 改未来预约到周三
    await apiRemoteScript({
      actor: { id: zhou.id, name: zhou.name, role: zhou.role },
      tabId: 'tab-B',
      caseId: 'case-chen',
      action: 'reschedule',
      target: 'appt-next',
      summary: 'B 改约',
      mutate: (c) => {
        c.appointments.find((a) => a.id === 'appt-next')!.startAt = '2026-12-02T10:00:00+08:00';
      },
    });
    expect((await apiGetCase('case-chen', zhou)).rev).toBe(8);

    // 主管退回
    const ret = await apiSupervisorDecision({
      actor: wang,
      tabId: 'tab-W',
      caseId: 'case-chen',
      recordId: 'visit-main',
      decision: 'return',
      note: '请补充药品名称与漏服次数',
    });
    expect(ret.ok).toBe(true);
    expect((await apiGetCase('case-chen', wang)).rev).toBe(9);

    // A 的离线草稿
    const local: CaseFile = structuredClone(v7);
    const v = local.visits.find((x) => x.id === 'visit-main')!;
    v.observations += ' 现场看到周一、周三药格未动。';
    v.fulfillment = 'completed';
    v.serviceMinutes = 50;
    v.checkInAt = '2026-11-25T09:33:00+08:00';

    // 旧 base7 直接提交 → CONFLICT
    const first = await apiCommitCase({
      actor: lin,
      tabId: 'tab-A',
      caseId: 'case-chen',
      baseRev: 7,
      candidate: local,
    });
    expect(first.ok).toBe(false);
    if (first.ok || first.code !== 'CONFLICT') throw new Error('should be CONFLICT');
    expect(first.serverRev).toBe(9);

    // 三方分析 + 选择本地关联组 → 守卫拦截退回锁
    const current = first.current;
    const analysis = analyzeMerge('case-chen', v7, local, current, 'field');
    const corr = analysis.items.find((i) => i.kind === 'correlated')!;
    corr.decision = 'local';
    let candidate = buildCandidate(local, current, analysis);
    expect(
      validateCandidate(candidate, { current }).some((x) => x.code === 'GOAL_RETURNED_LOCK'),
    ).toBe(true);

    // 补事实后，以服务器 rev9 为乐观锁基准重提
    corr.manual['visits[visit-main].supplementNote'] = '补充：药盒两格未动，药名为苯磺酸氨氯地平。';
    candidate = buildCandidate(local, current, analysis);
    const second = await apiCommitCase({
      actor: lin,
      tabId: 'tab-A',
      caseId: 'case-chen',
      baseRev: 9,
      candidate,
      auditEvents: [
        {
          actorId: 'sync-engine',
          actorName: '同步引擎',
          actorRole: 'sync-engine',
          tabId: 'tab-A',
          action: 'three-way-merge',
          target: 'case-chen',
          summary: '字段级合并：保留 A 观察、保留 B 周三预约，关联组人工裁决为补充后重提。',
        },
      ],
    });
    if (!second.ok) {
      throw new Error(`commit should succeed: ${JSON.stringify(second)}`);
    }
    expect(second.case.rev).toBe(10);

    // 主管确认进入计划
    const conf = await apiSupervisorDecision({
      actor: wang,
      tabId: 'tab-W',
      caseId: 'case-chen',
      recordId: 'visit-main',
      decision: 'confirm',
      note: '事实充分',
      ownerName: '林晓',
    });
    expect(conf.ok).toBe(true);
    if (conf.ok) {
      expect(conf.case.rev).toBe(11);
      expect(conf.case.plan.length).toBeGreaterThanOrEqual(2);
      expect(conf.case.visits.find((x) => x.id === 'visit-main')!.status).toBe('confirmed');
    }
  });

  it('断网时 apiGetCase 抛 NETWORK', async () => {
    setServerNetworkOnline(false);
    await expect(apiGetCase('case-chen', lin)).rejects.toMatchObject({ code: 'NETWORK' });
    setServerNetworkOnline(true);
  });
});
