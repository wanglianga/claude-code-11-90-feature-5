import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../state/AppStore';
import { Badge, EmptyState, StatusBadge } from '../components/ui';
import { hm } from '../lib/time';

export default function SupervisorPage() {
  const { cases, actor, loginAs, supervisorDecision } = useApp();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  const items = useMemo(() => {
    return cases.flatMap((c) =>
      c.visits.map((v) => ({ c, v, goal: c.goals.find((g) => g.id === v.goalId) })),
    );
  }, [cases]);

  const queue = items.filter((x) => x.v.status === 'submitted');
  const returned = items.filter((x) => x.v.status === 'returned');
  const confirmed = items.filter((x) => x.v.status === 'confirmed');

  const isSup = actor?.role === 'supervisor';

  async function decide(caseId: string, recordId: string, decision: 'return' | 'confirm') {
    const note = notes[recordId] ?? '';
    if (decision === 'return' && note.trim().length < 5) return;
    setBusyId(recordId + decision);
    await supervisorDecision({
      caseId,
      recordId,
      decision,
      note: note.trim(),
      ownerName: '责任社工',
    });
    setBusyId(null);
    setNotes((n) => ({ ...n, [recordId]: '' }));
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">主管确认队列</h1>
          <div className="page-sub">
            主管可以退回一条服务记录补充事实，或确认其进入服务计划。提醒已读、转介回执不会被计为服务完成。
          </div>
        </div>
        {!isSup && (
          <div className="head-actions">
            <Badge tone="amber">当前账号是社工，操作需主管身份</Badge>
            <button className="btn btn-warn" onClick={() => loginAs('wang')}>
              一键切换为主管 王敏（wang.min）
            </button>
          </div>
        )}
      </div>

      {!isSup && (
        <div className="banner info">
          为方便演示，可直接点右上角按钮在本标签切换为主管；双标签演练时建议另开标签登录 wang.min。
        </div>
      )}

      <h2 style={{ fontSize: 17 }}>待确认（{queue.length}）</h2>
      {queue.length === 0 && <EmptyState title="暂无待主管确认的记录" hint="社工在个案页提交后会出现在这里。" />}
      {queue.map(({ c, v, goal }) => (
        <section className="card" key={v.id}>
          <div className="card-bd queue-item">
            <div>
              <div className="flex">
                <Link to={`/case/${c.id}`} style={{ fontWeight: 700, fontSize: 16 }}>
                  {c.client.name} · {v.serviceDate} 家访
                </Link>
                <StatusBadge value={v.status} />
                {v.materialFlag === 'pending_verification' && <StatusBadge value="pending_verification" />}
              </div>
              <p className="small" style={{ margin: '6px 0' }}>
                <b>目标：</b>
                {goal?.title} <StatusBadge value={goal?.publishState ?? 'draft'} />
              </p>
              <p className="small" style={{ margin: '4px 0' }}>
                <b>签到：</b>
                {v.checkInAt ? hm(v.checkInAt) : '—'} · <b>时长：</b>
                {v.serviceMinutes ?? '—'} 分钟 · <b>履约：</b>
                <StatusBadge value={v.fulfillment || 'draft'} />
              </p>
              <p style={{ margin: '6px 0' }}>
                <b>观察：</b>
                {v.observations || '（未填写）'}
              </p>
              {v.supplementNote && (
                <p className="small" style={{ margin: '4px 0' }}>
                  <b>补充事实：</b>
                  {v.supplementNote}
                </p>
              )}
              <textarea
                className="textarea mt8"
                placeholder="退回时必须写明需要补充的事实（至少 5 个字）；确认时可留空或写确认意见。"
                value={notes[v.id] ?? ''}
                onChange={(e) => setNotes((n) => ({ ...n, [v.id]: e.target.value }))}
                aria-label={`对 ${c.client.name} 记录的主管意见`}
              />
            </div>
            <div className="flex" style={{ flexDirection: 'column', alignItems: 'stretch', minWidth: 170 }}>
              <button
                className="btn btn-warn"
                disabled={!isSup || (notes[v.id] ?? '').trim().length < 5 || busyId === v.id + 'return'}
                onClick={() => decide(c.id, v.id, 'return')}
                title={isSup ? '退回后目标进入 returned，旧草稿无法越过' : '需主管身份'}
              >
                {busyId === v.id + 'return' ? <span className="spinner" /> : null}
                退回补充事实
              </button>
              <button
                className="btn btn-primary"
                disabled={!isSup || busyId === v.id + 'confirm'}
                onClick={() => decide(c.id, v.id, 'confirm')}
                title={isSup ? '确认后写入服务计划' : '需主管身份'}
              >
                {busyId === v.id + 'confirm' ? <span className="spinner" /> : null}
                确认进入服务计划
              </button>
              <Link className="btn btn-sm" to={`/case/${c.id}`}>
                查看完整上下文
              </Link>
            </div>
          </div>
        </section>
      ))}

      <div className="grid-2">
        <section>
          <h2 style={{ fontSize: 17 }}>已退回（{returned.length}）</h2>
          {returned.map(({ c, v }) => (
            <div className="entity is-returned" key={v.id}>
              <div className="entity-hd">
                <Link to={`/case/${c.id}`}>
                  <b>{c.client.name}</b> · {v.id}
                </Link>
                <StatusBadge value={v.status} />
              </div>
              <div className="return-note">{v.supervisorNote}</div>
            </div>
          ))}
          {returned.length === 0 && <p className="muted small">暂无。</p>}
        </section>
        <section>
          <h2 style={{ fontSize: 17 }}>已确认入计划（{confirmed.length}）</h2>
          {confirmed.map(({ c, v }) => (
            <div className="entity is-confirmed" key={v.id}>
              <div className="entity-hd">
                <Link to={`/case/${c.id}`}>
                  <b>{c.client.name}</b> · {v.id}
                </Link>
                <StatusBadge value={v.status} />
              </div>
              <p className="small" style={{ margin: '6px 0 0' }}>
                {v.supervisorNote}
              </p>
            </div>
          ))}
          {confirmed.length === 0 && <p className="muted small">暂无。</p>}
        </section>
      </div>
    </>
  );
}
