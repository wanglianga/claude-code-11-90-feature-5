import { Link } from 'react-router-dom';
import { useApp } from '../../state/AppStore';
import { Badge } from '../ui';
import { fullTime } from '../../lib/time';

const STATUS_TONE = {
  queued: 'amber',
  syncing: 'blue',
  synced: 'green',
  blocked: 'red',
} as const;

const STATUS_TEXT = {
  queued: '本地待同步',
  syncing: '同步中',
  synced: '已同步',
  blocked: '被规则拦截',
} as const;

export default function SyncTab({ caseId }: { caseId: string }) {
  const { outbox, drafts, audits, tabId } = useApp();
  const ops = outbox.filter((o) => o.caseId === caseId);
  const draft = drafts[caseId];
  const caseAudits = audits.filter((a) => a.caseId === caseId).slice(0, 20);

  return (
    <div className="grid-2">
      <section className="card">
        <div className="card-hd">
          <h3>本机编辑队列（每项记录所依据的远端版本）</h3>
          {draft && (
            <Link className="btn btn-sm btn-primary" to={`/case/${caseId}/conflict`}>
              三方核对中心
            </Link>
          )}
        </div>
        <div className="card-bd">
          {ops.length === 0 && <p className="muted small">本次会话还没有离散编辑操作。</p>}
          <ul className="timeline">
            {ops.map((o) => (
              <li key={o.id}>
                <div className="audit-summary">
                  {o.label}{' '}
                  <Badge tone={STATUS_TONE[o.status]}>{STATUS_TEXT[o.status]}</Badge>
                </div>
                <div className="audit-meta">
                  <span>{fullTime(o.at)}</span>
                  <span>
                    依据远端版本 <b className="mono">v{o.baseRev}</b>
                  </span>
                  <span>标签 {o.tabId.slice(-4)}</span>
                  {o.syncedRev && <span>已并入 v{o.syncedRev}</span>}
                </div>
              </li>
            ))}
          </ul>
          {draft && (
            <p className="small muted">
              当前工作副本基线 <b>v{draft.baseRev}</b>，协作粒度：
              {draft.granularity === 'field' ? '字段级' : '整次单元'}，最后保存 {fullTime(draft.updatedAt)}（标签{' '}
              {tabId.slice(-4)}）。
            </p>
          )}
        </div>
      </section>

      <section className="card">
        <div className="card-hd">
          <h3>本案卷审计轨迹（模拟远端账本）</h3>
          <Link className="btn btn-sm" to="/audit">
            全部审计
          </Link>
        </div>
        <div className="card-bd">
          {caseAudits.length === 0 && <p className="muted small">暂无审计条目。</p>}
          <ul className="timeline">
            {caseAudits.map((a) => (
              <li key={a.id} className={`role-${a.actorRole}`}>
                <div className="audit-summary">{a.summary}</div>
                <div className="audit-meta">
                  <span>
                    <b>{a.actorName}</b>（{a.actorRole}）
                  </span>
                  <span>{fullTime(a.at)}</span>
                  <span>标签 {a.tabId.slice?.(-4) ?? a.tabId}</span>
                  {a.rev && <span>rev {a.rev}</span>}
                  <span className="mono" title="内容指纹">
                    🔏 {a.fingerprint.slice(0, 10)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}
