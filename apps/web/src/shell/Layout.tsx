import { observer, useService } from '@rabjs/react';
import type { ReactNode } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';
import { ROUTES } from '@/routes';
import { AppService } from '@/services/app.service';
import { AuthService } from '@/services/auth.service';
import { ThemeService } from '@/services/theme.service';

const NAV = [
  { to: ROUTES.home, label: '文档', end: true, icon: 'doc', muted: false },
  { to: ROUTES.review, label: '复习', end: false, icon: 'review', muted: false },
  { to: ROUTES.topics, label: '主题', end: false, icon: 'topic', muted: false },
  { to: ROUTES.settings, label: '设置', end: false, icon: 'settings', muted: false },
  { to: ROUTES.admin, label: '任务与用量', end: false, icon: 'admin', muted: true },
] as const;

function RailIcon({ children }: { children: ReactNode }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.25"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

function NavGlyph({ name }: { name: (typeof NAV)[number]['icon'] }) {
  switch (name) {
    case 'doc':
      return (
        <RailIcon>
          <rect x="4" y="2.5" width="8" height="11" rx="1.2" />
          <path d="M6 6h4M6 8.5h4M6 11h2.5" />
        </RailIcon>
      );
    case 'review':
      return (
        <RailIcon>
          <rect x="3.5" y="4.5" width="9" height="8.5" rx="1.2" />
          <path d="M5.5 2.8h5" />
        </RailIcon>
      );
    case 'topic':
      return (
        <RailIcon>
          <path d="M3.5 3.8h9a1.3 1.3 0 0 1 1.3 1.3v5.1a1.3 1.3 0 0 1-1.3 1.3H7L4.2 13.6V11.5H3.5A1.3 1.3 0 0 1 2.2 10.2V5.1A1.3 1.3 0 0 1 3.5 3.8z" />
        </RailIcon>
      );
    case 'settings':
      return (
        <RailIcon>
          <path d="M3 5.2h10M3 10.8h10" />
          <circle cx="6.2" cy="5.2" r="1.35" fill="currentColor" stroke="none" />
          <circle cx="9.8" cy="10.8" r="1.35" fill="currentColor" stroke="none" />
        </RailIcon>
      );
    case 'admin':
      return (
        <RailIcon>
          <path d="M4.2 11.2V7.4M8 11.2V4.6M11.8 11.2V8.2" />
          <path d="M3 12.4h10" />
        </RailIcon>
      );
  }
}

function IconSun() {
  return (
    <RailIcon>
      <circle cx="8" cy="8" r="2.6" />
      <path d="M8 2.4v1.2M8 12.4v1.2M2.4 8h1.2M12.4 8h1.2M4.1 4.1l.85.85M11.05 11.05l.85.85M4.1 11.9l.85-.85M11.05 4.95l.85-.85" />
    </RailIcon>
  );
}

function IconMoon() {
  return (
    <RailIcon>
      <path d="M10.1 2.6A5.5 5.5 0 1 0 13.4 10 4.3 4.3 0 0 1 10.1 2.6z" />
    </RailIcon>
  );
}

export const Layout = observer(function Layout() {
  const app = useService(AppService);
  const auth = useService(AuthService);
  const theme = useService(ThemeService);
  const location = useLocation();
  const dark = theme.resolved === 'dark';
  const inDocs =
    location.pathname.startsWith('/editor') ||
    location.pathname.startsWith('/doc') ||
    location.pathname.startsWith('/cards');

  return (
    <div className="app-shell">
      <aside className="rail">
        <div className="rail-brand">
          <span className="brand-mark">{app.title}</span>
          <span className="rail-tag">扔进去，它来消化</span>
        </div>
        <nav className="rail-nav">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => {
                const on = isActive || (item.to === ROUTES.home && inDocs);
                const classes = [on ? 'is-on' : '', item.muted ? 'is-muted' : '']
                  .filter(Boolean)
                  .join(' ');
                return classes || undefined;
              }}
            >
              <NavGlyph name={item.icon} />
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="rail-foot">
          <p className="rail-user">{auth.user?.email}</p>
          <button
            type="button"
            className="theme-toggle"
            onClick={() => theme.toggleLightDark()}
            aria-label={dark ? '切换到浅色' : '切换到深色'}
            title={dark ? '浅色' : '深色'}
          >
            {dark ? <IconSun /> : <IconMoon />}
          </button>
          <button type="button" className="btn-ghost" onClick={() => void auth.logout()}>
            退出
          </button>
        </div>
      </aside>
      <main className="stage">
        <Outlet />
      </main>
    </div>
  );
});
