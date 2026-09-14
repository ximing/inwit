import { Service } from '@rabjs/react';

export type ThemePreference = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

/** Must match the inline boot script in apps/web/index.html. */
export const THEME_STORAGE_KEY = 'inwit-theme';

export const THEME_OPTIONS: ReadonlyArray<{ id: ThemePreference; label: string }> = [
  { id: 'light', label: '浅色' },
  { id: 'dark', label: '深色' },
  { id: 'system', label: '跟随系统' },
];

function readPreference(): ThemePreference {
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY);
    if (raw === 'light' || raw === 'dark' || raw === 'system') return raw;
  } catch {
    // private mode / blocked storage
  }
  return 'system';
}

function systemTheme(): ResolvedTheme {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function resolveTheme(preference: ThemePreference): ResolvedTheme {
  return preference === 'system' ? systemTheme() : preference;
}

export class ThemeService extends Service {
  preference: ThemePreference = 'system';
  resolved: ResolvedTheme = 'light';

  constructor() {
    super();
    this.preference = readPreference();
    this.apply();
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    media.addEventListener('change', () => {
      if (this.preference === 'system') this.apply();
    });
  }

  setPreference(preference: ThemePreference): void {
    this.preference = preference;
    try {
      localStorage.setItem(THEME_STORAGE_KEY, preference);
    } catch {
      // ignore quota / private mode
    }
    this.apply();
  }

  toggleLightDark(): void {
    this.setPreference(this.resolved === 'dark' ? 'light' : 'dark');
  }

  private apply(): void {
    this.resolved = resolveTheme(this.preference);
    document.documentElement.dataset.theme = this.resolved;
  }
}
