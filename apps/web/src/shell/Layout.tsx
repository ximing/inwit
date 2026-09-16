import { bindServices, observer, useService } from '@rabjs/react';
import {
  Activity,
  FileText,
  Home,
  LogOut,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Repeat,
  Settings,
  Sun,
  Tags,
  type LucideIcon,
} from 'lucide-react';
import { useEffect } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { isSearchHotkey, requestSearchFocus } from '@/components/search';
import { UserAvatar } from '@/components/user-avatar';
import { ROUTES } from '@/routes';
import { AppService } from '@/services/app.service';
import { AuthService } from '@/services/auth.service';
import { ScreenshotService } from '@/services/screenshot.service';
import { ThemeService } from '@/services/theme.service';
import { UiPrefsService } from '@/services/ui-prefs.service';
import { LayoutService } from './layout.service';

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
  { to: ROUTES.settings, label: '设置', end: false, icon: Settings },
];

const LayoutContent = observer(function LayoutContent() {
  const app = useService(AppService);
  const auth = useService(AuthService);
  const shot = useService(ScreenshotService);
  const theme = useService(ThemeService);
  const layout = useService(LayoutService);
  const prefs = useService(UiPrefsService);
  const navigate = useNavigate();
  const location = useLocation();
  const dark = theme.resolved === 'dark';
  const collapsed = prefs.navRailCollapsed;
  const label = auth.displayLabel;

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
    <div className="shell">
      <aside className={collapsed ? 'rail is-collapsed' : 'rail'}>
        <div className="brand">
          <div className="brand-text">
            <div className="brand-name">{app.title}</div>
            <div className="brand-tag">扔进去，它来消化</div>
          </div>
          <button
            type="button"
            className="rail-collapse"
            aria-label={collapsed ? '展开导航' : '收起导航'}
            aria-expanded={!collapsed}
            title={collapsed ? '展开导航' : '收起导航'}
            onClick={() => prefs.toggleNavRail()}
          >
            {collapsed ? <PanelLeftOpen strokeWidth={1.8} /> : <PanelLeftClose strokeWidth={1.8} />}
          </button>
        </div>
        <nav className="nav">
          {NAV.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                data-label={item.label}
                className={({ isActive }) => (isActive ? 'nav-item is-on' : 'nav-item')}
              >
                <span className="nav-ico">
                  <Icon strokeWidth={1.8} />
                </span>
                <span className="nav-label">{item.label}</span>
                {item.badge && layout.dueCount > 0 ? (
                  <span className="nav-badge">{layout.dueCount}</span>
                ) : null}
              </NavLink>
            );
          })}
        </nav>
        <div className="rail-foot">
          <div className="rail-account">
            <NavLink
              to={ROUTES.settings}
              className="rail-user"
              title={label || '设置'}
            >
              <UserAvatar />
              <span className="rail-user-meta">
                <span className="rail-email">{label}</span>
              </span>
            </NavLink>
            <div className="rail-tools">
              <button
                type="button"
                className="rail-icon-btn"
                onClick={() => theme.toggleLightDark()}
                aria-label={dark ? '切换到浅色' : '切换到深色'}
                title={dark ? '浅色' : '深色'}
              >
                {dark ? <Sun strokeWidth={1.8} /> : <Moon strokeWidth={1.8} />}
                <span className="rail-tool-label">{dark ? '浅色' : '深色'}</span>
              </button>
              <button
                type="button"
                className="rail-icon-btn"
                onClick={() => void auth.logout()}
                aria-label="退出"
                title="退出"
              >
                <LogOut strokeWidth={1.8} />
                <span className="rail-tool-label">退出</span>
              </button>
            </div>
          </div>
        </div>
      </aside>
      <main className="main">
        <Outlet />
      </main>
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

export const Layout = bindServices(LayoutContent, [LayoutService]);
