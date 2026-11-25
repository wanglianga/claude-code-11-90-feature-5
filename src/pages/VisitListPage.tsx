import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../state/AppStore';
import { Badge, StatusBadge } from '../components/ui';
import { hm, mdWeek } from '../lib/time';
import type { Appointment, CaseFile } from '../types';

interface Row {
  c: CaseFile;
  a: Appointment;
}

export default function VisitListPage() {
  const { cases, drafts, outbox } = useApp();
  const [q, setQ] = useState('');
  const [riskOnly, setRiskOnly] = useState(false);
  const [pendingOnly, setPendingOnly] = useState(false);

  const rows = useMemo<Row[]>(() => {
    const r: Row[] = [];
    for (const c of cases) {
      for (const a of c.appointments) {
        if (a.label === '过往记录') continue;
        r.push({ c, a });
      }
    }
    return r.sort((x, y) => +new Date(x.a.startAt) - +new Date(y.a.startAt));
  }, [cases]);

  const filtered = rows.filter(({ c, a }) => {
    if (riskOnly && c.client.risk !== '重点关注') return false;
    const hasDraft = Boolean(drafts[c.id]);
    if (pendingOnly && !hasDraft) return false;
    if (q.trim()) {
      const s = q.trim().toLowerCase();
      const hay = `${c.client.name} ${c.client.code} ${c.client.address} ${c.client.district} ${c.goals
        .map((g) => g.title)
        .join(' ')} ${a.place}`.toLowerCase();
      if (!hay.includes(s)) return false;
    }
    return true;
  });

  const groups = useMemo(() => {
    const m = new Map<string, Row[]>();
    for (const row of filtered) {
      const key = mdWeek(row.a.startAt);
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(row);
    }
    return [...m.entries()];
  }, [filtered]);

  const queuedCount = outbox.filter((o) => o.status === 'queued' || o.status === 'syncing').length;

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">待访清单</h1>
          <div className="page-sub">
            按服务对象与预约时段排列；卡片仅呈现上门必要资料。当前有 {Object.keys(drafts).length} 个案存在本机草稿，
            {queuedCount} 条操作待同步。
          </div>
        </div>
        <div className="head-actions">
          <Link className="btn" to="/scenarios">
            🧪 样例演练 / 双标签
          </Link>
        </div>
      </div>

      <div className="filter-bar" role="search">
        <input
          className="input"
          placeholder="搜索姓名 / 编号 / 地址 / 目标"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="搜索待访个案"
        />
        <label className="check-pill">
          <input type="checkbox" checked={riskOnly} onChange={(e) => setRiskOnly(e.target.checked)} />
          仅看重点关注
        </label>
        <label className="check-pill">
          <input
            type="checkbox"
            checked={pendingOnly}
            onChange={(e) => setPendingOnly(e.target.checked)}
          />
          仅看本机有草稿
        </label>
      </div>

      {cases.length === 0 && (
        <div className="card">
          <div className="card-bd">
            <span className="spinner" /> 正在从浏览器 IndexedDB 载入虚构个案…
          </div>
        </div>
      )}

      {groups.map(([day, list]) => (
        <section className="time-group" key={day} aria-label={`${day} 的预约`}>
          <div className="time-group-hd">
            <span className="time-pill">{day}</span>
            <span className="small muted">{list.length} 个预约</span>
            <span className="line" />
          </div>
          <div className="visit-grid">
            {list.map(({ c, a }) => {
              const draft = drafts[c.id];
              const blocked = outbox.some((o) => o.caseId === c.id && o.status === 'blocked');
              const goal = c.goals.find((g) => g.id === c.visits[0]?.goalId) ?? c.goals[0];
              return (
                <Link
                  key={a.id}
                  to={`/case/${c.id}`}
                  className={`visit-card ${a.status === 'canceled' ? 'is-canceled' : ''}`}
                  aria-label={`${hm(a.startAt)} ${c.client.name}，${a.label}，${a.status === 'canceled' ? '远端已取消' : ''}`}
                >
                  <div className="visit-card-hd">
                    <span className="visit-time">{hm(a.startAt)}</span>
                    <StatusBadge value={a.status} />
                  </div>
                  <div className="visit-name">
                    {c.client.name}
                    <span className="small muted" style={{ fontWeight: 400, marginLeft: 8 }}>
                      {c.client.gender} · {c.client.age} 岁 · {c.client.code}
                    </span>
                  </div>
                  <div className="visit-meta">
                    <Badge tone={c.client.risk === '重点关注' ? 'red' : 'gray'}>{c.client.risk}</Badge>{' '}
                    {c.client.district}
                    <br />
                    📍 {c.client.address}
                    <br />
                    🕒 {a.durationMin} 分钟 · {a.place}
                  </div>
                  <div className="visit-goal">
                    <b>当前目标：</b>
                    {goal?.title ?? '—'}
                  </div>
                  <div className="visit-foot">
                    <StatusBadge value={goal?.publishState ?? 'draft'} />
                    {draft && <Badge tone="blue">本机草稿 · 基线 rev {draft.baseRev}</Badge>}
                    {blocked && <Badge tone="red">同步被守卫拦截</Badge>}
                    {c.referrals.length > 0 && <Badge tone="purple">转介 {c.referrals.length}</Badge>}
                    {c.transfer && (
                      <>
                        <Badge tone="amber">
                          迁居移交 · {c.transfer.followUps.length > 0 ? '已定唯一责任' : '待定责任'}
                        </Badge>
                        {c.transfer.followUps.length > 0 && (
                          <Badge tone="purple">
                            责任 {c.transfer.followUps[0].ownerOrgId === c.transfer.originOrg.id ? '原机构' : '新机构'}
                          </Badge>
                        )}
                      </>
                    )}
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      ))}

      {filtered.length === 0 && cases.length > 0 && (
        <p className="muted">没有符合筛选条件的预约。可清除筛选，或到「样例演练」重置数据。</p>
      )}
    </>
  );
}
