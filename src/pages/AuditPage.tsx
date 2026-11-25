import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../state/AppStore';
import { fullTime } from '../lib/time';

export default function AuditPage() {
  const { audits, cases, outbox } = useApp();
  const [caseFilter, setCaseFilter] = useState('all');
  const [actorFilter, setActorFilter] = useState('all');

  const actorKinds = useMemo(
    () => [...new Set(audits.map((a) => a.actorRole))],
    [audits],
  );
  const filtered = audits.filter(
    (a) =>
      (caseFilter === 'all' || a.caseId === caseFilter) &&
      (actorFilter === 'all' || a.actorRole === actorFilter),
  );

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">审计日志</h1>
          <div className="page-sub">
            所有提交、退回、确认、改约、授权与撤权都记录审计主体、标签页、时间、版本与内容指纹。另一标签页的动作会经
            BroadcastChannel 即时刷新。
          </div>
        </div>
      </div>

      <div className="filter-bar">
        <label>
          个案：
          <select className="select" value={caseFilter} onChange={(e) => setCaseFilter(e.target.value)}>
            <option value="all">全部</option>
            {cases.map((c) => (
              <option key={c.id} value={c.id}>
                {c.client.name}（{c.id}）
              </option>
            ))}
          </select>
        </label>
        <label>
          主体类型：
          <select className="select" value={actorFilter} onChange={(e) => setActorFilter(e.target.value)}>
            <option value="all">全部</option>
            {actorKinds.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </label>
        <span className="small muted">共 {filtered.length} 条；本机 outbox 操作 {outbox.length} 条。</span>
      </div>

      <div className="card">
        <div className="card-bd">
          {filtered.length === 0 && <p className="muted">暂无审计条目。</p>}
          <ul className="timeline">
            {filtered.map((a) => (
              <li key={a.id} className={`role-${a.actorRole}`}>
                <div className="audit-summary">{a.summary}</div>
                <div className="audit-meta">
                  <span>
                    审计主体 <b>{a.actorName}</b> · {a.actorRole}
                  </span>
                  <span>{fullTime(a.at)}</span>
                  <span>标签页 {a.tabId}</span>
                  {a.caseId && (
                    <span>
                      对象{' '}
                      <Link to={`/case/${a.caseId}`}>
                        {a.caseId}
                        {a.target && a.target !== a.caseId ? ` / ${a.target}` : ''}
                      </Link>
                    </span>
                  )}
                  {a.rev && <span>rev {a.rev}</span>}
                  <span className="mono" title="条目内容 SHA-256 截断指纹">
                    🔏 {a.fingerprint}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </>
  );
}
