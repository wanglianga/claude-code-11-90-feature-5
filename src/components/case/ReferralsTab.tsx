import { useState } from 'react';
import type { CaseFile, Referral } from '../../types';
import { useApp } from '../../state/AppStore';
import { Badge, StatusBadge } from '../ui';
import { fullTime } from '../../lib/time';
import { uid } from '../../lib/ids';

export default function ReferralsTab({ caseId, value }: { caseId: string; value: CaseFile }) {
  const { patchDraft, pushToast } = useApp();
  const [org, setOrg] = useState('');
  const [service, setService] = useState('');
  const [reason, setReason] = useState('');
  const transfer = value.transfer;
  const fuOf = (id: string) => transfer?.followUps.find((f) => f.referralId === id);
  const hasFinalReceipt = (status: string) => status === '已接收回执' || status === '已办结';

  async function addReferral(e: React.FormEvent) {
    e.preventDefault();
    if (!org.trim() || !service.trim()) return;
    const ref: Referral = {
      id: uid('ref'),
      org: org.trim(),
      service: service.trim(),
      reason: reason.trim(),
      status: '草稿',
      timeline: [],
    };
    await patchDraft(caseId, `新增转介：${ref.org}`, (doc) => {
      doc.referrals.push(ref);
    });
    setOrg('');
    setService('');
    setReason('');
    pushToast('转介记录已保存到本机', 'success');
  }

  return (
    <div className="grid-2">
      <section>
        <div className="banner info">
          ℹ️ 转介回执只表示机构接收/办结，<b>不会</b>自动把家访履约状态改为“已完成”，也不产生服务时长；
          主管确认时审计中也会注明这一点。
          {transfer && ' 本案卷有迁居移交：转介回执请记录到「迁居移交」标签，以保留唯一责任、补齐截止日与时间线幂等。'}
        </div>
        <div className="card">
          <div className="card-hd">
            <h3>转介记录（{value.referrals.length}）</h3>
          </div>
          <div className="card-bd">
            {value.referrals.length === 0 && <p className="muted small">暂无转介。</p>}
            {value.referrals.map((r) => {
              const fu = fuOf(r.id);
              return (
                <div key={r.id} className="entity">
                  <div className="entity-hd">
                    <span className="entity-title">{r.org}</span>
                    <StatusBadge value={r.status} />
                  </div>
                  <div className="small">
                    <b>{r.service}</b> · {r.reason}
                  </div>
                  {r.applicationNo && (
                    <div className="small mt8">
                      <Badge tone="blue">申请 {r.applicationNo}</Badge>
                      {r.providerReturn && (
                        <Badge tone="red">
                          补齐截止 {r.providerReturn.supplementDue}
                        </Badge>
                      )}
                    </div>
                  )}
                  {r.receiptNo && (
                    <div className="small mt8">
                      <Badge tone="purple">回执 {r.receiptNo}</Badge>{' '}
                      {r.receiptAt ? fullTime(r.receiptAt) : ''}
                    </div>
                  )}
                  {fu && (
                    <div className="small mt8">
                      <Badge tone="amber">
                        唯一责任：{fu.ownerName} · 下次联系 {fu.nextContactDue}
                      </Badge>
                    </div>
                  )}
                  <div className="flex mt8">
                    {!transfer && !hasFinalReceipt(r.status) && (
                      <button
                        className="btn btn-sm"
                        onClick={() =>
                          patchDraft(caseId, `登记转介回执 ${r.id}`, (doc) => {
                            const x = doc.referrals.find((y) => y.id === r.id);
                            if (x) {
                              x.status = '已接收回执';
                              x.receiptNo = `HZ-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;
                              x.receiptAt = new Date().toISOString();
                            }
                          })
                        }
                      >
                        模拟收到回执
                      </button>
                    )}
                    <span className="small muted">
                      {transfer
                        ? '迁居移交个案：回执与服务方退回请在「迁居移交」标签登记。'
                        : '点击后请注意：履约状态保持不变。'}
                    </span>
                  </div>
                </div>
              );
            })}

            <form onSubmit={addReferral} className="mt16" aria-label="新增转介">
              <h4>新增转介（虚构机构）</h4>
              <div className="field">
                <label htmlFor="ref-org">机构</label>
                <input id="ref-org" className="input" value={org} onChange={(e) => setOrg(e.target.value)} required />
              </div>
              <div className="field">
                <label htmlFor="ref-svc">服务事项</label>
                <input id="ref-svc" className="input" value={service} onChange={(e) => setService(e.target.value)} required />
              </div>
              <div className="field">
                <label htmlFor="ref-reason">转介原因</label>
                <input id="ref-reason" className="input" value={reason} onChange={(e) => setReason(e.target.value)} />
              </div>
              <button className="btn btn-primary" type="submit">
                保存转介到本机
              </button>
            </form>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="card-hd">
          <h3>提醒事项</h3>
        </div>
        <div className="card-bd">
          {value.reminders.length === 0 && <p className="muted small">暂无提醒。</p>}
          {value.reminders.map((r) => (
            <label key={r.id} className="entity flex" style={{ gap: 10, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={r.done}
                onChange={(e) =>
                  patchDraft(caseId, r.done ? '取消提醒完成' : '勾选提醒完成', (doc) => {
                    const x = doc.reminders.find((y) => y.id === r.id);
                    if (x) x.done = e.target.checked;
                  })
                }
              />
              <span className="grow" style={{ textDecoration: r.done ? 'line-through' : undefined }}>
                {r.text}
                <span className="small muted" style={{ display: 'block' }}>
                  到期 {fullTime(r.dueAt)}
                </span>
              </span>
              <Badge tone={r.done ? 'green' : 'gray'}>{r.done ? '已处理' : '待办'}</Badge>
            </label>
          ))}
          <p className="small muted">提醒勾选同样不会自动完成家访服务。</p>
        </div>
      </section>
    </div>
  );
}
