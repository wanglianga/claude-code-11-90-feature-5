import { useState } from 'react';
import { useApp } from '../state/AppStore';
import { ACCOUNTS } from '../config/accounts';

export default function LoginPage() {
  const { login } = useApp();
  const [account, setAccount] = useState('lin.xiao');
  const [password, setPassword] = useState('test1234');
  const [err, setErr] = useState('');

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const ok = login(account, password);
    if (!ok) setErr('账号或密码不正确（本环境为纯模拟，可直接点选下方测试账号）');
  }

  return (
    <div className="login-wrap">
      <div className="login-card">
        <section className="login-hero">
          <h1>邻里个案协作工作台</h1>
          <p>面向社工与主管的浏览器端个案记录、离线协作与冲突核对原型。</p>
          <ul>
            <li>待访清单按服务对象与预约时段呈现必要资料</li>
            <li>到访、观察、时长、未完成原因、转介全流程登记</li>
            <li>字段级三方合并 与 整次家访确认单元 两种协作粒度</li>
            <li>断网可编辑，恢复后基线 / 本地 / 远端新值并列核对</li>
            <li>取消预约、主管退回、紧急联系人撤权与授权到期守卫</li>
            <li>全部数据为虚构，两个浏览器标签页即可重放同步</li>
          </ul>
          <p className="small" style={{ color: '#99f6e4' }}>
            推荐体验：登录林晓后，到「样例演练 / 双标签」一键打开周明标签页，逐步播放 9:00 rev 7 样例。
          </p>
        </section>

        <form className="login-form" onSubmit={submit} aria-label="模拟登录表单">
          <h2>测试账号</h2>
          <p className="small muted">密码统一为 <code>test1234</code>，仅保存在本浏览器。</p>
          <div className="account-grid" role="group" aria-label="选择测试账号">
            {ACCOUNTS.map((a) => (
              <button
                type="button"
                key={a.id}
                className={`account-card ${account === a.account ? 'sel' : ''}`}
                onClick={() => {
                  setAccount(a.account);
                  setPassword('test1234');
                  setErr('');
                }}
                aria-pressed={account === a.account}
              >
                <b>
                  {a.name} · {a.account}
                </b>
                <span>
                  {a.title}（{a.role === 'supervisor' ? '主管' : '社工'}）
                </span>
              </button>
            ))}
          </div>

          <div className="field">
            <label htmlFor="login-account">账号</label>
            <input
              id="login-account"
              className="input"
              value={account}
              onChange={(e) => setAccount(e.target.value)}
              autoComplete="username"
            />
          </div>
          <div className="field">
            <label htmlFor="login-password">密码</label>
            <input
              id="login-password"
              className="input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </div>
          {err && (
            <div className="banner error" role="alert">
              {err}
            </div>
          )}
          <button className="btn btn-primary btn-block" type="submit">
            进入工作台
          </button>
        </form>
      </div>
    </div>
  );
}
