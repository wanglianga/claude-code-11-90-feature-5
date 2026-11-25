import { useState } from 'react';
import type { Appointment, CaseFile } from '../../types';
import { useApp } from '../../state/AppStore';
import { StatusBadge } from '../ui';
import { fromLocalInputValue, mdWeek, toLocalInputValue, hm } from '../../lib/time';

function RescheduleRow({
  caseId,
  appt,
  disabled,
}: {
  caseId: string;
  appt: Appointment;
  disabled: boolean;
}) {
  const { patchDraft, pushToast } = useApp();
  const [val, setVal] = useState(toLocalInputValue(appt.startAt));

  return (
    <div className="flex mt8">
      <input
        type="datetime-local"
        className="input"
        style={{ maxWidth: 230 }}
        value={val}
        disabled={disabled}
        onChange={(e) => setVal(e.target.value)}
        aria-label={`调整 ${appt.id} 时间`}
      />
      <button
        className="btn btn-sm"
        disabled={disabled}
        onClick={async () => {
          const iso = fromLocalInputValue(val);
          if (!iso) return;
          await patchDraft(caseId, `调整预约 ${appt.id} 时间`, (doc) => {
            const a = doc.appointments.find((x) => x.id === appt.id);
            if (a) a.startAt = iso;
          });
          pushToast('改约已保存到本机草稿', 'success');
        }}
      >
        保存改约到本机
      </button>
    </div>
  );
}

export default function AppointmentsTab({ caseId, value }: { caseId: string; value: CaseFile }) {
  const { remoteScript, pushToast } = useApp();
  const [confirmCancel, setConfirmCancel] = useState<string | null>(null);

  async function simulateRemoteCancel(a: Appointment) {
    await remoteScript({
      actor: { id: 'family-desk', name: '调度台（家属来电）', role: 'system' },
      tabId: 'remote-desk',
      caseId,
      action: 'appointment-cancel-remote',
      target: a.id,
      summary: `远端预约 ${a.id} 被家属/调度取消；迟到签到上传后只能形成待核材料。`,
      mutate: (c) => {
        const x = c.appointments.find((y) => y.id === a.id);
        if (x) {
          x.status = 'canceled';
          x.cancelReason = '家属 9:10 来电改期（模拟远端取消）';
        }
      },
    });
    setConfirmCancel(null);
    pushToast('远端已取消该预约，并广播到所有标签页', 'warn');
  }

  return (
    <section className="card">
      <div className="card-hd">
        <h3>预约与改约</h3>
        <span className="small muted">
          “模拟远端取消”代表另一通道（家属来电/调度台）已提交，不受本标签离线开关影响
        </span>
      </div>
      <div className="card-bd">
        {value.appointments
          .slice()
          .sort((a, b) => +new Date(a.startAt) - +new Date(b.startAt))
          .map((a) => (
            <div key={a.id} className="entity">
              <div className="entity-hd">
                <span className="entity-title">
                  {a.label} · {mdWeek(a.startAt)} {hm(a.startAt)}（{a.durationMin} 分钟）
                </span>
                <StatusBadge value={a.status} />
              </div>
              <div className="small muted">
                📍 {a.place} · <span className="mono">{a.id}</span>
              </div>
              {a.cancelReason && (
                <div className="banner error mt8" style={{ marginBottom: 0 }}>
                  取消原因：{a.cancelReason}
                </div>
              )}
              {a.status !== 'canceled' && a.label !== '过往记录' && (
                <RescheduleRow caseId={caseId} appt={a} disabled={false} />
              )}
              {a.status === 'scheduled' && (
                <div className="mt8">
                  {confirmCancel === a.id ? (
                    <div className="flex">
                      <span className="small">确认以“远端家属来电”名义取消？</span>
                      <button className="btn btn-sm btn-danger" onClick={() => simulateRemoteCancel(a)}>
                        确认远端取消
                      </button>
                      <button className="btn btn-sm btn-ghost" onClick={() => setConfirmCancel(null)}>
                        再想想
                      </button>
                    </div>
                  ) : (
                    <button className="btn btn-sm btn-warn" onClick={() => setConfirmCancel(a.id)}>
                      ⚡ 模拟远端取消此预约
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
      </div>
    </section>
  );
}
