import { bindServices, observer, useService } from '@rabjs/react';
import { Navigate, useLocation } from 'react-router';
import { ROUTES } from '@/routes';
import { AuthService } from '@/services/auth.service';
import { LoginService } from './login.service';

const LoginContent = observer(function LoginContent() {
  const auth = useService(AuthService);
  const form = useService(LoginService);
  const location = useLocation();
  const from =
    location.state &&
    typeof location.state === 'object' &&
    'from' in location.state &&
    typeof location.state.from === 'string'
      ? location.state.from
      : ROUTES.home;

  if (auth.user) {
    return <Navigate to={from} replace />;
  }

  return (
    <div className="auth-screen">
      <div className="auth-panel">
        <p className="brand-mark">Inwit</p>
        <h1>{form.mode === 'login' ? '进来复习' : '开一个账'}</h1>
        <p className="lede">把笔记扔进来，它替你切成卡片，到点催你回想。</p>

        <div className="mode-switch" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={form.mode === 'login'}
            className={form.mode === 'login' ? 'is-on' : undefined}
            onClick={() => form.setMode('login')}
          >
            登录
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={form.mode === 'register'}
            className={form.mode === 'register' ? 'is-on' : undefined}
            onClick={() => form.setMode('register')}
          >
            注册
          </button>
        </div>

        <form
          className="stack-form"
          onSubmit={(event) => {
            event.preventDefault();
            void form.submit();
          }}
        >
          <label>
            邮箱
            <input
              type="email"
              name="email"
              autoComplete="email"
              value={form.email}
              onChange={(event) => form.setEmail(event.target.value)}
              required
            />
          </label>
          <label>
            密码
            <input
              type="password"
              name="password"
              autoComplete={form.mode === 'login' ? 'current-password' : 'new-password'}
              value={form.password}
              onChange={(event) => form.setPassword(event.target.value)}
              minLength={8}
              required
            />
            <span className="hint">至少 8 位</span>
          </label>
          {form.error ? (
            <p className="banner-error" role="alert">
              {form.error}
            </p>
          ) : null}
          <button type="submit" className="btn-primary" disabled={!form.canSubmit}>
            {form.$model.submit.loading ? '请稍等…' : form.mode === 'login' ? '登录' : '注册并进入'}
          </button>
        </form>
      </div>
    </div>
  );
});

export const LoginPage = bindServices(LoginContent, [LoginService]);
