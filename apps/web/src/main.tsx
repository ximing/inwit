import { register, resolve, RSRoot } from '@rabjs/react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { App } from '@/App';
import { AuthService } from '@/services/auth.service';
import { ScreenshotService } from '@/services/screenshot.service';
import { ThemeService } from '@/services/theme.service';
import { UiPrefsService } from '@/services/ui-prefs.service';
import '@/styles.css';

register(AuthService);
register(ScreenshotService);
register(ThemeService);
register(UiPrefsService);
resolve(AuthService);
resolve(ScreenshotService);
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
