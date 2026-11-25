import { useState } from 'react';
import type { CaseFile, FulfillmentStatus, VisitRecord } from '../../types';
import { useApp } from '../../state/AppStore';
import { Badge, StatusBadge } from '../ui';
import { fromLocalInputValue, hm, toLocalInputValue } from '../../lib/time';

const REASON_OPTIONS = [
  '服务对象临时外出',
  '身体不适/需要休息',
  '家属未在场，关键事实无法确认',
  '到访时间不足',
  '资源或场地未落实',
  '服务对象拒绝该项',
  '其他',
];

type FormState = Pick<
  VisitRecord,
  | 'checkInAt'
  | 'checkOutAt'
  | 'serviceMinutes'
  | 'observations'
  | 'actions'
  | 'fulfillment'
  | 'incompleteReasons'
  | 'incompleteNote'
  | 'supplementNote'
  | 'bundledAppointmentId'
>;

export default function VisitTab({ caseId, value }: { caseId: string; value: CaseFile }) {
  const app = useApp();
  const { patchDraft, pushToast, cases } = app;
  const visit = value.visits.find((v) => v.id === 'visit-main') ?? value.visits[0];
  const remoteCase = cases.find((c) => c.id === caseId);
  const remoteGoal = remoteCase?.goals.find((g) => g.id === visit?.goalId);

  const [form, setForm] = useState<FormState | null>(
    visit
      ? {
          checkInAt: visit.checkInAt,
          checkOutAt: visit.checkOutAt,
          serviceMinutes: visit.serviceMinutes,
          observations: visit.observations,
          actions: visit.actions,
          fulfillment: visit.fulfillment,
          incompleteReasons: [...visit.incompleteReasons],
          incompleteNote: visit.incompleteNote,
          supplementNote: visit.supplementNote,
          bundledAppointmentId: visit.bundledAppointmentId ?? null,
        }
      : null,
  );

  if (!visit || !form) {
    return <div className="banner info">本案卷没有可编辑的到访记录。</div>;
  }

  const goal = value.goals.find((g) => g.id === visit.goalId);
  const futureAppts = value.appointments.filter((a) => a.label !== '过往记录');

  function set<K extends keyof FormState>(k: K, v: FormState[K]) {
    setForm((f) => (f ? { ...f, [k]: v } : f));
  }

  function toggleReason(r: string) {
    set(
      'incompleteReasons',
      form!.incompleteReasons.includes(r)
        ? form!.incompleteReasons.filter((x) => x !== r)
        : [...form!.incompleteReasons, r],
    );
  }

  async function save(label = '保存到访登记') {
    await patchDraft(caseId, label, (doc) => {
      const v = doc.visits.find((x) => x.id === visit.id);
      if (v) Object.assign(v, form);
    });
    pushToast('到访登记已保存到本机草稿（记录当前基线版本）', 'success');
  }

  async function checkIn() {
    const nowIso = new Date().toISOString();
    set('checkInAt', nowIso);
    await patchDraft(caseId, '现场签到', (doc) => {
      const v = doc.visits.find((x) => x.id === visit.id);
      if (v) v.checkInAt = nowIso;
    });
    pushToast(`已签到：${hm(nowIso)}（离线也会保存）`, 'success');
  }

  async function submitForSupervisor() {
    await patchDraft(caseId, '提交服务记录给主管确认', (doc) => {
      const v = doc.visits.find((x) => x.id === visit.id);
      if (!v) return;
      Object.assign(v, form);
      v.status = 'submitted';
      const g = doc.goals.find((x) => x.id === v.goalId);
      if (g && (g.publishState === 'active' || g.publishState === 'returned')) {
        g.publishState = 'in_review';
      }
    });
    pushToast(
      '已在本机提交（待同步）。若主管已在远端退回该目标，同步时退回锁会要求先补事实。',
      'info',
    );
  }

  return (
    <div className="grid-2">
      <section className="card">
        <div className="card-hd">
          <h3>本次家访登记 · {visit.serviceDate}</h3>
          <StatusBadge value={visit.status} />
        </div>
        <div className="card-bd">
          {(visit.status === 'returned' || remoteGoal?.publishState === 'returned') && (
            <div className="return-note" role="alert">
              <b>主管退回意见：</b>
              {remoteGoal?.returnNote || goal?.returnNote || visit.supervisorNote || '请补充事实'}
              <div className="small">
                旧标签页草稿不能越过此退回直接重新发布；必须在下方“补充事实说明”回应后再提交。
              </div>
            </div>
          )}
          {visit.materialFlag === 'pending_verification' && (
            <div className="banner warn">
              <Badge tone="purple">待核材料</Badge>
              该签到关联的预约在上传前已被远端取消：本记录仅作为待核材料，不能据此记为已履约。
            </div>
          )}

          <div className="grid-2">
            <div className="field">
              <label htmlFor="checkin">签到时间</label>
              <div className="flex">
                <input
                  id="checkin"
                  type="datetime-local"
                  className="input"
                  value={toLocalInputValue(form.checkInAt)}
                  onChange={(e) => set('checkInAt', fromLocalInputValue(e.target.value))}
                />
                <button className="btn btn-sm btn-primary" type="button" onClick={checkIn}>
                  立即签到
                </button>
              </div>
            </div>
            <div className="field">
              <label htmlFor="checkout">签退时间</label>
              <input
                id="checkout"
                type="datetime-local"
                className="input"
                value={toLocalInputValue(form.checkOutAt)}
                onChange={(e) => set('checkOutAt', fromLocalInputValue(e.target.value))}
              />
            </div>
          </div>

          <div className="field">
            <label htmlFor="minutes">实际服务时长（分钟）</label>
            <input
              id="minutes"
              type="number"
              min={0}
              className="input"
              style={{ maxWidth: 220 }}
              value={form.serviceMinutes ?? ''}
              onChange={(e) => set('serviceMinutes', e.target.value === '' ? null : Number(e.target.value))}
            />
            <span className="hint"> 不含路途与等待；转介回执、提醒勾选都不会自动折算为服务时长。</span>
          </div>

          <div className="field">
            <label htmlFor="obs">观察记录（见到的事实 / 原话 / 环境）</label>
            <textarea
              id="obs"
              className="textarea"
              style={{ minHeight: 120 }}
              value={form.observations}
              onChange={(e) => set('observations', e.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor="actions">本次服务动作</label>
            <textarea
              id="actions"
              className="textarea"
              value={form.actions}
              onChange={(e) => set('actions', e.target.value)}
            />
          </div>

          <div className="field">
            <span className="field-label" id="ful-label">
              履约状态（需有签到、时长与观察事实支撑）
            </span>
            <div className="check-row" role="radiogroup" aria-labelledby="ful-label">
              {(
                [
                  ['completed', '已完成'],
                  ['partial', '部分完成'],
                  ['incomplete', '未能完成'],
                ] as [FulfillmentStatus, string][]
              ).map(([v, label]) => (
                <label className="check-pill" key={v}>
                  <input
                    type="radio"
                    name="fulfillment"
                    checked={form.fulfillment === v}
                    onChange={() => set('fulfillment', v)}
                  />
                  {label}
                </label>
              ))}
            </div>
          </div>

          <div className="field">
            <span className="field-label">未能完成的原因（可多选）</span>
            <div className="check-row">
              {REASON_OPTIONS.map((r) => (
                <label className="check-pill" key={r}>
                  <input type="checkbox" checked={form.incompleteReasons.includes(r)} onChange={() => toggleReason(r)} />
                  {r}
                </label>
              ))}
            </div>
            <input
              className="input mt8"
              placeholder="其他说明 / 补充情境"
              value={form.incompleteNote}
              onChange={(e) => set('incompleteNote', e.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor="supplement">补充事实说明（被主管退回后重新提交必填）</label>
            <textarea
              id="supplement"
              className="textarea"
              placeholder="针对退回意见，写清新核实到的事实，例如药品名称、漏服次数、连续观察等。"
              value={form.supplementNote}
              onChange={(e) => set('supplementNote', e.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor="bundle">整次确认单元：捆绑的未来预约改动</label>
            <select
              id="bundle"
              className="select"
              value={form.bundledAppointmentId ?? ''}
              onChange={(e) => set('bundledAppointmentId', e.target.value || null)}
            >
              <option value="">不捆绑（预约改动按独立字段合并）</option>
              {futureAppts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label} · {new Date(a.startAt).toLocaleString()}（{a.id}）
                </option>
              ))}
            </select>
            <span className="hint">
              整单元粒度下，被捆绑预约的时间调整会与家访记录一起等待主管整体确认，体现“无关约访改动也等待”的代价。
            </span>
          </div>

          <div className="flex">
            <button className="btn" onClick={() => save()}>
              保存登记到本机
            </button>
            <button className="btn btn-primary" onClick={submitForSupervisor}>
              提交主管确认（本机排队）
            </button>
          </div>
        </div>
      </section>

      <aside>
        <section className="card">
          <div className="card-hd">
            <h3>关联服务目标</h3>
            {goal && <StatusBadge value={goal.publishState} />}
          </div>
          <div className="card-bd">
            <p style={{ fontWeight: 700 }}>{goal?.title}</p>
            <p className="small muted">{goal?.criteria}</p>
            <p className="small">
              <b>本次确认文本：</b>
              {visit.confirmedGoalText}
            </p>
            <p className="small">
              <b>可查看字段：</b>
              {visit.visibleScopes.join('、')}
            </p>
          </div>
        </section>

        <section className="card">
          <div className="card-hd">
            <h3>为什么回执不算完成？</h3>
          </div>
          <div className="card-bd small">
            转介回执只证明机构接收，提醒只证明事项被处理；它们不会自动填写履约状态或服务时长。
            必须由社工依据实际到访事实显式登记。可在「转介与提醒」页查看该规则的实际界面约束。
          </div>
        </section>
      </aside>
    </div>
  );
}
