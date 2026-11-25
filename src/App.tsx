import { useEffect, useMemo } from 'react';
import { HashRouter, NavLink, Route, Routes, useNavigate } from 'react-router-dom';
import { AppProvider, useApp } from './state/AppStore';
import { ToastHost, LiveRegion } from './components/ui';
import { eqValue } from './lib/paths';
import LoginPage from './pages/LoginPage';
import VisitListPage from './pages/VisitListPage';
import CasePage from './pages/CasePage';
import ConflictPage from './pages/ConflictPage';
import SupervisorPage from './pages/SupervisorPage';
import AuditPage from './pages/AuditPage';
import ScenarioPage from './pages/ScenarioPage';

export function AppProviders() {
  return (
    <AppProvider>
      <HashRouter>
        <Boot />
        <ToastHost />
        <LiveRegion />
      </HashRouter>
    </AppProvider>
  );
}

/** 处理 ?as=lin|zhou|wang 的双标签直达登录 */
function Boot() {
  const { actor, loginAs } = useApp();
  const navigate = useNavigate();
  useEffect(() => {
    const as = new URLSearchParams(window.location.search).get('as');
    if (as && ['lin', 'zhou', 'wang', 'sun'].includes(as)) loginAs(as);
  }, [loginAs]);
  useEffect(() => {
    if (actor && window.location.hash === '' ) {
      // 保持默认路由即可
    }
  }, [actor, navigate]);
  return actor ? <Layout /> : <LoginPage />;
}

function Layout() {
  const app = useApp();
  const { actor, online, onlinePref, setOnlinePref, tabId, presence, cases, drafts, outbox } = app;

  const queueCount = useMemo(
    () =>
      cases.reduce(
        (n, c) => n + c.visits.filter((v) => v.status === 'submitted').length,
        0,
      ),
    [cases],
  );
  const draftCount = Object.values(drafts).filter((d) => !eqValue(d.value, d.base)).length;
  const blockedCount = outbox.filter((o) => o.status === 'blocked').length;

  const others = presence.filter((p) => p.tabId !== tabId);

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="logo-dot" aria-hidden />
          邻里个案协作工作台
          <small>React · TS · IndexedDB · WebWorker｜全虚构模拟数据</small>
        </div>
        <div className="spacer" />
        <div className="top-meta">
          <span className="roster" aria-label="当前同源在线标签页">
            <span className="online-pill" title="当前标签页">
              <span className="dot green" />
              本标签 {tabId.slice(-4)}
            </span>
            {others.map((p) => (
              <span className="online-pill" key={p.tabId} title={`标签 ${p.tabId}`}>
                <span className="dot green" />
                {p.actorName ?? '未登录'}·{p.tabId.slice(-4)}
              </span>
            ))}
          </span>
          <button
            className={`btn btn-sm ${online ? '' : 'btn-warn'}`}
            role="switch"
            aria-checked={onlinePref}
            onClick={() => setOnlinePref(!onlinePref)}
            title="切换本标签页的模拟网络状态（另一标签页不受影响）"
          >
            {online ? '📶 网络在线（点击模拟断网）' : '📵 已模拟离线（点击恢复）'}
          </button>
          <span className={`actor-chip ${actor?.role === 'supervisor' ? 'supervisor' : ''}`}>
            {actor?.name}（{actor?.title}）
          </span>
          <button className="btn btn-sm btn-ghost" style={{ color: '#fff' }} onClick={app.logout}>
            退出
          </button>
        </div>
      </header>

      {!online && (
        <div className="offline-strip" role="status">
          离线模式：可继续登记与编辑，内容保存在本标签页的 IndexedDB 草稿中；每项修改都记录了所依据的远端版本，恢复网络后进入三方核对，不会被最后提交者覆盖。
          {app.browserOnline === false && '（浏览器本身也报告离线）'}
          {app.cacheStale && ' 当前列表来自本机只读缓存。'}
        </div>
      )}

      <div className="layout">
        <nav className="sidebar" aria-label="主导航">
          <NavLink to="/" end className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
            待访清单
            {draftCount > 0 && <span className="nav-count">{draftCount} 草稿</span>}
          </NavLink>
          <NavLink
            to="/supervisor"
            className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
          >
            主管确认队列
            {queueCount > 0 && <span className="nav-count">{queueCount}</span>}
          </NavLink>
          <NavLink
            to="/scenarios"
            className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
          >
            样例演练 / 双标签
          </NavLink>
          <NavLink to="/audit" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
            审计日志
            {blockedCount > 0 && <span className="nav-count">{blockedCount}</span>}
          </NavLink>
          <div className="side-foot">
            <p>测试账号统一密码 test1234</p>
            <p>lin.xiao / zhou.ming / wang.min</p>
            <p>冲突核对全程可用键盘 Tab + 方向键操作。</p>
          </div>
        </nav>

        <main className="main" id="main-content">
          <Routes>
            <Route path="/" element={<VisitListPage />} />
            <Route path="/case/:caseId" element={<CasePage />} />
            <Route path="/case/:caseId/conflict" element={<ConflictPage />} />
            <Route path="/supervisor" element={<SupervisorPage />} />
            <Route path="/audit" element={<AuditPage />} />
            <Route path="/scenarios" element={<ScenarioPage />} />
            <Route path="*" element={<VisitListPage />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}
