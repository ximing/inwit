import { observer, useService } from '@rabjs/react';
import { Navigate, Outlet, useLocation } from 'react-router';
import { ROUTES } from '@/routes';
import { AuthService } from '@/services/auth.service';

export const RequireAuth = observer(function RequireAuth() {
  const auth = useService(AuthService);
  const location = useLocation();

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
    return <Navigate to={ROUTES.login} replace state={{ from: location.pathname }} />;
  }

  return <Outlet />;
});
