import { register, resolve, RSRoot } from '@rabjs/react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { App } from '@/App';
import { AuthService } from '@/services/auth.service';
import { DialogService } from '@/services/dialog.service';
import { ScreenshotService } from '@/services/screenshot.service';
import { ThemeService } from '@/services/theme.service';
import { EditorPresenceService } from '@/services/editor-presence.service';
import { UiPrefsService } from '@/services/ui-prefs.service';
import '@/style-entry.css';

register(AuthService);
register(DialogService);
register(ScreenshotService);
register(ThemeService);
register(UiPrefsService);
register(EditorPresenceService);
resolve(AuthService);
resolve(DialogService);
resolve(ScreenshotService);
resolve(ThemeService);
resolve(UiPrefsService);
resolve(EditorPresenceService);

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
