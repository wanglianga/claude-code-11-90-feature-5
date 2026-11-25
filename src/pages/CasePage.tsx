import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useApp } from '../state/AppStore';
import { Badge, StatusBadge } from '../components/ui';
import { eqValue } from '../lib/paths';
import CaseOverviewTab from '../components/case/OverviewTab';
import VisitTab from '../components/case/VisitTab';
import GoalsTab from '../components/case/GoalsTab';
import AppointmentsTab from '../components/case/AppointmentsTab';
import ReferralsTab from '../components/case/ReferralsTab';
import TransferTab from '../components/case/TransferTab';
import SyncTab from '../components/case/SyncTab';
import type { Violation } from '../types';

const TABS = [
  { key: 'overview', label: '概览与授权' },
  { key: 'visit', label: '到访登记' },
  { key: 'goals', label: '目标与计划' },
  { key: 'appts', label: '预约管理' },
  { key: 'refs', label: '转介与提醒' },
  { key: 'transfer', label: '迁居移交' },
  { key: 'sync', label: '同步记录' },
] as const;

type TabKey = (typeof TABS)[number]['key'];

export default function CasePage() {
  const { caseId = '' } = useParams();
  const navigate = useNavigate();
  const app = useApp();
  const { cases, drafts, online, quickSync, pushToast } = app;
  const [tab, setTab] = useState<TabKey>('overview');
  const [violations, setViolations] = useState<Violation[]>([]);
  const [syncing, setSyncing] = useState(false);

  const remote = cases.find((c) => c.id === caseId);
  const draft = drafts[caseId];
  const value = draft?.value ?? remote;

  const dirty = useMemo(
    () => Boolean(draft && !eqValue(draft.value, draft.base)),
    [draft],
  );
  const remoteRev = remote?.rev ?? draft?.baseRev ?? 0;
  const baseRev = draft?.baseRev ?? remoteRev;
  const remoteNewer = Boolean(draft && remote && remote.rev > draft.baseRev);

  if (!remote || !value) {
    return (
      <div className="card">
        <div className="card-bd">
          <span className="spinner" /> 正在载入案卷 {caseId} …
          <p className="small muted mt8">若长时间空白，请回到清单或到样例页重置模拟数据。</p>
          <Link className="btn mt16" to="/">
            返回待访清单
          </Link>
        </div>
      </div>
    );
  }

  async function doQuickSync() {
    setViolations([]);
    setSyncing(true);
    const r = await quickSync(caseId);
    setSyncing(false);
    if (r.kind === 'synced') {
      pushToast(`同步成功：案卷已更新到 rev ${r.rev}`, 'success');
    } else if (r.kind === 'conflict') {
      pushToast('远端版本已变化或有关联状态待裁决，进入三方核对', 'warn');
      navigate(`/case/${caseId}/conflict`);
    } else if (r.kind === 'guard') {
      setViolations(r.violations);
      pushToast(`领域规则拦截：${r.violations.length} 项需处理`, 'error');
    } else if (r.kind === 'offline') {
      pushToast('当前离线：修改仍保存在本机，恢复网络后再同步', 'warn');
    } else {
      pushToast(`同步失败：${r.message}`, 'error');
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <div className="small">
            <Link to="/">← 待访清单</Link>
          </div>
          <h1 className="page-title case-title-row">
            {remote.client.name}
            <span className="small muted" style={{ fontWeight: 400 }}>
              {remote.client.gender} · {remote.client.age} 岁 · {remote.client.code}
            </span>
            <Badge tone={remote.client.risk === '重点关注' ? 'red' : 'gray'}>
              {remote.client.risk}
            </Badge>
          </h1>
          <div className="page-sub">
            {remote.client.district}
            {remote.transfer && (
              <>
                {' · 迁居移交自 '}
                {remote.transfer.originOrg.name}
                {'（迁入日 '}
                {remote.transfer.moveInDate}
                {'）'}
              </>
            )}
          </div>
        </div>
        <div className="head-actions">
          <span className="rev-chip base">
            本地基线 <b>v{baseRev}</b>
          </span>
          <span className="rev-chip remote">
            远端当前 <b>v{remoteRev}</b>
          </span>
          {dirty && <Badge tone="blue">有未同步本地修改</Badge>}
          {remoteNewer && <Badge tone="red">远端有新版本，需核对</Badge>}
        </div>
      </div>

      {!online && (
        <div className="banner warn" role="status">
          📵 离线编辑中：所有保存只写入本标签页 IndexedDB，操作记录保留所依据的远端 v{baseRev}。
        </div>
      )}
      {remoteNewer && (
        <div className="banner error" role="alert">
          <div>
            <b>远端已前进到 v{remoteRev}。</b> 另一位社工或主管已经提交变化；直接同步不会覆盖对方。
            请打开三方核对，并列比较「远端基线 v{baseRev} / 本地改动 / 远端新值 v{remoteRev}」。
          </div>
          <div className="banner-actions">
            <button className="btn btn-sm btn-danger" onClick={() => navigate(`/case/${caseId}/conflict`)}>
              打开三方核对
            </button>
          </div>
        </div>
      )}
      {violations.length > 0 && (
        <div className="banner error" role="alert">
          <div>
            <b>提交被领域规则拦截：</b>
            <ul style={{ margin: '6px 0 0 18px', padding: 0 }}>
              {violations.map((v, i) => (
                <li key={i}>
                  <b>{v.title}</b> — {v.detail}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-bd tight">
          <span className="small" id="gran-label">
            协作粒度：
          </span>
          <div className="flex" role="group" aria-labelledby="gran-label" style={{ marginTop: 6 }}>
            <button
              className={`btn btn-sm ${draft?.granularity !== 'unit' ? 'btn-primary' : ''}`}
              aria-pressed={draft?.granularity !== 'unit'}
              onClick={() => app.setGranularity(caseId, 'field')}
              title="一人补观察、另一人改预约等无关字段可自动并存；关联状态仍整组拦截"
            >
              字段级三方比较（推荐恢复协作）
            </button>
            <button
              className={`btn btn-sm ${draft?.granularity === 'unit' ? 'btn-primary' : ''}`}
              aria-pressed={draft?.granularity === 'unit'}
              onClick={() => app.setGranularity(caseId, 'unit')}
              title="整次家访作为一个确认包，主管看到完整上下文；包内无关约访改动也会一起等待"
            >
              整次家访确认单元（主管完整上下文）
            </button>
            <span className="small muted grow">
              {draft?.granularity === 'unit'
                ? '整单元模式：一次家访的全部字段 + 关联目标 + 被捆绑的未来预约作为一个裁决/确认包。'
                : '字段级模式：独立字段自动并存；服务目标、履约、记录状态等关联字段仍作为整体拦截。'}
            </span>
          </div>
        </div>
      </div>

      <div className="tabs" role="tablist" aria-label="个案分区">
        {TABS.map((t) => (
          <button
            key={t.key}
            id={`tab-${t.key}`}
            role="tab"
            className="tab-btn"
            aria-selected={tab === t.key}
            aria-controls={`panel-${t.key}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
            {t.key === 'sync' && dirty ? ' ●' : ''}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === 'overview' && <CaseOverviewTab caseId={caseId} value={value} />}
        {tab === 'visit' && <VisitTab caseId={caseId} value={value} />}
        {tab === 'goals' && <GoalsTab caseId={caseId} value={value} />}
        {tab === 'appts' && <AppointmentsTab caseId={caseId} value={value} />}
        {tab === 'refs' && <ReferralsTab caseId={caseId} value={value} />}
        {tab === 'transfer' && <TransferTab caseId={caseId} value={value} />}
        {tab === 'sync' && <SyncTab caseId={caseId} />}
      </div>

      <div className="sync-panel" aria-label="同步操作">
        <StatusBadge value={dirty ? 'submitted' : 'confirmed'} />
        <span className="small">
          {dirty
            ? `本机有修改，基线 v${baseRev}${remoteNewer ? `，远端已到 v${remoteRev}` : ''}`
            : '本机工作副本与基线一致'}
        </span>
        <span className="spacer" />
        {draft && (
          <button className="btn btn-sm" onClick={() => navigate(`/case/${caseId}/conflict`)}>
            三方核对中心
          </button>
        )}
        <button className="btn btn-primary" disabled={syncing || !dirty} onClick={doQuickSync}>
          {syncing ? <span className="spinner" /> : null}
          {remoteNewer ? '核对并同步…' : '保存并同步到模拟远端'}
        </button>
      </div>
    </>
  );
}
