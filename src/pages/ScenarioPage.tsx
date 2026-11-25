import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../state/AppStore';
import { Badge } from '../components/ui';
import { chenCase } from '../data/seed';
import { analyzeMerge } from '../lib/merge';
import { formatValue } from '../lib/labels';
import { grantState } from '../lib/rules';
import RestrictedContact from '../components/RestrictedContact';
import { comparePolicies, timelineOf, type ReplayResult } from '../lib/transferFlow';
import { fullTime } from '../lib/time';

type SampleKey = 'merge' | 'cancel' | 'grant' | 'transfer';

export default function ScenarioPage() {
  const [sample, setSample] = useState<SampleKey>('merge');
  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">样例演练与双标签重放</h1>
          <div className="page-sub">
            所有数据与“远端接口”都在本浏览器内（IndexedDB 共享远端库 + BroadcastChannel）。可先阅读逐步推演，再点“一键布置并打开真实冲突中心”动手复现。
          </div>
        </div>
        <div className="head-actions">
          <button className="btn" onClick={() => window.open(`${location.pathname}?as=lin#/case/case-chen`, '_blank')}>
            开标签 A · 林晓
          </button>
          <button className="btn" onClick={() => window.open(`${location.pathname}?as=zhou#/case/case-chen`, '_blank')}>
            开标签 B · 周明
          </button>
          <button className="btn" onClick={() => window.open(`${location.pathname}?as=wang#/supervisor`, '_blank')}>
            开主管标签 · 王敏
          </button>
          <button className="btn" onClick={() => window.open(`${location.pathname}?as=sun#/case/case-c21`, '_blank')}>
            开新机构标签 · 孙丽
          </button>
        </div>
      </div>

      <div className="tabs" role="tablist" aria-label="样例切换">
        {(
          [
            ['merge', '① 9:00 rev7 协作合并样例'],
            ['cancel', '② 预约取消 × 迟到签到'],
            ['grant', '③ 撤权与授权到期'],
            ['transfer', '④ 迁居移交 × 唯一跟进责任（C-21）'],
          ] as [SampleKey, string][]
        ).map(([k, label]) => (
          <button
            key={k}
            role="tab"
            aria-selected={sample === k}
            className="tab-btn"
            onClick={() => setSample(k)}
          >
            {label}
          </button>
        ))}
      </div>

      {sample === 'merge' && <MergeSample />}
      {sample === 'cancel' && <CancelSample />}
      {sample === 'grant' && <GrantSample />}
      {sample === 'transfer' && <TransferSample />}
    </>
  );
}

/* ================= 样例一：rev7 协作合并 ================= */

function MergeSample() {
  const app = useApp();
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState('');

  const triad = useMemo(() => buildTriad(), []);
  const fieldAnalysis = useMemo(
    () => analyzeMerge('case-chen', triad.base, triad.localA, triad.remote9, 'field'),
    [triad],
  );
  const unitAnalysis = useMemo(() => {
    const localUnit = structuredClone(triad.localA);
    const v = localUnit.visits.find((x) => x.id === 'visit-main')!;
    v.bundledAppointmentId = 'appt-next';
    localUnit.appointments.find((a) => a.id === 'appt-next')!.startAt = '2026-12-03T15:00:00+08:00';
    return analyzeMerge('case-chen', triad.base, localUnit, triad.remote9, 'unit');
  }, [triad]);

  async function plantLive(variant: 'field' | 'unit') {
    setBusy(variant);
    try {
      await app.resetAllDemo();
      app.loginAs('lin');
      // 1) 先以 rev7 为基线在本标签植入 A 的离线草稿
      await app.patchDraft('case-chen', 'A 地下室补充观察并签到', (doc, env) => {
        const v = doc.visits.find((x) => x.id === 'visit-main')!;
        v.observations +=
          ' 现场核实：药盒周一、周三两格未动；老人称“忘了吃过没有”。助餐午餐吃完约七成。';
        v.checkInAt = '2026-11-25T09:32:00+08:00';
        v.checkOutAt = '2026-11-25T10:28:00+08:00';
        v.serviceMinutes = 56;
        v.fulfillment = 'completed';
        if (variant === 'unit') {
          v.bundledAppointmentId = 'appt-next';
          doc.appointments.find((a) => a.id === 'appt-next')!.startAt = '2026-12-03T15:00:00+08:00';
          env.granularity = 'unit';
        }
      });
      // 2) 另一社工 B 在线改约 → rev8
      await app.remoteScript({
        actor: { id: 'zhou', name: '周明', role: 'social_worker' },
        tabId: 'tab-B-demo',
        caseId: 'case-chen',
        action: 'reschedule',
        target: 'appt-next',
        summary: '周明把未来预约从周五 14:00 改到周三（12-02）10:00。',
        mutate: (c) => {
          c.appointments.find((a) => a.id === 'appt-next')!.startAt = '2026-12-02T10:00:00+08:00';
        },
      });
      // 3) 主管退回当前服务目标 → rev9
      await app.remoteScript({
        actor: { id: 'wang', name: '王敏', role: 'supervisor' },
        tabId: 'tab-W-demo',
        caseId: 'case-chen',
        action: 'supervisor-return',
        target: 'goal-meal',
        summary: '主管王敏退回目标「规律进食与安全用药」：请补充药品名称、漏服次数与连续三日进食观察。',
        mutate: (c) => {
          const g = c.goals.find((x) => x.id === 'goal-meal')!;
          g.publishState = 'returned';
          g.returnNote = '请补充药品名称、漏服次数，以及连续三日进食观察。';
          g.returnedByName = '王敏';
          g.returnedAt = Date.now();
          const v = c.visits.find((x) => x.id === 'visit-main')!;
          v.status = 'returned';
          v.supervisorNote = g.returnNote;
          c.rev = 9;
        },
      });
      navigate('/case/case-chen/conflict');
    } finally {
      setBusy('');
    }
  }

  return (
    <div className="theater-layout">
      <aside>
        <div className="card">
          <div className="card-hd">
            <h3>逐步脚本</h3>
          </div>
          <div className="card-bd">
            {SCRIPT.map((s, i) => (
              <div key={i} className={`script-step ${step === i ? 'active' : ''} ${step > i ? 'done' : ''}`}>
                <span className="step-num">{step > i ? '✓' : i + 1}</span>
                {s}
              </div>
            ))}
            <div className="flex mt8">
              <button className="btn btn-sm" disabled={step === 0} onClick={() => setStep((s) => s - 1)}>
                上一步
              </button>
              {step < SCRIPT.length - 1 ? (
                <button className="btn btn-sm btn-primary" onClick={() => setStep((s) => s + 1)}>
                  下一步
                </button>
              ) : (
                <button className="btn btn-sm" onClick={() => setStep(0)}>
                  重播
                </button>
              )}
            </div>
          </div>
        </div>
        <div className="card">
          <div className="card-hd">
            <h3>一键真实复现</h3>
          </div>
          <div className="card-bd flex" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
            <button className="btn btn-primary" disabled={busy !== ''} onClick={() => plantLive('field')}>
              {busy === 'field' ? <span className="spinner" /> : null}
              植入 A 草稿并打开字段级冲突中心
            </button>
            <button className="btn" disabled={busy !== ''} onClick={() => plantLive('unit')}>
              {busy === 'unit' ? <span className="spinner" /> : null}
              植入“整单元 + 周四改约”草稿并打开
            </button>
            <button className="btn btn-warn" onClick={() => app.resetAllDemo()}>
              重置全部模拟数据到 rev7
            </button>
            <p className="small muted" style={{ marginBottom: 0 }}>
              也可以用页顶按钮开两个标签分别登录 A/B，手动操作观察跨标签广播。
            </p>
          </div>
        </div>
      </aside>

      <section>
        {step >= 0 && <Step0 triad={triad} />}
        {step >= 1 && <Step1 />}
        {step >= 2 && <Step2 />}
        {step >= 3 && <Step3 />}
        {step >= 4 && <FieldMergeResult analysis={fieldAnalysis} />}
        {step >= 5 && (
          <>
            <Adjudication />
            <UnitMergeResult analysis={unitAnalysis} />
            <AuditSubjects />
            <FinalPlan />
          </>
        )}
      </section>
    </div>
  );
}

const SCRIPT = [
  '9:00 两个标签页都打开陈桂兰案卷，读取共同版本 rev 7：目标待确认、未来预约为周五 14:00。',
  'A（林晓）在地下室断网：补充用药观察、9:32 签到、56 分钟、判定已完成，全部存本机，基线 rev 7。',
  'B（周明）在线：把未来预约改到下周三 10:00，远端前进到 rev 8，并广播 remote-changed。',
  '主管王敏审阅后退回当前服务目标：“请补充药品名称、漏服次数、连续三日进食观察”，远端 rev 9。',
  'A 恢复网络后同步遇 409：WebWorker 做三方比较 —— 字段级结果：观察保留 A、预约保留 B 的周三；目标/履约关联组必须人工整体裁决。',
  '裁决与后续：坚持旧草稿直接重发会被 GOAL_RETURNED_LOCK 拦截；按退回意见补事实后才能作为 rev10 重提，主管确认成 rev11 并写入最终计划。整次单元模式下，连无关改约也在同一个包内等待。',
];

function Step0({ triad }: { triad: Triad }) {
  return (
    <div className="card">
      <div className="card-hd">
        <h3>步骤 1 · 9:00 共同基线 rev 7</h3>
        <Badge tone="gray">两个标签页读取同一版本</Badge>
      </div>
      <div className="card-bd table-wrap">
        <table>
          <tbody>
            <tr>
              <th>服务对象</th>
              <td>陈桂兰，78 岁，清河街道第三网格，重点关注（全部虚构）</td>
            </tr>
            <tr>
              <th>当前服务目标</th>
              <td>
                规律进食与安全用药 —— 状态 <Badge tone="amber">待主管确认 in_review</Badge>
              </td>
            </tr>
            <tr>
              <th>未来预约 appt-next</th>
              <td>{formatValue('appointments[x].startAt', triad.base.appointments.find((a) => a.id === 'appt-next')!.startAt)}</td>
            </tr>
            <tr>
              <th>观察基线</th>
              <td>{triad.base.visits[0]?.observations ?? triad.base.visits.find((v) => v.id === 'visit-main')?.observations}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Step1() {
  return (
    <div className="card">
      <div className="card-hd">
        <h3>步骤 2 · A 在地下室离线编辑</h3>
        <Badge tone="amber">本地待同步 · baseRev=7</Badge>
      </div>
      <div className="card-bd small">
        <ul>
          <li>观察记录追加：药盒周一、周三两格未动；助餐约吃七成；现场演示分格药盒。</li>
          <li>签到 09:32 / 签退 10:28 / 实际服务 56 分钟 / 履约=已完成。</li>
          <li>这些编辑写入本标签 IndexedDB 草稿与 outbox，每条操作记录“依据远端 v7”。</li>
        </ul>
      </div>
    </div>
  );
}

function Step2() {
  return (
    <div className="card">
      <div className="card-hd">
        <h3>步骤 3 · B 在线把未来预约改到周三（rev 8）</h3>
        <Badge tone="blue">remote-only 字段</Badge>
      </div>
      <div className="card-bd small">
        周五 11-27 14:00 → <b>周三 12-02 10:00</b>。模拟接口在 IndexedDB 事务中递增 rev、写 history@8 与审计，
        并通过 BroadcastChannel 通知其他标签。
      </div>
    </div>
  );
}

function Step3() {
  return (
    <div className="card">
      <div className="card-hd">
        <h3>步骤 4 · 主管退回当前服务目标（rev 9）</h3>
        <Badge tone="red">GOAL_RETURNED_LOCK 生效</Badge>
      </div>
      <div className="card-bd return-note" style={{ margin: 0 }}>
        “请补充药品名称、漏服次数，以及连续三日进食观察。” —— 王敏（主管）
        <div className="small mt8">
          goal-meal.publishState → returned；visit-main.status → returned。此后任何基于退回前版本、试图把目标直接发回
          in_review 的旧草稿都会被服务端守卫拒绝。
        </div>
      </div>
    </div>
  );
}

function MergeResultTable({ analysis }: { analysis: ReturnType<typeof analyzeMerge> }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>裁决项</th>
            <th>类型</th>
            <th>自动判定</th>
            <th>涉及路径（示例）</th>
          </tr>
        </thead>
        <tbody>
          {analysis.items.map((i) => (
            <tr key={i.id}>
              <td>
                <b>{i.kind === 'correlated' ? '目标↔履约关联组' : i.kind === 'unit' ? '整次家访单元' : i.paths[0]}</b>
              </td>
              <td>{i.kind}</td>
              <td>
                {i.auto === 'needs-decision' ? (
                  <Badge tone="red">必须人工裁决</Badge>
                ) : i.auto === 'auto-local' ? (
                  <Badge tone="green">自动保留本地</Badge>
                ) : i.auto === 'auto-remote' ? (
                  <Badge tone="blue">自动采用远端</Badge>
                ) : (
                  <Badge tone="purple">两侧一致</Badge>
                )}
              </td>
              <td className="small mono">{i.paths.slice(0, 4).join('；')}{i.paths.length > 4 ? ` 等 ${i.paths.length} 项` : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FieldMergeResult({ analysis }: { analysis: ReturnType<typeof analyzeMerge> }) {
  return (
    <div className="card">
      <div className="card-hd">
        <h3>步骤 5 · 两类合并结果之一：字段级三方比较</h3>
        <Badge tone="green">恢复工作最快，两项无关修改同时保留</Badge>
      </div>
      <div className="card-bd">
        <MergeResultTable analysis={analysis} />
        <div className="grid-3 mt16">
          <div className="entity" style={{ margin: 0 }}>
            <b>① 观察记录</b>
            <p className="small" style={{ margin: '6px 0 0' }}>
              仅 A 修改（local-only）→ <Badge tone="green">自动保留本地</Badge>
            </p>
          </div>
          <div className="entity" style={{ margin: 0 }}>
            <b>② 未来预约时间</b>
            <p className="small" style={{ margin: '6px 0 0' }}>
              仅 B 修改（remote-only）→ <Badge tone="blue">自动采用周三</Badge>
            </p>
          </div>
          <div className="entity" style={{ margin: 0 }}>
            <b>③ 目标/履约/状态组</b>
            <p className="small" style={{ margin: '6px 0 0' }}>
              两侧都动了关联字段 → <Badge tone="red">整组人工裁决</Badge>
            </p>
          </div>
        </div>
        <p className="small muted mt8" style={{ marginBottom: 0 }}>
          必须人工裁决的字段：<code>goals[goal-meal].publishState</code>、
          <code>goals[goal-meal].returnNote</code>、<code>visits[visit-main].status</code>、
          <code>.fulfillment</code>、<code>.confirmedGoalText</code>、<code>.supplementNote</code>。
        </p>
      </div>
    </div>
  );
}

function UnitMergeResult({ analysis }: { analysis: ReturnType<typeof analyzeMerge> }) {
  const unit = analysis.items.find((i) => i.kind === 'unit');
  return (
    <div className="card">
      <div className="card-hd">
        <h3>步骤 6b · 两类合并结果之二：整次家访确认单元</h3>
        <Badge tone="purple">主管一次看到完整上下文</Badge>
      </div>
      <div className="card-bd">
        <MergeResultTable analysis={analysis} />
        <div className="banner warn mt8" style={{ marginBottom: 0 }}>
          <div>
            在该模式下，<code>visits[visit-main].*</code> 全部字段、关联目标状态，以及 A 离线时捆绑的未来预约
            （本地提议周四 12-03 15:00 vs B 已提交的周三 12-02 10:00）同属一个裁决单元（共 {unit?.paths.length}{' '}
            个路径）。在主管对整包给出结论前，<b>包括无关改约在内的所有内容都不会单独生效</b>
            ——这是“上下文完整”所付出的等待代价。
          </div>
        </div>
      </div>
    </div>
  );
}

function Adjudication() {
  return (
    <div className="card">
      <div className="card-hd">
        <h3>步骤 6a · 人工裁决与重新校验</h3>
      </div>
      <div className="card-bd small">
        <ol style={{ margin: 0, paddingLeft: 18 }}>
          <li>
            若 A 选择“将本地关联组作为新版本提交”但不补退回要求的事实 → 服务端返回{' '}
            <Badge tone="red">GOAL_RETURNED_LOCK / MISSING_SUPPLEMENT</Badge>，不能越过退回重新发布（自动化测试已断言）。
          </li>
          <li>
            A 在裁决界面填写 <code>supplementNote</code>：药盒周一/周三两格未动、每周漏服约 2 次、药名苯磺酸氨氯地平、连续三日进食约七成。
          </li>
          <li>
            重新校验通过后，候选以远端 <b>rev 9</b> 为乐观锁基准提交 → 新 <b>rev 10</b>，审计同时写入 sync-engine
            的三方合并条目与林晓的裁决条目。
          </li>
          <li>主管王敏确认 → <b>rev 11</b>，目标 confirmed，计划新增一条来源 visit-main 的条目。</li>
        </ol>
      </div>
    </div>
  );
}

function AuditSubjects() {
  return (
    <div className="card">
      <div className="card-hd">
        <h3>审计主体（谁做了什么决定）</h3>
      </div>
      <div className="card-bd table-wrap">
        <table>
          <thead>
            <tr>
              <th>时刻</th>
              <th>审计主体</th>
              <th>动作</th>
              <th>版本</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>09:00</td>
              <td>林晓 / 周明（两个 tabId）</td>
              <td>读取共同基线（演示中可写读取审计）</td>
              <td>v7</td>
            </tr>
            <tr>
              <td>地下室</td>
              <td>林晓（tab-A）</td>
              <td>本地草稿 + outbox（baseRev=7），不产生远端版本</td>
              <td>—</td>
            </tr>
            <tr>
              <td>约 09:50</td>
              <td>周明（tab-B）</td>
              <td>reschedule appt-next → 周三 10:00</td>
              <td>v8</td>
            </tr>
            <tr>
              <td>10:05</td>
              <td>王敏（主管 tab-W）</td>
              <td>supervisor-return goal-meal / visit-main</td>
              <td>v9</td>
            </tr>
            <tr>
              <td>恢复网络</td>
              <td>sync-engine（WebWorker）</td>
              <td>three-way-analysis：自动项与待裁决项判定</td>
              <td>7/9</td>
            </tr>
            <tr>
              <td>裁决后</td>
              <td>林晓（tab-A）</td>
              <td>conflict-resolution + supplement，重新校验通过后提交</td>
              <td>v10</td>
            </tr>
            <tr>
              <td>随后</td>
              <td>王敏（主管）</td>
              <td>supervisor-confirm，写入最终服务计划</td>
              <td>v11</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FinalPlan() {
  return (
    <div className="card">
      <div className="card-hd">
        <h3>最终计划（预期）</h3>
        <Badge tone="green">两项现场发现都保留，且状态自洽</Badge>
      </div>
      <div className="card-bd small">
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          <li>计划保留 11-18 已确认的“跌倒预防”条目。</li>
          <li>
            新增“规律进食与安全用药”条目：依据 11-25 家访（含漏服次数、药名、三日进食观察），责任社工林晓，主管王敏确认。
          </li>
          <li>日程采用周明改的周三 12-02 10:00；林晓的用药/进食观察一字不丢。</li>
          <li>转介回执与提醒没有被当作服务完成；履约结论由登记事实支撑。</li>
        </ul>
      </div>
    </div>
  );
}

/* ================= 样例二：取消 × 签到 ================= */

function CancelSample() {
  const app = useApp();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);

  async function plant() {
    setBusy(true);
    try {
      await app.resetAllDemo();
      app.loginAs('lin');
      // 先植入基于 rev7 的迟到签到草稿
      await app.patchDraft('case-chen', '9:41 迟到签到（离线）', (doc) => {
        const v = doc.visits.find((x) => x.id === 'visit-main')!;
        v.checkInAt = '2026-11-25T09:41:00+08:00';
        v.serviceMinutes = 20;
        v.observations = '迟到 11 分钟到场，敲门无人应答，邻居称老人被侄子接走。';
        v.fulfillment = 'completed';
      });
      // 远端此前已取消 appt-main
      await app.remoteScript({
        actor: { id: 'family-desk', name: '调度台（家属来电）', role: 'system' },
        tabId: 'desk',
        caseId: 'case-chen',
        action: 'appointment-cancel-remote',
        target: 'appt-main',
        summary: '家属 9:10 来电取消 9:30 家访预约。',
        mutate: (c) => {
          const a = c.appointments.find((x) => x.id === 'appt-main')!;
          a.status = 'canceled';
          a.cancelReason = '家属 9:10 来电改期';
        },
      });
      navigate('/case/case-chen/conflict');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <div className="card-hd">
        <h3>预约先取消、签到后离线上传</h3>
        <button className="btn btn-primary" disabled={busy} onClick={plant}>
          {busy ? <span className="spinner" /> : null}
          一键布置并打开冲突中心
        </button>
      </div>
      <div className="card-bd small">
        <ol style={{ margin: 0, paddingLeft: 18 }}>
          <li>远端 appt-main 状态先变为 <Badge tone="red">canceled</Badge>。</li>
          <li>A 离线状态下 9:41 才签到并尝试判定“已完成”，草稿基线仍是 rev7（scheduled）。</li>
          <li>同步三方合并时，预约状态为 remote-only，默认保留远端 canceled；签到字段保留本地。</li>
          <li>
            实时校验给出 <code>APPT_CANCELED_CHECKIN</code> 与 <code>FULFILLMENT_NEEDS_FACTS</code>：
            提供“一键修正为待核材料”，将 <code>materialFlag=pending_verification</code> 并清空 completed。
          </li>
          <li>
            <b>结果：</b>预约永远不会被旧草稿改回 scheduled/fulfilled；签到只形成待主管/调度核实的材料。
          </li>
        </ol>
      </div>
    </div>
  );
}

/* ================= 样例三：撤权 / 到期 ================= */

function GrantSample() {
  const app = useApp();
  const g = app.grants.find((x) => x.caseId === 'case-chen');
  const now = app.now;
  const states = [
    { t: 'T0 授权时刻', d: 0 },
    { t: 'T+10 秒', d: 10_000 },
    { t: 'T+20 秒（到期）', d: 20_000 },
    { t: '到期后 1 小时仍离线', d: 3_600_000 },
  ];
  const baseExpiry = g?.expiresAt ?? now + 20_000;
  const baseIssued = g?.issuedAt ?? now;

  return (
    <div className="grid-2">
      <div className="card">
        <div className="card-hd">
          <h3>真实组件：申请 20 秒授权并观察自动清除</h3>
        </div>
        <div className="card-bd">
          <RestrictedContact caseId="case-chen" />
          <div className="flex mt16">
            <button
              className="btn btn-danger"
              onClick={() => {
                const latest = app.grants.filter((x) => x.caseId === 'case-chen').sort((a, b) => b.issuedAt - a.issuedAt)[0];
                if (latest && !latest.revoked) app.revokeGrant(latest.id, '家属在另一通道撤回授权');
                else app.pushToast('当前没有可撤回的有效授权，请先申请一个短时效授权', 'warn');
              }}
            >
              ⚡ 模拟家属远端撤权（广播到全部标签）
            </button>
          </div>
          <p className="small muted mt8">
            测试方法：本标签申请授权后，用页顶按钮开第二个标签并登录同一社工，在任一标签点“模拟家属撤权”，
            另一标签会立即遮蔽、删除 IndexedDB sensitive 记录并尝试清空剪贴板。
          </p>
        </div>
      </div>

      <div>
        <div className="card">
          <div className="card-hd">
            <h3>到期凭据状态表（确定性规则）</h3>
          </div>
          <div className="card-bd table-wrap">
            <table>
              <thead>
                <tr>
                  <th>观察点</th>
                  <th>凭据状态</th>
                  <th>界面 / 缓存行为</th>
                </tr>
              </thead>
              <tbody>
                {states.map((s) => {
                  const checkAt = baseIssued + s.d;
                  const fakeGrant = g ? { ...g, expiresAt: baseExpiry } : undefined;
                  const st = g ? grantState(fakeGrant, checkAt) : s.d === 0 ? 'valid（示例）' : 'expired（示例）';
                  return (
                    <tr key={s.t}>
                      <td>{s.t}</td>
                      <td>
                        <Badge tone={st === 'valid' ? 'green' : st === 'revoked' ? 'red' : 'amber'}>{String(st)}</Badge>
                      </td>
                      <td className="small">
                        {st === 'valid'
                          ? '显示真值与复制按钮，sensitive 记录与 expiresAt 绑定。'
                          : '立即遮蔽；主线程/Worker 清扫 expiresAt<=now 的持久记录；离线也执行。'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
        <div className="banner info">
          边界承诺：系统不声称能即时擦除一台离线设备。撤权消息只能到达在线标签；离线设备的暴露窗口由短时效、
          明确 <code>expiresAt</code> 的凭据约束，到期后本地强制清除。
        </div>
      </div>
    </div>
  );
}

/* ================= 样例四：迁居移交 × 唯一跟进责任 ================= */

function TransferSample() {
  const app = useApp();
  const navigate = useNavigate();
  const [policy, setPolicy] = useState<'origin_keeps' | 'transfer_on_move_in'>('origin_keeps');
  const [busy, setBusy] = useState(false);

  const both = useMemo(() => comparePolicies(), []);
  const current: ReplayResult = policy === 'origin_keeps' ? both.originKeeps : both.transferOnMoveIn;
  const other: ReplayResult = policy === 'origin_keeps' ? both.transferOnMoveIn : both.originKeeps;
  const timeline = useMemo(() => timelineOf(current), [current]);
  const allOk = current.checks.every((c) => c.ok) && current.violations.length === 0;

  function openCase() {
    setBusy(true);
    try {
      app.loginAs('lin');
      navigate('/case/case-c21');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="transfer-sample">
      <div className="card">
        <div className="card-hd">
          <h3>样例 C-21 · 长者迁居后的唯一跟进责任</h3>
          <span className="flex">
            <button className="btn btn-sm" onClick={() => setPolicy('origin_keeps')} aria-pressed={policy === 'origin_keeps'}>
              按原机构续办回放
            </button>
            <button className="btn btn-sm" onClick={() => setPolicy('transfer_on_move_in')} aria-pressed={policy === 'transfer_on_move_in'}>
              按迁入日转给新机构回放
            </button>
            <button className="btn btn-sm btn-primary" onClick={openCase} disabled={busy}>
              打开 C-21 个案页
            </button>
          </span>
        </div>
        <div className="card-bd small">
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            <li>C-21（卢凤仪，84 岁）于 <b>2026-06-01</b> 迁入新桥街道；已有两条完成家访 <code>05-18 / 05-26</code>，以及 <b>06-03</b> 预约。</li>
            <li>转介 <b>RH-4</b> 于 <b>05-28</b> 送往康复服务方，要求 <b>06-05</b> 前补齐行动能力评估。</li>
            <li>服务方 <b>06-02 10:00</b> 退回：缺少评估；原社工 <b>05-31</b> 的一条客户联系因离线到 <b>06-03</b> 才同步。</li>
            <li>客户优先希望熟悉的原社工说明材料，但同意责任转交后由新机构社工接续。</li>
          </ul>
        </div>
      </div>

      <div className="grid-2">
        <section className="card">
          <div className="card-hd">
            <h3>逐步回放 · {policy === 'origin_keeps' ? '原机构续办' : '迁入日转给新机构'}</h3>
            <Badge tone={allOk ? 'green' : 'red'}>{allOk ? '全部核对通过' : '存在异常'}</Badge>
          </div>
          <div className="card-bd">
            {current.steps.map((s, i) => (
              <div key={s.key} className={`script-step ${i === current.steps.length - 1 ? 'active' : 'done'}`}>
                <span className="step-num">{i + 1}</span>
                <b>{s.title}</b>
                <div className="small muted">{s.detail}</div>
                <div className="small muted">业务时间 {fullTime(s.at)}</div>
              </div>
            ))}
          </div>
        </section>

        <section className="card">
          <div className="card-hd">
            <h3>核对项（唯一责任 · 任务 · 客户通知 · 补齐 · 迟到记录）</h3>
          </div>
          <div className="card-bd">
            <ul className="check-list">
              {current.checks.map((c) => (
                <li key={c.key} className={c.ok ? 'ok' : 'bad'}>
                  <span className="check-icon" aria-hidden>
                    {c.ok ? '✓' : '✕'}
                  </span>
                  <div>
                    <b>{c.label}</b>
                    <div className="small muted">{c.value}</div>
                  </div>
                </li>
              ))}
            </ul>
            {current.violations.length > 0 && (
              <div className="banner error mt8" style={{ marginBottom: 0 }}>
                不变量拦截：{current.violations.map((v) => v.title).join('；')}
              </div>
            )}
          </div>
        </section>
      </div>

      <div className="grid-2">
        <section className="card">
          <div className="card-hd">
            <h3>同一转介时间线（服务方回执 + 客户联系 + 责任归属）</h3>
            <Badge tone="purple">{timeline.length} 条</Badge>
          </div>
          <div className="card-bd">
            <ul className="timeline">
              {timeline.map((e) => (
                <li key={e.id} className={e.lateSync ? 'role-sync-engine' : e.kind === 'provider_return' ? 'role-system' : ''}>
                  <div className="audit-summary">
                    {e.summary}
                    {e.lateSync && <Badge tone="amber">迟到同步</Badge>}
                  </div>
                  <div className="audit-meta">
                    <span>业务时间 {fullTime(e.at)}</span>
                    {e.recordedAt && <span>落库 {fullTime(e.recordedAt)}</span>}
                    <span>{e.orgId}</span>
                    <span>{e.actorName}</span>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="card">
          <div className="card-hd">
            <h3>另一种方式并排对照 · {other.policy === 'origin_keeps' ? '原机构续办' : '迁入日转给新机构'}</h3>
          </div>
          <div className="card-bd">
            <p className="small">
              {other.policy === 'origin_keeps'
                ? '责任留在原机构：熟悉情况的社工继续与客户和服务方沟通，直至服务方接收或明确拒绝。代价是跨区后的原团队仍要承担后续催办。'
                : '迁入日转给新机构：符合本地服务归口，客户只与一个机构对接；代价是新团队必须接续既有沟通，原团队立即停止联系。'}
            </p>
            <ul className="check-list compact">
              {other.checks.map((c) => (
                <li key={c.key} className={c.ok ? 'ok' : 'bad'}>
                  <span className="check-icon" aria-hidden>
                    {c.ok ? '✓' : '✕'}
                  </span>
                  <div>
                    <b>{c.label}</b>
                    <div className="small muted">{c.value}</div>
                  </div>
                </li>
              ))}
            </ul>
            <div className="banner info mt8" style={{ marginBottom: 0 }}>
              两种方式都保证：截止 06-05 前有人处理、任何时刻只有一个机构能发起客户/服务方联系、05-18 与 05-26
              已完成家访的历史归属不变；重复送达同一退回回执只生成一次催办。
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

/* ---------- 纯函数构造 ---------- */

interface Triad {
  base: ReturnType<typeof chenCase>;
  localA: CaseFileLike;
  remote9: CaseFileLike;
}
type CaseFileLike = ReturnType<typeof chenCase>;

function buildTriad(): Triad {
  const base = chenCase();
  const localA = structuredClone(base);
  const v = localA.visits.find((x) => x.id === 'visit-main')!;
  v.observations +=
    ' 现场核实：药盒周一、周三两格未动；老人称“忘了吃过没有”。助餐午餐吃完约七成。已当场演示分格药盒。';
  v.checkInAt = '2026-11-25T09:32:00+08:00';
  v.checkOutAt = '2026-11-25T10:28:00+08:00';
  v.serviceMinutes = 56;
  v.fulfillment = 'completed';

  const remote9 = structuredClone(base);
  remote9.appointments.find((a) => a.id === 'appt-next')!.startAt = '2026-12-02T10:00:00+08:00';
  const g = remote9.goals.find((x) => x.id === 'goal-meal')!;
  g.publishState = 'returned';
  g.returnNote = '请补充药品名称、漏服次数，以及连续三日进食观察。';
  g.returnedByName = '王敏';
  g.returnedAt = Date.parse('2026-11-25T10:05:00+08:00');
  const rv = remote9.visits.find((x) => x.id === 'visit-main')!;
  rv.status = 'returned';
  rv.supervisorNote = g.returnNote;
  remote9.rev = 9;
  return { base, localA, remote9 };
}
