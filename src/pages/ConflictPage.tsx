import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useApp } from '../state/AppStore';
import { Badge } from '../components/ui';
import { runMerge } from '../workers/client';
import { buildCandidate, unresolvedItems } from '../lib/merge';
import { applyPendingVerificationFix, grantState, validateCandidate } from '../lib/rules';
import { formatValue, pathFullLabel } from '../lib/labels';
import type { CaseFile, MergeAnalysis, MergeItem, Violation } from '../types';

type LoadState =
  | { kind: 'loading' }
  | { kind: 'offline' }
  | { kind: 'no-draft' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; envBaseRev: number; current: CaseFile; analysis: MergeAnalysis };

export default function ConflictPage() {
  const { caseId = '' } = useParams();
  const navigate = useNavigate();
  const app = useApp();
  const { online, actor, grants, now } = app;
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [showOnlyNeeds, setShowOnlyNeeds] = useState(false);
  const [narrowPreview, setNarrowPreview] = useState(false);
  const [fixApplied, setFixApplied] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [serverViolations, setServerViolations] = useState<Violation[] | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  async function load() {
    setState({ kind: 'loading' });
    const prep = await app.prepareAnalysis(caseId);
    if (prep.kind === 'ok') {
      setState({
        kind: 'ready',
        envBaseRev: prep.result.env.baseRev,
        current: prep.result.current,
        analysis: prep.result.analysis,
      });
    } else if (prep.kind === 'offline') setState({ kind: 'offline' });
    else if (prep.kind === 'no-draft') setState({ kind: 'no-draft' });
    else setState({ kind: 'error', message: prep.message });
  }

  useEffect(() => {
    void load();
    headingRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseId]);

  const ready = state.kind === 'ready' ? state : null;

  function mutateAnalysis(fn: (a: MergeAnalysis) => MergeAnalysis) {
    if (!ready) return;
    setFixApplied(false);
    setState({ ...ready, analysis: fn(ready.analysis) });
  }

  function setDecision(itemId: string, decision: MergeItem['decision']) {
    mutateAnalysis((a) => ({
      ...a,
      items: a.items.map((i) => (i.id === itemId ? { ...i, decision } : i)),
    }));
  }

  function setManual(itemId: string, path: string, value: unknown) {
    mutateAnalysis((a) => ({
      ...a,
      items: a.items.map((i) =>
        i.id === itemId ? { ...i, manual: { ...i.manual, [path]: value } } : i,
      ),
    }));
  }

  function bulkDecide(decision: 'remote' | 'local' | 'defer') {
    mutateAnalysis((a) => ({
      ...a,
      items: a.items.map((i) => (i.auto === 'needs-decision' ? { ...i, decision } : i)),
    }));
  }

  const candidateBuilt = useMemo(() => {
    if (!ready) return null;
    const env = app.drafts[caseId];
    if (!env) return null;
    return buildCandidate(env.value, ready.current, ready.analysis);
  }, [ready, app.drafts, caseId]);

  const candidate = useMemo(
    () => (candidateBuilt && fixApplied ? applyPendingVerificationFix(candidateBuilt) : candidateBuilt),
    [candidateBuilt, fixApplied],
  );

  const violations = useMemo(() => {
    if (!candidate || !ready) return [];
    return validateCandidate(candidate, {
      current: ready.current,
      grants,
      now,
      actorId: actor?.id,
    });
  }, [candidate, ready, grants, now, actor?.id]);

  const unresolved = ready ? unresolvedItems(ready.analysis) : [];
  const grant = grants
    .filter((g) => g.caseId === caseId && g.granteeActorId === actor?.id)
    .sort((a, b) => b.issuedAt - a.issuedAt)[0];
  const gState = grantState(grant, now);

  function focusFirstUnresolved() {
    const first = ready ? unresolvedItems(ready.analysis)[0] : null;
    if (!first) return;
    const root = document.getElementById(`item-${first.id}`);
    const input = root?.querySelector<HTMLInputElement>('input[type="radio"]');
    input?.focus();
    root?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  async function submit() {
    if (!ready || !candidate || unresolved.length || !actor) return;
    const env = app.drafts[caseId];
    if (!env) return;
    setSubmitting(true);
    setServerViolations(null);

    const auditEvents = [
      {
        actorId: 'sync-engine',
        actorName: '三方合并引擎（WebWorker）',
        actorRole: 'sync-engine' as const,
        tabId: app.tabId,
        action: 'three-way-analysis',
        target: caseId,
        summary: `以 v${env.baseRev} 为共同基线，对 ${ready.analysis.paths.filter((p) => p.changed).length} 个变化路径做${
          env.granularity === 'field' ? '字段级' : '整单元'
        }比较。${ready.analysis.autoNotes.slice(0, 4).join('；') || '无自动项'}`,
      },
      {
        actorId: actor.id,
        actorName: actor.name,
        actorRole: actor.role,
        tabId: app.tabId,
        action: 'conflict-resolution',
        target: caseId,
        summary: `人工裁决后以远端 v${ready.current.rev} 为底重新校验预约与授权并提交。裁决：${ready.analysis.items
          .map((i) => `${i.kind}:${i.paths[0].replace(/\]/g, '').slice(0, 40)}=${i.decision ?? '未决'}`)
          .join('；')}`,
      },
    ];

    const res = await app.commitAnalysis(
      caseId,
      env,
      ready.analysis,
      candidate,
      auditEvents,
      ready.current.rev,
    );
    setSubmitting(false);

    if (res.kind === 'synced') {
      app.pushToast(
        res.deferred > 0
          ? `已提交为 rev ${res.result.case.rev}；${res.deferred} 项暂缓修改已 rebase 到新草稿`
          : `核对完成，已提交为 rev ${res.result.case.rev}`,
        'success',
      );
      navigate(`/case/${caseId}`);
    } else if (res.kind === 'guard') {
      setServerViolations(res.violations);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else if (res.kind === 'conflict') {
      // 提交期间又有人提交：用新 current 重新分析
      const fresh = res.result.current;
      const a2 = await runMerge(caseId, env.base, env.value, fresh, env.granularity);
      setState({ kind: 'ready', envBaseRev: env.baseRev, current: fresh, analysis: a2 });
      app.pushToast('提交瞬间远端再次前进，已用最新版本重新三方比较', 'warn');
    } else if (res.kind === 'offline') {
      app.pushToast('网络已断开：裁决保留在本页，请恢复网络后提交', 'warn');
    } else {
      app.pushToast(`提交失败：${res.kind === 'error' ? res.message : ''}`, 'error');
    }
  }

  if (state.kind === 'loading') {
    return (
      <div className="card">
        <div className="card-bd">
          <span className="spinner" /> 正在通过 WebWorker 进行三方比较…
        </div>
      </div>
    );
  }
  if (state.kind === 'offline') {
    return (
      <div className="banner warn">
        当前离线，无法读取远端最新值。你的草稿仍在本机；请恢复网络后再进入核对。
        <Link className="btn btn-sm" to={`/case/${caseId}`}>
          返回个案
        </Link>
      </div>
    );
  }
  if (state.kind === 'no-draft') {
    return (
      <div className="card">
        <div className="card-bd">
          这个个案还没有本机草稿，没有需要核对的冲突。
          <div className="mt16">
            <Link className="btn btn-primary" to={`/case/${caseId}`}>
              返回个案开始登记
            </Link>
          </div>
        </div>
      </div>
    );
  }
  if (state.kind === 'error' || !ready) {
    return (
      <div className="banner error">
        分析失败：{state.kind === 'error' ? state.message : ''}
        <button className="btn btn-sm" onClick={load}>
          重试
        </button>
      </div>
    );
  }

  const { analysis, current } = ready;
  const visibleItems = showOnlyNeeds ? analysis.items.filter((i) => i.auto === 'needs-decision') : analysis.items;
  const allViolations = serverViolations ?? violations;

  return (
    <div className={narrowPreview ? 'conflict-wrap preview-narrow' : 'conflict-wrap'}>
      <div className="page-head">
        <div>
          <div className="small">
            <Link to={`/case/${caseId}`}>← 返回个案</Link>
          </div>
          <h1 className="page-title" ref={headingRef} tabIndex={-1}>
            三方核对中心
          </h1>
          <div className="page-sub">
            并列比较共同基线、本标签本地改动与远端新值；每项可保留远端、把本地内容作为新版本提交，或暂缓（rebase
            后留在本机）。即使选择本地值，提交前仍重新校验预约状态与授权。
          </div>
        </div>
        <div className="head-actions">
          <button className="btn btn-sm" onClick={() => setNarrowPreview((v) => !v)} aria-pressed={narrowPreview}>
            📱 {narrowPreview ? '退出窄窗预览' : '窄窗布局预览'}
          </button>
          <button className="btn btn-sm" onClick={load}>
            ⟳ 重新拉取远端并校验
          </button>
        </div>
      </div>

      <details className="card">
        <summary className="card-hd" style={{ cursor: 'pointer' }}>
          <h3 style={{ display: 'inline' }}>⌨️ 键盘操作与焦点说明</h3>
        </summary>
        <div className="card-bd small">
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            <li>
              <span className="kbd">Tab</span> / <span className="kbd">Shift+Tab</span>{' '}
              在字段、单选项与按钮间移动；所有可操作元素都有可见焦点框。
            </li>
            <li>
              焦点进入裁决单选项后，用 <span className="kbd">↑</span>/<span className="kbd">↓</span> 或{' '}
              <span className="kbd">←</span>/<span className="kbd">→</span> 在“保留远端 / 本地新版 / 暂缓”间选择。
            </li>
            <li>“定位第一个未决项”按钮会把焦点直接送到该处；提交结果通过 aria-live 播报。</li>
            <li>窗口变窄或使用“窄窗布局预览”时，三列自动堆叠为带列名的卡片。</li>
          </ul>
        </div>
      </details>

      <div className="rev-triad" aria-label="三个版本">
        <span className="rev-chip base">
          远端基线（共同读取） <b>v{analysis.baseRev}</b>
        </span>
        <span className="rev-chip local">
          本地改动（本标签草稿） <b>基于 v{analysis.baseRev}</b>
        </span>
        <span className="rev-chip remote">
          远端新值 <b>v{analysis.remoteRev}</b>
        </span>
        <span className="grow" />
        <label className="check-pill">
          <input type="checkbox" checked={showOnlyNeeds} onChange={(e) => setShowOnlyNeeds(e.target.checked)} />
          只看待裁决（{unresolved.length}）
        </label>
      </div>

      {unresolved.length > 0 && (
        <div className="banner warn" role="status">
          还有 <b>{unresolved.length}</b> 个必须人工裁决的项目未选择。
          <div className="banner-actions">
            <button className="btn btn-sm btn-warn" onClick={focusFirstUnresolved}>
              定位第一个未决项并聚焦
            </button>
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-bd">
          <div className="flex">
            <b>对待裁决项批量选择：</b>
            <button className="btn btn-sm" onClick={() => bulkDecide('remote')}>
              全部保留远端
            </button>
            <button className="btn btn-sm btn-primary" onClick={() => bulkDecide('local')}>
              全部使用本地作为新版
            </button>
            <button className="btn btn-sm" onClick={() => bulkDecide('defer')}>
              全部暂缓
            </button>
          </div>
        </div>
      </div>

      {visibleItems.map((item) => (
        <ItemCard
          key={item.id}
          item={item}
          analysis={analysis}
          onDecision={(d) => setDecision(item.id, d)}
          onManual={(p, v) => setManual(item.id, p, v)}
        />
      ))}

      {/* 提交前实时复验 */}
      <section className="card" aria-label="提交前重新校验">
        <div className="card-hd">
          <h3>提交前重新校验（预约状态 · 退回锁 · 授权）</h3>
          {allViolations.length === 0 ? <Badge tone="green">当前候选通过规则校验</Badge> : <Badge tone="red">{allViolations.length} 项拦截</Badge>}
        </div>
        <div className="card-bd">
          <div className="flex small">
            <span>
              授权凭据：
              {gState === 'valid' && <Badge tone="green">有效（{grant ? new Date(grant.expiresAt).toLocaleTimeString() : ''} 到期）</Badge>}
              {gState === 'expired' && <Badge tone="amber">已到期</Badge>}
              {gState === 'revoked' && <Badge tone="red">已撤回</Badge>}
              {gState === 'none' && <Badge tone="gray">无（候选不含紧急联系人真值，不影响案卷提交）</Badge>}
            </span>
            <span>
              远端 rev：<b className="mono">{current.rev}</b>（提交将以此为乐观锁基准）
            </span>
          </div>
          {allViolations.length > 0 && (
            <div className="banner error mt8" role="alert">
              <div style={{ width: '100%' }}>
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {allViolations.map((v, i) => (
                    <li key={i}>
                      <b>{v.title}</b> — {v.detail}
                      {v.fix === 'mark-pending-verification' && (
                        <button
                          className="btn btn-sm btn-warn"
                          style={{ marginLeft: 8 }}
                          onClick={() => setFixApplied(true)}
                        >
                          一键修正为待核材料
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
          {fixApplied && allViolations.length === 0 && (
            <div className="banner success mt8">已按规则把取消预约下的签到改为“待核材料”，并清空 completed 履约判定。</div>
          )}
        </div>
      </section>

      <div className="sticky-action">
        <span className="small">
          {unresolved.length > 0 ? `尚余 ${unresolved.length} 项未裁决` : '所有项目已有选择'}
        </span>
        <span className="spacer" />
        <Link className="btn" to={`/case/${caseId}`}>
          暂不提交，回个案
        </Link>
        <button
          className="btn btn-primary"
          disabled={submitting || unresolved.length > 0 || allViolations.length > 0}
          onClick={submit}
        >
          {submitting ? <span className="spinner" /> : null}
          提交所选项为新版本（重新校验后）
        </button>
      </div>
    </div>
  );
}

// ---------------- 单个裁决项 ----------------

function ItemCard({
  item,
  analysis,
  onDecision,
  onManual,
}: {
  item: MergeItem;
  analysis: MergeAnalysis;
  onDecision: (d: MergeItem['decision']) => void;
  onManual: (path: string, value: unknown) => void;
}) {
  const rows = item.paths
    .map((p) => analysis.paths.find((x) => x.path === p))
    .filter((x): x is NonNullable<typeof x> => Boolean(x));
  const needs = item.auto === 'needs-decision';
  const [manualOpen, setManualOpen] = useState(item.kind !== 'independent');

  const kindBadge =
    item.kind === 'correlated' ? (
      <Badge tone="purple">互相关联字段组 · 整体拦截</Badge>
    ) : item.kind === 'unit' ? (
      <Badge tone="purple">整次家访确认单元</Badge>
    ) : (
      <Badge tone="blue">独立字段</Badge>
    );

  return (
    <section className={`merge-item ${needs && item.decision === null ? 'needs' : ''}`} id={`item-${item.id}`}>
      <div className="merge-item-hd">
        <div className="merge-item-title">
          {kindBadge}
          {needs ? <Badge tone="amber">必须人工裁决</Badge> : <Badge tone="green">可自动合并（可改判）</Badge>}
          <span className="small muted">{item.paths.length} 个字段</span>
        </div>
        <p className="merge-why">{item.why}</p>
        <fieldset className="decision-group">
          <legend>对该项目的处理（方向键可切换单选项）</legend>
          <label className="decision-opt">
            <input
              type="radio"
              name={`dec-${item.id}`}
              checked={item.decision === 'remote'}
              onChange={() => onDecision('remote')}
            />
            保留远端新值
          </label>
          <label className="decision-opt rec">
            <input
              type="radio"
              name={`dec-${item.id}`}
              checked={item.decision === 'local'}
              onChange={() => onDecision('local')}
            />
            将本地内容作为新版本提交
          </label>
          <label className="decision-opt">
            <input
              type="radio"
              name={`dec-${item.id}`}
              checked={item.decision === 'defer'}
              onChange={() => onDecision('defer')}
            />
            暂缓（保留本地待同步）
          </label>
        </fieldset>
      </div>

      <div className="triad-grid" role="table" aria-label={`${item.title} 三方值`}>
        <div className="triad-head" role="columnheader">
          字段
        </div>
        <div className="triad-head" role="columnheader">
          远端基线 v{analysis.baseRev}
        </div>
        <div className="triad-head" role="columnheader">
          本地改动
        </div>
        <div className="triad-head" role="columnheader">
          远端新值 v{analysis.remoteRev}
        </div>

        {rows.map((row) => (
          <TriadRow key={row.path} row={row} />
        ))}
      </div>

      <details
        className="manual-wrap"
        open={manualOpen}
        onToggle={(e) => setManualOpen(e.currentTarget.open)}
      >
        <summary>✍️ 人工裁决修订（可选：逐字段覆盖所选来源值）</summary>
        <div className="manual-grid">
          {rows
            .filter((r) => isEditablePrimitive(r.local ?? r.base ?? r.remote))
            .map((row) => (
              <ManualField key={`m-${row.path}`} row={row} item={item} onManual={onManual} />
            ))}
        </div>
      </details>
    </section>
  );
}

function isEditablePrimitive(template: unknown): boolean {
  return (
    typeof template === 'string' ||
    typeof template === 'number' ||
    typeof template === 'boolean' ||
    template === null ||
    (Array.isArray(template) && template.every((x) => typeof x === 'string'))
  );
}

function ManualField({
  row,
  item,
  onManual,
}: {
  row: MergeAnalysis['paths'][number];
  item: MergeItem;
  onManual: (path: string, value: unknown) => void;
}) {
  const manualValue = item.manual[row.path];
  const template = row.local ?? row.base ?? row.remote;
  function editValue(raw: string) {
    if (typeof template === 'number') onManual(row.path, raw === '' ? null : Number(raw));
    else if (Array.isArray(template)) onManual(row.path, raw.split('、').map((s) => s.trim()).filter(Boolean));
    else onManual(row.path, raw);
  }
  const id = `manual-${item.id}-${row.path}`.replace(/[\]\[:]/g, '_');
  const shown =
    manualValue !== undefined
      ? Array.isArray(manualValue)
        ? manualValue.join('、')
        : String(manualValue ?? '')
      : Array.isArray(row.local)
        ? row.local.join('、')
        : ((row.local as string | number | null | undefined) ?? '');

  return (
    <div className="field">
      <label htmlFor={id}>
        {pathFullLabel(row.path)} <code className="small muted">{row.path}</code>
      </label>
      {typeof template === 'boolean' ? (
        <input
          id={id}
          type="checkbox"
          checked={Boolean(manualValue ?? row.local)}
          onChange={(e) => onManual(row.path, e.target.checked)}
        />
      ) : (
        <textarea
          id={id}
          className="textarea"
          rows={String(shown).length > 40 ? 3 : 1}
          value={shown}
          onChange={(e) => editValue(e.target.value)}
        />
      )}
    </div>
  );
}

function TriadRow({ row }: { row: MergeAnalysis['paths'][number] }) {
  return (
    <>
      <div className="triad-field">
        {pathFullLabel(row.path)}
        <div>
          <span className={`status-tag t-${row.status}`}>{statusText(row.status)}</span>
        </div>
        <code className="small muted" style={{ wordBreak: 'break-all' }}>
          {row.path}
        </code>
      </div>
      <div className="triad-value">
        <span className="cell-tag">基线：</span>
        {formatValue(row.path, row.base)}
      </div>
      <div
        className={`triad-value st-${row.status === 'local-only' ? 'local-only' : row.status === 'conflict' ? 'conflict' : ''}`}
      >
        <span className="cell-tag">本地：</span>
        {formatValue(row.path, row.local)}
      </div>
      <div
        className={`triad-value st-${
          row.status === 'remote-only'
            ? 'remote-only'
            : row.status === 'conflict'
              ? 'conflict'
              : row.status === 'same-both'
                ? 'same-both'
                : ''
        }`}
      >
        <span className="cell-tag">远端新值：</span>
        {formatValue(row.path, row.remote)}
      </div>
    </>
  );
}

function statusText(s: string): string {
  switch (s) {
    case 'unchanged':
      return '未变';
    case 'local-only':
      return '仅本地改';
    case 'remote-only':
      return '仅远端改';
    case 'same-both':
      return '两侧同改';
    case 'conflict':
      return '真冲突';
    default:
      return s;
  }
}
