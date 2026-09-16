import { observer, useService } from '@rabjs/react';
import { useEffect } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router';
import { ROUTES } from '@/routes';
import { AuthService } from '@/services/auth.service';

export const RequireAuth = observer(function RequireAuth() {
  const auth = useService(AuthService);
  const location = useLocation();
  const navigate = useNavigate();
  const fromPath = location.pathname === ROUTES.login ? ROUTES.home : location.pathname;

  useEffect(() => {
    if (auth.bootstrapping || auth.bootstrapError || auth.user) return;
    navigate(ROUTES.login, { replace: true, state: { from: fromPath } });
  }, [auth.user, auth.bootstrapping, auth.bootstrapError, fromPath, navigate]);

  if (auth.bootstrapping) {
    return (
      <div className="splash">
        <p className="brand-mark">Inwit</p>
      </div>
    );
  }

  if (auth.bootstrapError) {
    return (
      <div className="splash">
        <p className="brand-mark">Inwit</p>
        <p className="banner-error" role="alert">
          {auth.bootstrapError}
        </p>
        <button type="button" className="btn-primary" onClick={() => void auth.bootstrap()}>
          重试
        </button>
      </div>
    );
  }

  if (!auth.user) {
    return (
      <div className="splash">
        <p className="brand-mark">Inwit</p>
      </div>
    );
  }

  return <Outlet />;
});
