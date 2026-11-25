import { useState } from 'react';
import { useApp } from '../state/AppStore';
import { remainLabel } from '../lib/time';
import { Badge } from './ui';

export default function RestrictedContact({ caseId }: { caseId: string }) {
  const { now, grantFor, secretFor, requestGrant, revokeGrant, pushToast } = useApp();
  const [busy, setBusy] = useState<number | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState(false);

  const grant = grantFor(caseId);
  const secretEntry = secretFor(caseId);
  const live = secretEntry && secretEntry.expiresAt > now ? secretEntry : null;
  const expiredButNotPurged = secretEntry && secretEntry.expiresAt <= now;

  async function doGrant(ms: number, label: string) {
    setBusy(ms);
    await requestGrant(caseId, ms, label);
    setBusy(null);
  }

  async function copy() {
    if (!live) return;
    const text = `${live.value.name}（${live.value.relation}） ${live.value.phone}`;
    try {
      await navigator.clipboard.writeText(text);
      pushToast('已复制紧急联系人；撤权后系统会尝试清空剪贴板，此前粘贴到别处的内容需自行删除', 'success');
    } catch {
      pushToast('浏览器拒绝了剪贴板写入，请手动选择文本复制', 'warn');
    }
  }

  const ttlPct =
    grant && grant.expiresAt > grant.issuedAt
      ? Math.max(0, Math.min(100, ((grant.expiresAt - now) / (grant.expiresAt - grant.issuedAt)) * 100))
      : 0;

  return (
    <div className="secret-box" aria-label="受限字段：紧急联系人">
      <div className="flex" style={{ justifyContent: 'space-between' }}>
        <b>🔒 紧急联系人（受限字段）</b>
        {live ? (
          <Badge tone="green">授权有效 · {remainLabel(live.expiresAt, now)}</Badge>
        ) : grant?.revoked ? (
          <Badge tone="red">授权已撤回</Badge>
        ) : grant && grant.expiresAt <= now ? (
          <Badge tone="amber">授权已到期</Badge>
        ) : (
          <Badge tone="gray">未授权 · 界面与缓存均遮蔽</Badge>
        )}
      </div>

      <div className="mt8">
        {live ? (
          <>
            <div className="secret-value">
              {live.value.name}
              <span className="small muted" style={{ fontWeight: 400, margin: '0 8px' }}>
                {live.value.relation}
              </span>
              <span className="mono">{live.value.phone}</span>
            </div>
            <div className="ttl-bar" aria-hidden>
              <i style={{ width: `${ttlPct}%` }} />
            </div>
            <div className="small muted">
              缓存凭据 {live.grantId.slice(-10)} · 明确到期时刻{' '}
              {new Date(live.expiresAt).toLocaleString()} · 到期后即使未联网也会遮蔽并清除
            </div>
            <div className="flex mt8">
              <button className="btn btn-sm" onClick={copy}>
                📋 复制
              </button>
              {!confirmRevoke ? (
                <button className="btn btn-sm btn-danger" onClick={() => setConfirmRevoke(true)}>
                  模拟家属撤权
                </button>
              ) : (
                <>
                  <span className="small">确认家属已撤回授权？所有标签页将立即清除。</span>
                  <button
                    className="btn btn-sm btn-danger"
                    onClick={() => {
                      if (grant) void revokeGrant(grant.id, '家属来电：不再同意社工查看紧急联系人');
                      setConfirmRevoke(false);
                    }}
                  >
                    确认撤权并清除
                  </button>
                  <button className="btn btn-sm btn-ghost" onClick={() => setConfirmRevoke(false)}>
                    取消
                  </button>
                </>
              )}
            </div>
          </>
        ) : (
          <>
            <div className="masked" aria-label="已遮蔽的紧急联系人">
              ███ <span style={{ letterSpacing: 1 }}>（关系）</span> 139-████-████
            </div>
            {expiredButNotPurged && (
              <p className="small" style={{ color: 'var(--amber-800)' }}>
                凭据刚到期，界面已先行遮蔽，WebWorker 数秒内将删除持久缓存。
              </p>
            )}
            {grant?.revoked && (
              <div className="banner error mt8" role="alert">
                撤权消息已到达：该值已从界面、持久缓存删除，并已尝试清空剪贴板。{grant.revokeReason}
              </div>
            )}
            <div className="flex mt8">
              <button className="btn btn-sm btn-primary" disabled={busy !== null} onClick={() => doGrant(30 * 60_000, '30 分钟')}>
                {busy === 30 * 60_000 ? <span className="spinner" /> : null}
                家属授权查看 30 分钟
              </button>
              <button className="btn btn-sm btn-warn" disabled={busy !== null} onClick={() => doGrant(20_000, '20 秒（到期演示）')}>
                授予 20 秒（观察自动清除）
              </button>
            </div>
            <p className="small muted mt8" style={{ marginBottom: 0 }}>
              说明：现实中无法承诺“即时远程擦除”一台离线设备上的数据；因此缓存只保存于绑定了明确{' '}
              <code>expiresAt</code> 授权凭据的记录中，到期后即使一直断网，Worker 与页面也会遮蔽并清除该值。
            </p>
          </>
        )}
      </div>
    </div>
  );
}
