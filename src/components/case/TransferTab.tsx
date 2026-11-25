import { useMemo, useState } from 'react';
import type { CaseFile, Referral, ReferralTimelineEvent, TransferPolicy } from '../../types';
import { useApp } from '../../state/AppStore';
import { Badge, StatusBadge } from '../ui';
import { fullTime } from '../../lib/time';
import {
  actorOrgId,
  applyCaseInPlace,
  applyProviderReceipt,
  canContact,
  completeFollowUpTask,
  findFollowUp,
  nextActionLabel,
  policyLabel,
  recordClientContact,
  replayLateSync,
  sortedTimeline,
  summaryVisibleTo,
  taskKindLabel,
  validateTransfer,
  visitAttribution,
  visibleTimelineEvent,
} from '../../lib/transfer';
import { activateTransferOnCase, C21 } from '../../lib/transferFlow';

const EVENT_LABEL: Record<ReferralTimelineEvent['kind'], string> = {
  referral_sent: '送出转介',
  client_contact: '客户联系',
  provider_contact: '联系服务方',
  provider_receipt: '服务方回执',
  provider_return: '服务方退回',
  duplicate_receipt: '重复回执去重',
  ownership_assigned: '责任确定',
  ownership_moved: '责任转移',
  late_sync: '迟到同步归档',
  case_closed: '结案',
};

const EVENT_TONE: Record<ReferralTimelineEvent['kind'], 'gray' | 'blue' | 'green' | 'amber' | 'red' | 'purple'> = {
  referral_sent: 'blue',
  client_contact: 'green',
  provider_contact: 'green',
  provider_receipt: 'purple',
  provider_return: 'red',
  duplicate_receipt: 'gray',
  ownership_assigned: 'amber',
  ownership_moved: 'amber',
  late_sync: 'amber',
  case_closed: 'green',
};

export default function TransferTab({ caseId, value }: { caseId: string; value: CaseFile }) {
  const { actor, patchDraft, pushToast, online } = useApp();
  const t = value.transfer;
  const [policy, setPolicy] = useState<TransferPolicy>('origin_keeps');
  const [notified, setNotified] = useState(
    t?.followUps[0]?.clientNotified ??
      '原社工已向客户说明：服务方要求补齐行动能力评估，后续由唯一责任机构联系，无需客户自行追问。',
  );
  const [contactText, setContactText] = useState('已向客户说明补件原因，约定 06-04 前补做行动能力评估。');
  const [closingAttempt, setClosingAttempt] = useState<string | null>(null);

  const myOrg = actorOrgId(actor, t);
  const orgName = useMemo(() => {
    if (!t) return '—';
    if (myOrg === t.originOrg.id) return t.originOrg.name;
    if (myOrg === t.receivingOrg.id) return t.receivingOrg.name;
    return myOrg ?? '未标注机构';
  }, [t, myOrg]);
  // 注意：hooks 必须在任何 early return 之前调用
  const violations = useMemo(() => (t ? validateTransfer(value) : []), [value, t]);

  if (!t) {
    return <div className="banner info">本案卷没有迁居移交信息。</div>;
  }

  const fu = findFollowUp(t, C21.referralId) ?? t.followUps[0];
  const referral: Referral | undefined =
    value.referrals.find((r) => r.id === (fu?.referralId ?? C21.referralId)) ?? value.referrals[0];
  const timeline = referral ? sortedTimeline(referral) : [];
  const tasks = t.tasks.filter((x) => x.status === 'open');
  const allTasks = t.tasks;
  const activated = Boolean(t.activatedAt && t.followUps.length > 0);
  const canSummary = summaryVisibleTo(t.orgScopes, myOrg);
  const guard = referral ? canContact(referral, t, myOrg) : { ok: false as const, reason: 'no_follow_up' as const };
  const pendingOffline = (t.pendingOffline ?? []).filter((e) => e.referralId === referral?.id);

  async function activatePolicy() {
    await patchDraft(caseId, `确认移交方式：${policyLabel(policy)}`, (doc) => {
      const next = activateTransferOnCase(
        doc,
        policy,
        notified.trim() ||
          '客户已获告知：后续由唯一责任机构负责补件与联系，无需自行重复询问。',
        `${t!.moveInDate}T12:00:00+08:00`,
      );
      applyCaseInPlace(doc, next);
    });
    pushToast('已写入唯一跟进责任，客户告知同步归入转介时间线', 'success');
  }

  async function providerReceipt(kind: 'returned' | 'accepted' | 'declined' | 'duplicate') {
    if (!referral) return;
    if (kind === 'duplicate' && referral.providerDecision !== 'returned') {
      pushToast('请先登记一次退回回执，再演示“重复送达”；否则会被当作首次退回。', 'warn');
      return;
    }
    const decision = kind === 'duplicate' ? 'returned' : kind;
    await patchDraft(caseId, kind === 'duplicate' ? '模拟服务方重复送达回执' : `登记服务方回执：${kind}`, (doc) => {
      const res = applyProviderReceipt({
        caseFile: doc,
        referralId: referral.id,
        decision,
        referenceNo: C21.returnReference,
        receivedAt: kind === 'duplicate' ? '2026-06-02T10:04:00+08:00' : C21.returnAt,
        reason:
          kind === 'accepted'
            ? '材料齐全，进入评估排期'
            : kind === 'declined'
              ? '服务方明确表示该区不再承接此类评估'
              : '缺少行动能力评估，无法确定康复训练方案',
        missingMaterials: ['行动能力评估'],
        supplementDue: C21.supplementDue,
        actorName: '区康复服务指导中心',
        orgId: 'org-rehab',
      });
      applyCaseInPlace(doc, res.caseFile);
    });
    if (kind === 'duplicate') {
      pushToast('已模拟重复送达同一退回回执：不会新增第二次催办（本机草稿，待同步）', 'info');
    } else {
      pushToast(`服务方回执已登记（${kind}），归入同一转介时间线`, 'success');
    }
  }

  async function lateSync() {
    if (!referral) return;
    await patchDraft(caseId, '补传原机构 05-31 离线客户联系', (doc) => {
      const events = (doc.transfer?.pendingOffline ?? []).filter((e) => e.referralId === referral.id);
      const next = replayLateSync(doc, events);
      applyCaseInPlace(doc, next);
    });
    pushToast('离线记录已补传入同一时间线；责任归属与转介状态均未改变', 'warn');
  }

  async function addContact() {
    if (!referral) return;
    if (!guard.ok) {
      pushToast(
        guard.reason === 'not_owner'
          ? `仅唯一责任机构可发起联系（当前责任：${guard.ownerOrgId}）`
          : '当前没有可发起联系的责任记录',
        'error',
      );
      return;
    }
    await patchDraft(caseId, '记录客户联系（唯一责任机构）', (doc) => {
      const res = recordClientContact({
        caseFile: doc,
        referralId: referral.id,
        callerOrgId: myOrg,
        callerName: `${actor?.name ?? '社工'}（${orgName}）`,
        at: new Date().toISOString(),
        content: contactText.trim() || '已向客户说明进展。',
      });
      if ('caseFile' in res) applyCaseInPlace(doc, res.caseFile);
    });
    pushToast('客户联系已归入该转介时间线（本机草稿，待同步）', 'success');
  }

  async function finishTask(taskId: string) {
    await patchDraft(caseId, '完成补齐/催办任务', (doc) => {
      const res = completeFollowUpTask(doc, taskId, myOrg, new Date().toISOString());
      if ('caseFile' in res) applyCaseInPlace(doc, res.caseFile);
      else pushToast('仅任务持有机构可以完成该任务', 'error');
    });
  }

  async function tryClose() {
    if (!referral) return;
    const clone = structuredClone(value);
    const r = clone.referrals.find((x) => x.id === referral.id);
    if (!r) return;
    r.status = '已办结';
    const v = validateTransfer(clone, { previous: value });
    const hit = v.find((x) => x.code === 'TRANSFER_CLOSE_WITH_OPEN_REFERRAL');
    setClosingAttempt(
      hit
        ? '拦截成功：' + hit.detail
        : '当前转介已有服务方最终回执，允许结案（可在正式流程中标为已办结）。',
    );
  }

  return (
    <div className="transfer-wrap">
      <section className="card">
        <div className="card-hd">
          <h3>迁居移交概况</h3>
          <Badge tone={activated ? 'green' : 'amber'}>{activated ? '已确定唯一跟进责任' : '尚未确定移交方式'}</Badge>
        </div>
        <div className="card-bd">
          <div className="transfer-orgrow">
            <div className="org-card">
              <span className="small muted">原机构</span>
              <b>{t.originOrg.name}</b>
              <span className="small">{t.originOrg.district}</span>
            </div>
            <div className="org-arrow" aria-hidden>
              →
            </div>
            <div className="org-card">
              <span className="small muted">接收机构（迁入日 {t.moveInDate}）</span>
              <b>{t.receivingOrg.name}</b>
              <span className="small">{t.receivingOrg.district}</span>
            </div>
          </div>
          <div className="small mt8">
            <span className="mr">
              服务计划已接收：{fullTime(t.planReceivedAt)}
            </span>
            <span className="mr">预约已接收：{fullTime(t.appointmentReceivedAt)}</span>
            <span>当前登录机构：<b>{orgName}</b></span>
          </div>
          <div className="banner info mt8" style={{ marginBottom: 0 }}>
            客户偏好：{t.clientPreference}
          </div>
          <div className="small muted mt8">
            授权范围：{Object.entries(t.orgScopes).map(([k, v]) => `${k === t.originOrg.id ? '原机构' : k === t.receivingOrg.id ? '新机构' : '服务方'} = ${v.join('、')}`).join('；')}。
            两机构均只能依据授权范围查看必要摘要，完整客户联系记录不跨机构暴露。
          </div>
        </div>
      </section>

      <div className="grid-2">
        <section className="card">
          <div className="card-hd">
            <h3>唯一跟进责任</h3>
            {activated ? <Badge tone="green">已生效</Badge> : <Badge tone="amber">待选择</Badge>}
          </div>
          <div className="card-bd">
            {!activated && (
              <div className="mb8">
                <span className="field-label">选择移交方式（两种都必须保证截止日前有人处理）</span>
                <div className="check-row" role="radiogroup" aria-label="移交方式">
                  <label className="check-pill">
                    <input
                      type="radio"
                      name="transfer-policy"
                      checked={policy === 'origin_keeps'}
                      onChange={() => setPolicy('origin_keeps')}
                    />
                    原机构续办（熟悉情况的社工继续沟通，直至服务方接受/明确拒绝）
                  </label>
                  <label className="check-pill">
                    <input
                      type="radio"
                      name="transfer-policy"
                      checked={policy === 'transfer_on_move_in'}
                      onChange={() => setPolicy('transfer_on_move_in')}
                    />
                    迁入日转给新机构（符合本地归口，接续既有沟通并让原团队停止联系）
                  </label>
                </div>
                <div className="field mt8">
                  <label htmlFor="client-notify">客户已获告知的内容</label>
                  <textarea
                    id="client-notify"
                    className="textarea"
                    value={notified}
                    onChange={(e) => setNotified(e.target.value)}
                  />
                </div>
                <button className="btn btn-primary" onClick={activatePolicy} disabled={!online}>
                  确认移交方式并写入唯一跟进责任
                </button>
              </div>
            )}

            {activated && fu && (
              <>
                <dl className="kv">
                  <dt>责任机构</dt>
                  <dd>
                    <b>{fu.ownerOrgId === t.originOrg.id ? t.originOrg.name : t.receivingOrg.name}</b>{' '}
                    <Badge tone="purple">{policyLabel(fu.policy)}</Badge>
                  </dd>
                  <dt>责任人</dt>
                  <dd>{fu.ownerName}</dd>
                  <dt>下一动作</dt>
                  <dd>{nextActionLabel(fu.nextAction)}</dd>
                  <dt>下一次联系期限</dt>
                  <dd>
                    <b>{fu.nextContactDue}</b>
                  </dd>
                  <dt>说明</dt>
                  <dd>{fu.nextContactNote}</dd>
                  <dt>客户已获告知</dt>
                  <dd>
                    {fu.clientNotified}
                    <div className="small muted">
                      由 {fu.clientNotifiedBy} 于 {fullTime(fu.clientNotifiedAt)} 告知
                    </div>
                  </dd>
                  <dt>责任转移次数</dt>
                  <dd>{fu.movedCount}</dd>
                </dl>
                <p className="small muted">
                  唯一责任约束：任何时刻只有一个机构能发起客户或服务方联系；按钮会按当前登录机构判定是否允许。
                  切换移交方式会重新生成责任并记录 movedCount，不改变已完成家访的历史归属。
                </p>
                <details className="mt8">
                  <summary className="small">重新选择移交方式（用于对照回放，记录责任转移次数）</summary>
                  <div className="check-row mt8" role="radiogroup" aria-label="重新选择移交方式">
                    <label className="check-pill">
                      <input
                        type="radio"
                        name="transfer-policy-re"
                        checked={policy === 'origin_keeps'}
                        onChange={() => setPolicy('origin_keeps')}
                      />
                      原机构续办
                    </label>
                    <label className="check-pill">
                      <input
                        type="radio"
                        name="transfer-policy-re"
                        checked={policy === 'transfer_on_move_in'}
                        onChange={() => setPolicy('transfer_on_move_in')}
                      />
                      迁入日转给新机构
                    </label>
                    <button className="btn btn-sm" onClick={activatePolicy} disabled={!online || policy === fu.policy}>
                      应用并记录转移
                    </button>
                  </div>
                </details>
              </>
            )}
          </div>
        </section>

        <section className="card">
          <div className="card-hd">
            <h3>跟进任务（{tasks.length} 项未完成）</h3>
          </div>
          <div className="card-bd">
            {tasks.length === 0 && <p className="muted small">暂无未完成任务。</p>}
            {tasks.map((task) => (
              <div className="entity" key={task.id}>
                <div className="entity-hd">
                  <span className="entity-title">{taskKindLabel(task.kind)}</span>
                  <Badge tone="amber">截止 {task.dueAt}</Badge>
                </div>
                <div className="small">{task.note}</div>
                <div className="small muted">持有机构：{task.ownerName}</div>
                <div className="flex mt8">
                  <button
                    className="btn btn-sm"
                    onClick={() => finishTask(task.id)}
                    disabled={!online || task.ownerOrgId !== myOrg}
                    title={task.ownerOrgId !== myOrg ? '仅唯一责任机构可完成' : '标记补齐并联系服务方'}
                  >
                    标记已补齐并联系服务方
                  </button>
                  {task.ownerOrgId !== myOrg && <span className="small muted">仅责任机构可操作</span>}
                </div>
              </div>
            ))}
            {allTasks.some((x) => x.status !== 'open') && (
              <details className="mt8">
                <summary className="small">已关闭任务（{allTasks.filter((x) => x.status !== 'open').length}）</summary>
                {allTasks
                  .filter((x) => x.status !== 'open')
                  .map((x) => (
                    <div className="small muted" key={x.id}>
                      [{x.status}] {x.note}
                    </div>
                  ))}
              </details>
            )}
          </div>
        </section>
      </div>

      {referral && (
        <section className="card">
          <div className="card-hd">
            <h3>转介 {referral.applicationNo ?? referral.id} · {referral.org}</h3>
            <StatusBadge value={referral.status} />
          </div>
          <div className="card-bd">
            <div className="grid-2">
              <div>
                <dl className="kv">
                  <dt>原申请编号</dt>
                  <dd className="mono">{referral.applicationNo ?? '—'}</dd>
                  <dt>服务事项</dt>
                  <dd>{referral.service}</dd>
                  <dt>已提交材料</dt>
                  <dd>{(referral.submittedMaterials ?? []).join('、') || '—'}</dd>
                  <dt>服务方回执</dt>
                  <dd>
                    {referral.receiptNo ? (
                      <>
                        {referral.receiptNo} · {referral.receiptAt ? fullTime(referral.receiptAt) : ''}{' '}
                        <Badge tone={referral.status === '已退回补件' ? 'red' : referral.status === '已接收回执' ? 'green' : 'gray'}>
                          {referral.providerDecision === 'returned'
                            ? '退回补件'
                            : referral.providerDecision === 'accepted'
                              ? '已接收'
                              : referral.providerDecision === 'declined'
                                ? '明确拒绝'
                                : '待回执'}
                        </Badge>
                      </>
                    ) : (
                      '尚未收到回执'
                    )}
                  </dd>
                  {referral.providerReturn && (
                    <>
                      <dt>退回原因</dt>
                      <dd>{referral.providerReturn.reason}</dd>
                      <dt>缺少材料 / 补齐截止</dt>
                      <dd>
                        <b>{referral.providerReturn.missingMaterials.join('、')}</b> · 截止{' '}
                        <b>{referral.providerReturn.supplementDue}</b>
                      </dd>
                    </>
                  )}
                  <dt>机构可见摘要</dt>
                  <dd>
                    {canSummary
                      ? referral.shareSummary ?? referral.reason
                      : '当前机构未被授权查看转介摘要，仅能确认该转介存在。'}
                  </dd>
                </dl>
              </div>
              <div>
                <div className="field-label">演示动作</div>
                <div className="flex" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                  <button className="btn btn-sm btn-warn" onClick={() => providerReceipt('returned')}>
                    模拟服务方 06-02 10:00 退回（缺行动能力评估）
                  </button>
                  <button className="btn btn-sm" onClick={() => providerReceipt('duplicate')}>
                    重复送达同一退回回执（验证不重复催办）
                  </button>
                  <button className="btn btn-sm" onClick={() => providerReceipt('accepted')}>
                    模拟服务方最终接收回执
                  </button>
                  <button className="btn btn-sm" onClick={() => providerReceipt('declined')}>
                    模拟服务方明确拒绝
                  </button>
                  <button className="btn btn-sm" onClick={lateSync} disabled={pendingOffline.length === 0}>
                    补传原机构 05-31 离线客户联系（{pendingOffline.length} 条待补传）
                  </button>
                  <button className="btn btn-sm" onClick={tryClose}>
                    尝试把 RH-4 标成“已办结”（演示守卫）
                  </button>
                </div>
                {closingAttempt && (
                  <div className="banner warn mt8" style={{ marginBottom: 0 }}>
                    {closingAttempt}
                  </div>
                )}
                <div className="field mt8">
                  <label htmlFor="client-contact">记录客户联系（仅唯一责任机构可写）</label>
                  <textarea
                    id="client-contact"
                    className="textarea"
                    value={contactText}
                    onChange={(e) => setContactText(e.target.value)}
                  />
                  <button className="btn btn-sm btn-primary mt8" onClick={addContact} disabled={!online}>
                    写入同一转介时间线
                  </button>
                  {!guard.ok && (
                    <p className="hint" style={{ color: 'var(--red-700)' }}>
                      当前机构不可发起联系：
                      {guard.reason === 'not_owner'
                        ? `责任在 ${guard.ownerOrgId}（${fu?.ownerName}）。`
                        : '尚未确定唯一责任。'}
                    </p>
                  )}
                </div>
              </div>
            </div>

            {violations.length > 0 && (
              <div className="banner error mt8">
                <b>移交不变量校验：</b>
                <ul style={{ margin: '4px 0 0 18px', padding: 0 }}>
                  {violations.map((v, i) => (
                    <li key={i}>
                      {v.title} — {v.detail}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </section>
      )}

      {referral && (
        <section className="card">
          <div className="card-hd">
            <h3>转介时间线（服务方回执与客户联系同一时间线）</h3>
            <Badge tone="purple">{timeline.length} 条事件</Badge>
          </div>
          <div className="card-bd">
            {timeline.length === 0 && <p className="muted small">暂无事件。</p>}
            <ul className="timeline">
              {timeline.map((e) => {
                const shown = visibleTimelineEvent(e, t, myOrg);
                return (
                  <li key={e.id} className={`role-${e.kind === 'provider_return' ? 'system' : 'social_worker'}`}>
                    <div className="audit-summary">
                      <Badge tone={EVENT_TONE[e.kind]}>{EVENT_LABEL[e.kind]}</Badge>{' '}
                      {shown.summary}
                    </div>
                    <div className="audit-meta">
                      <span>业务时间 {fullTime(e.at)}</span>
                      {e.recordedAt && <span>落库 {fullTime(e.recordedAt)}</span>}
                      <span>归属机构 {e.orgId}</span>
                      <span>{e.actorName}</span>
                      {e.lateSync && <Badge tone="amber">迟到同步</Badge>}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        </section>
      )}

      <section className="card">
        <div className="card-hd">
          <h3>已完成家访的历史归属（交接不改变）</h3>
        </div>
        <div className="card-bd">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>记录</th>
                  <th>日期</th>
                  <th>完成情况</th>
                  <th>完成机构</th>
                </tr>
              </thead>
              <tbody>
                {value.visits.map((v) => {
                  const org = visitAttribution(value, v);
                  return (
                    <tr key={v.id}>
                      <td className="mono">{v.id}</td>
                      <td>{v.serviceDate}</td>
                      <td>{v.fulfillment === 'completed' ? '已完成' : v.fulfillment || '未登记'}</td>
                      <td>
                        {org === t.originOrg.id
                          ? t.originOrg.name
                          : org === t.receivingOrg.id
                            ? t.receivingOrg.name
                            : org ?? '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="small muted mt8" style={{ marginBottom: 0 }}>
            06-03 的预约仍在新机构待访；移交只重排未结束事项的跟进责任，05-18 / 05-26 已完成家访始终归属原机构。
          </p>
        </div>
      </section>
    </div>
  );
}
