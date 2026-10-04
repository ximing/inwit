import { bindServices, observer, useService } from '@rabjs/react';
import {
  Activity,
  FileText,
  Home,
  Library,
  LogOut,
  Moon,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Repeat,
  Settings,
  Sun,
  Tags,
  type LucideIcon,
} from 'lucide-react';
import { Suspense, useEffect } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { isSearchHotkey, requestSearchFocus } from '@/components/search/search-hotkey';
import { Tip } from '@/components/tip';
import { UserAvatar } from '@/components/user-avatar';
import { ROUTES } from '@/routes';
import { AuthService } from '@/services/auth.service';
import { ScreenshotService } from '@/services/screenshot.service';
import { SyncService } from '@/services/sync.service';
import { ThemeService } from '@/services/theme.service';
import { UiPrefsService } from '@/services/ui-prefs.service';
import { AssistantRail } from './assistant-rail';
import { AssistantService } from './assistant.service';
import { LayoutService } from './layout.service';
import { prefetchPage, scheduleShellPrefetch } from './page-loaders';

const NAV: ReadonlyArray<{
  to: string;
  label: string;
  end: boolean;
  icon: LucideIcon;
  badge?: boolean;
}> = [
  { to: ROUTES.home, label: '首页', end: true, icon: Home },
  { to: ROUTES.docs, label: '文档', end: false, icon: FileText },
  { to: ROUTES.review, label: '复习', end: false, icon: Repeat, badge: true },
  { to: ROUTES.topics, label: '主题', end: false, icon: Tags },
  { to: ROUTES.jobs, label: '任务', end: false, icon: Activity },
  { to: ROUTES.memory, label: '记忆', end: false, icon: Library },
  { to: ROUTES.settings, label: '设置', end: false, icon: Settings },
];

const LayoutContent = observer(function LayoutContent() {
  const auth = useService(AuthService);
  const shot = useService(ScreenshotService);
  const theme = useService(ThemeService);
  // bindServices does not construct the class.
  useService(SyncService);
  const layout = useService(LayoutService);
  const prefs = useService(UiPrefsService);
  const navigate = useNavigate();
  const location = useLocation();
  const dark = theme.resolved === 'dark';
  const collapsed = prefs.navRailCollapsed;
  const label = auth.displayLabel;
  const search = new URLSearchParams(location.search);
  const zen =
    prefs.zenMode &&
    search.has('doc') &&
    (location.pathname === ROUTES.docs ||
      (location.pathname === ROUTES.topics && search.has('topic')));

  useEffect(() => scheduleShellPrefetch(location.pathname), [location.pathname]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!isSearchHotkey(event)) return;
      event.preventDefault();
      const path = location.pathname;
      if (path !== ROUTES.home && path !== ROUTES.docs && path !== ROUTES.topics) {
        navigate(ROUTES.docs, { state: { focusSearch: true } });
      }
      requestSearchFocus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [location.pathname, navigate]);

  return (
    <div className={zen ? 'shell is-zen' : 'shell'}>
      <aside className={collapsed ? 'rail is-collapsed' : 'rail'}>
        <div className="brand">
          <div className="brand-text">
            <div className="brand-name">Inwit</div>
            <div className="brand-tag">扔进去，它来消化</div>
          </div>
          <Tip content={collapsed ? '展开导航' : '收起导航'} side="right">
            <button
              type="button"
              className="rail-collapse"
              aria-label={collapsed ? '展开导航' : '收起导航'}
              aria-expanded={!collapsed}
              onClick={() => prefs.toggleNavRail()}
            >
              {collapsed ? <PanelLeftOpen strokeWidth={1.8} /> : <PanelLeftClose strokeWidth={1.8} />}
            </button>
          </Tip>
        </div>
        <nav className="nav">
          {NAV.map((item) => {
            const Icon = item.icon;
            return (
              <Tip key={item.to} content={collapsed ? item.label : undefined} side="right">
                <NavLink
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) => (isActive ? 'nav-item is-on' : 'nav-item')}
                  onPointerEnter={() => prefetchPage(item.to)}
                  onFocus={() => prefetchPage(item.to)}
                >
                  <span className="nav-ico">
                    <Icon strokeWidth={1.8} />
                  </span>
                  <span className="nav-label">{item.label}</span>
                  {item.badge && layout.dueCount > 0 ? (
                    <span className="nav-badge">{layout.dueCount}</span>
                  ) : null}
                </NavLink>
              </Tip>
            );
          })}
        </nav>
        <div className="rail-foot">
          <div className="rail-account">
            <Tip content={collapsed ? label || '设置' : undefined} side="top">
              <NavLink
                to={ROUTES.settings}
                className="rail-user"
                onPointerEnter={() => prefetchPage(ROUTES.settings)}
                onFocus={() => prefetchPage(ROUTES.settings)}
              >
                <UserAvatar />
                <span className="rail-user-meta">
                  <span className="rail-email">{label}</span>
                </span>
              </NavLink>
            </Tip>
            <Tip content="账户菜单" side="right">
              <button
                type="button"
                className="rail-more"
                aria-label="账户菜单"
                aria-haspopup="menu"
              >
                <MoreHorizontal strokeWidth={1.8} />
              </button>
            </Tip>
            <div className="rail-menu" role="menu">
              <button
                type="button"
                role="menuitem"
                className="rail-menu-btn"
                onClick={() => theme.toggleLightDark()}
              >
                {dark ? <Sun strokeWidth={1.8} /> : <Moon strokeWidth={1.8} />}
                <span>{dark ? '切换为浅色' : '切换为深色'}</span>
              </button>
              <button
                type="button"
                role="menuitem"
                className="rail-menu-btn"
                onClick={() => void auth.logout()}
              >
                <LogOut strokeWidth={1.8} />
                <span>退出登录</span>
              </button>
            </div>
          </div>
        </div>
      </aside>
      <main className="main">
        <Suspense fallback={<p className="empty">正在打开…</p>}>
          <Outlet />
        </Suspense>
      </main>
      <AssistantRail />
      {shot.toast ? (
        <p className="toast" role="status">
          {shot.toast}
        </p>
      ) : null}
      {shot.error ? (
        <p className="banner-error shot-error" role="alert">
          {shot.error}
        </p>
      ) : null}
    </div>
  );
});

export const Layout = bindServices(LayoutContent, [SyncService, LayoutService, AssistantService]);
