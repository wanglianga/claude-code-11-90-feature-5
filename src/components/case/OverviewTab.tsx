import { useState } from 'react';
import type { CaseFile } from '../../types';
import { useApp } from '../../state/AppStore';
import RestrictedContact from '../RestrictedContact';
import { Badge } from '../ui';
import { remainLabel } from '../../lib/time';

const SCOPE_OPTIONS = ['基本档案', '健康摘要', '服务计划', '居家环境评估', '紧急联系人', '转介记录'];

export default function OverviewTab({ caseId, value }: { caseId: string; value: CaseFile }) {
  const { patchDraft, grantFor, now, pushToast } = useApp();
  const visit = value.visits.find((v) => v.id === 'visit-main') ?? value.visits[0];
  const [goalText, setGoalText] = useState(visit?.confirmedGoalText ?? '');
  const [scopes, setScopes] = useState<string[]>(visit?.visibleScopes ?? ['基本档案']);
  const grant = grantFor(caseId);

  function toggleScope(s: string) {
    setScopes((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]));
  }

  async function saveConfirmation() {
    await patchDraft(caseId, '确认本次服务目标与可查看字段', (doc) => {
      const v = doc.visits.find((x) => x.id === visit?.id);
      if (v) {
        v.confirmedGoalText = goalText;
        v.visibleScopes = scopes;
      }
    });
    pushToast('已在本机保存本次目标与字段授权范围确认（待同步）', 'success');
  }

  return (
    <div className="grid-2">
      <section className="card">
        <div className="card-hd">
          <h3>服务对象必要资料</h3>
          <Badge tone={value.client.risk === '重点关注' ? 'red' : 'gray'}>{value.client.risk}</Badge>
        </div>
        <div className="card-bd">
          <dl className="kv">
            <dt>个案编号</dt>
            <dd className="mono">{value.client.code}</dd>
            <dt>性别 / 年龄</dt>
            <dd>
              {value.client.gender} · {value.client.age} 岁
            </dd>
            <dt>所属网格</dt>
            <dd>{value.client.district}</dd>
            <dt>地址</dt>
            <dd>{value.client.address}</dd>
            <dt>家庭情况</dt>
            <dd>{value.client.household}</dd>
            <dt>背景摘要</dt>
            <dd>{value.client.background}</dd>
          </dl>
        </div>
      </section>

      <section style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <RestrictedContact caseId={caseId} />

        <div className="card mb0">
          <div className="card-hd">
            <h3>进入个案：目标 · 字段范围 · 授权有效期</h3>
          </div>
          <div className="card-bd">
            <div className="field">
              <label htmlFor="goal-confirm">本次确认的服务目标</label>
              <textarea
                id="goal-confirm"
                className="textarea"
                value={goalText}
                onChange={(e) => setGoalText(e.target.value)}
              />
            </div>
            <div className="field">
              <span className="field-label" id="scope-label">
                本次可查看字段
              </span>
              <div className="check-row" role="group" aria-labelledby="scope-label">
                {SCOPE_OPTIONS.map((s) => (
                  <label className="check-pill" key={s}>
                    <input type="checkbox" checked={scopes.includes(s)} onChange={() => toggleScope(s)} />
                    {s}
                  </label>
                ))}
              </div>
              {scopes.includes('紧急联系人') && !(grant && !grant.revoked && grant.expiresAt > now) && (
                <p className="hint" style={{ color: 'var(--red-700)' }}>
                  已勾选“紧急联系人”，但当前没有有效授权凭据：该字段仍保持遮蔽，需在上方取得限时授权。
                </p>
              )}
            </div>
            <div className="field">
              <span className="field-label">授权有效期核对</span>
              {grant && !grant.revoked ? (
                grant.expiresAt > now ? (
                  <p className="small" style={{ margin: 0 }}>
                    <Badge tone="green">有效</Badge> {grant.granteeName} 的查看授权 {remainLabel(grant.expiresAt, now)}
                    （截止 {new Date(grant.expiresAt).toLocaleString()}）
                  </p>
                ) : (
                  <p className="small" style={{ margin: 0 }}>
                    <Badge tone="amber">已到期</Badge> 界面与缓存将被清除，不能作为查看/提交依据。
                  </p>
                )
              ) : grant?.revoked ? (
                <p className="small" style={{ margin: 0 }}>
                  <Badge tone="red">已撤回</Badge> {grant.revokeReason}
                </p>
              ) : (
                <p className="small muted" style={{ margin: 0 }}>
                  暂无紧急联系人授权；其他常规字段可按社工职责查看。
                </p>
              )}
            </div>
            <button className="btn btn-primary" onClick={saveConfirmation}>
              保存确认（本机，记录基线版本）
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
