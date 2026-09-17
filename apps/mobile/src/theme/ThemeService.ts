import AsyncStorage from '@react-native-async-storage/async-storage';
import { Service, useService } from '@rabjs/react';
import { Appearance, type ColorSchemeName } from 'react-native';
import { tokensFor, type ThemeTokens } from './tokens';

export type ThemePreference = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

/** Must match the web localStorage key. */
export const THEME_STORAGE_KEY = 'inwit-theme';

export const THEME_OPTIONS: ReadonlyArray<{ id: ThemePreference; label: string }> = [
  { id: 'light', label: '浅色' },
  { id: 'dark', label: '深色' },
  { id: 'system', label: '跟随系统' },
];

function isPreference(value: string | null): value is ThemePreference {
  return value === 'light' || value === 'dark' || value === 'system';
}

function systemTheme(scheme?: ColorSchemeName | null): ResolvedTheme {
  return scheme === 'dark' ? 'dark' : 'light';
}

function resolveTheme(preference: ThemePreference, scheme?: ColorSchemeName | null): ResolvedTheme {
  return preference === 'system' ? systemTheme(scheme) : preference;
}

export class ThemeService extends Service {
  preference: ThemePreference = 'system';
  resolved: ResolvedTheme = systemTheme();

  constructor() {
    super();
    this.apply();
    void this.hydrate();
    Appearance.addChangeListener(({ colorScheme }) => {
      if (this.preference === 'system') this.apply(colorScheme ?? null);
    });
  }

  get tokens(): ThemeTokens {
    return tokensFor(this.resolved);
  }

  setPreference(preference: ThemePreference): void {
    this.preference = preference;
    void AsyncStorage.setItem(THEME_STORAGE_KEY, preference).catch(() => {
      // ignore quota / private mode
    });
    this.apply();
  }

  toggleLightDark(): void {
    this.setPreference(this.resolved === 'dark' ? 'light' : 'dark');
  }

  private async hydrate(): Promise<void> {
    try {
      const raw = await AsyncStorage.getItem(THEME_STORAGE_KEY);
      if (isPreference(raw)) this.preference = raw;
    } catch {
      // private mode / blocked storage
    }
    this.apply();
  }

  private apply(scheme?: ColorSchemeName | null): void {
    this.resolved = resolveTheme(this.preference, scheme);
  }
}

/** Current token set for the resolved theme. Call inside `observer`. */
export function useTheme(): ThemeTokens {
  const service = useService(ThemeService);
  return service.tokens;
}
