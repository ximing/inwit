import type { PlatformName, ThemeName } from './protocol';

/** 纸张色系 token：浅色抄自 docs/design/v2/inwit.css :root；深色对齐 web 的 [data-theme=dark]。 */
export const LIGHT_TOKENS: Record<string, string> = {
  '--bg': '#f6f3ec',
  '--bg-sunken': '#efeade',
  '--surface': '#fffdf8',
  '--surface-2': '#faf7f0',
  '--ink': '#221d16',
  '--ink-2': '#574e41',
  '--ink-3': '#8b8172',
  '--ink-4': '#b3a893',
  '--line': '#e6dfd0',
  '--line-soft': '#efe9db',
  '--accent': '#b3402a',
  '--accent-deep': '#96321f',
  '--accent-soft': '#f9ece6',
  '--accent-line': '#eccfc2',
  '--gold': '#a97c2f',
  '--gold-soft': '#f8f0dc',
  '--gold-line': '#ecd9ac',
  '--green': '#3e7d54',
  '--green-soft': '#e9f2ea',
  '--green-line': '#cbe0cf',
  '--hl': '#f5e3a4',
  '--prose': '#2b251c',
  '--serif': '"Source Han Serif SC", "Noto Serif SC", "Songti SC", "SimSun", serif',
  '--sans':
    '-apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Helvetica Neue", "Microsoft YaHei", sans-serif',
  '--mono': '"SF Mono", ui-monospace, Menlo, monospace',
  '--r-sm': '8px',
  '--r-md': '12px',
  '--r-lg': '16px',
  '--r-xl': '20px',
  '--shadow-1': '0 1px 2px rgba(60, 48, 30, 0.05), 0 2px 8px rgba(60, 48, 30, 0.04)',
  '--shadow-2': '0 2px 6px rgba(60, 48, 30, 0.06), 0 12px 32px rgba(60, 48, 30, 0.09)',
  '--shadow-3': '0 8px 24px rgba(60, 48, 30, 0.12), 0 24px 64px rgba(60, 48, 30, 0.14)',
};

export const DARK_TOKENS: Record<string, string> = {
  '--bg': '#1c1915',
  '--bg-sunken': '#15120e',
  '--surface': '#26221c',
  '--surface-2': '#2e2923',
  '--ink': '#f0e8d8',
  '--ink-2': '#c9bfae',
  '--ink-3': '#9a8f7d',
  '--ink-4': '#6e6558',
  '--line': '#3f372c',
  '--line-soft': '#332c24',
  '--accent': '#e06a52',
  '--accent-deep': '#f08a74',
  '--accent-soft': '#3a2420',
  '--accent-line': '#6b3d32',
  '--gold': '#d4a44a',
  '--gold-soft': '#3a3018',
  '--gold-line': '#5c4c24',
  '--green': '#6faf84',
  '--green-soft': '#1c2c22',
  '--green-line': '#2f4a38',
  '--hl': '#4a3f1c',
  '--prose': '#e8dfd0',
  '--serif': '"Source Han Serif SC", "Noto Serif SC", "Songti SC", "SimSun", serif',
  '--sans':
    '-apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Helvetica Neue", "Microsoft YaHei", sans-serif',
  '--mono': '"SF Mono", ui-monospace, Menlo, monospace',
  '--r-sm': '8px',
  '--r-md': '12px',
  '--r-lg': '16px',
  '--r-xl': '20px',
  '--shadow-1': '0 1px 2px rgba(0, 0, 0, 0.35), 0 2px 8px rgba(0, 0, 0, 0.22)',
  '--shadow-2': '0 2px 6px rgba(0, 0, 0, 0.4), 0 12px 32px rgba(0, 0, 0, 0.38)',
  '--shadow-3': '0 8px 24px rgba(0, 0, 0, 0.5), 0 24px 64px rgba(0, 0, 0, 0.42)',
};

export function tokensFor(theme: ThemeName): Record<string, string> {
  return theme === 'dark' ? DARK_TOKENS : LIGHT_TOKENS;
}

export function applyTheme(theme: ThemeName, platform?: PlatformName): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.setAttribute('data-theme', theme);
  root.style.colorScheme = theme;
  if (platform) root.dataset.platform = platform;
  const tokens = tokensFor(theme);
  for (const [name, value] of Object.entries(tokens)) {
    root.style.setProperty(name, value);
  }
}
