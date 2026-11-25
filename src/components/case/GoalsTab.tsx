import type { CaseFile } from '../../types';
import { StatusBadge } from '../ui';
import { fullTime } from '../../lib/time';

export default function GoalsTab({ value }: { caseId: string; value: CaseFile }) {
  return (
    <div className="grid-2">
      <section>
        <h2 className="page-title" style={{ fontSize: 17 }}>
          服务目标
        </h2>
        {value.goals.map((g) => (
          <div
            key={g.id}
            className={`entity ${g.publishState === 'returned' ? 'is-returned' : ''} ${
              g.publishState === 'confirmed' ? 'is-confirmed' : ''
            }`}
          >
            <div className="entity-hd">
              <span className="entity-title">{g.title}</span>
              <StatusBadge value={g.publishState} />
            </div>
            <p className="small muted" style={{ margin: '6px 0' }}>
              达成指标：{g.criteria}
            </p>
            {g.returnNote && (
              <div className="return-note">
                <b>退回意见（{g.returnedByName} · {fullTime(g.returnedAt)}）：</b>
                {g.returnNote}
              </div>
            )}
          </div>
        ))}
      </section>

      <section>
        <h2 className="page-title" style={{ fontSize: 17 }}>
          最终服务计划（主管确认后写入）
        </h2>
        {value.plan.length === 0 && <p className="muted small">尚无经主管确认进入计划的条目。</p>}
        {value.plan
          .slice()
          .sort((a, b) => b.addedAt - a.addedAt)
          .map((p) => (
            <div key={p.id} className="entity is-confirmed">
              <p style={{ margin: 0 }}>{p.text}</p>
              <div className="audit-meta mt8">
                <span>责任人：{p.ownerName}</span>
                <span>加入时间：{fullTime(p.addedAt)}</span>
                <span>案卷 rev {p.rev}</span>
                <span>来源记录：{p.sourceRecordId}</span>
              </div>
            </div>
          ))}
      </section>
    </div>
  );
}
