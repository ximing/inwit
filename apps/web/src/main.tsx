import { register, resolve, RSRoot } from '@rabjs/react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { App } from '@/App';
import { AppService } from '@/services/app.service';
import { AuthService } from '@/services/auth.service';
import { ThemeService } from '@/services/theme.service';
import { UiPrefsService } from '@/services/ui-prefs.service';
import '@/styles.css';

register(AppService);
register(AuthService);
register(ThemeService);
register(UiPrefsService);
resolve(AuthService);
resolve(ThemeService);
resolve(UiPrefsService);

const rootEl = document.getElementById('root');
if (rootEl) {
  createRoot(rootEl).render(
    <StrictMode>
      <RSRoot>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </RSRoot>
    </StrictMode>,
  );
}
