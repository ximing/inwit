import { Platform, type TextStyle, type ViewStyle } from 'react-native';

/** Tokens translated from docs/design/v2/inwit.css (:root) and the production dark set. */

export const lightColors = {
  bg: '#f6f3ec',
  bgSunken: '#efeade',
  surface: '#fffdf8',
  surface2: '#faf7f0',
  ink: '#221d16',
  ink2: '#574e41',
  ink3: '#8b8172',
  ink4: '#b3a893',
  line: '#e6dfd0',
  lineSoft: '#efe9db',
  accent: '#b3402a',
  accentDeep: '#96321f',
  accentSoft: '#f9ece6',
  accentLine: '#eccfc2',
  gold: '#a97c2f',
  goldSoft: '#f8f0dc',
  goldLine: '#ecd9ac',
  green: '#3e7d54',
  greenSoft: '#e9f2ea',
  greenLine: '#cbe0cf',
  hl: '#f5e3a4',
  prose: '#2b251c',
  onAccent: '#ffffff',
} as const;

export const darkColors = {
  bg: '#1c1915',
  bgSunken: '#15120e',
  surface: '#26221c',
  surface2: '#2e2923',
  ink: '#f0e8d8',
  ink2: '#c9bfae',
  ink3: '#9a8f7d',
  ink4: '#6e6558',
  line: '#3f372c',
  lineSoft: '#332c24',
  accent: '#e06a52',
  accentDeep: '#f08a74',
  accentSoft: '#3a2420',
  accentLine: '#6b3d32',
  gold: '#d4a44a',
  goldSoft: '#3a3018',
  goldLine: '#5c4c24',
  green: '#6faf84',
  greenSoft: '#1c2c22',
  greenLine: '#2f4a38',
  hl: '#4a3f1c',
  prose: '#e8dfd0',
  onAccent: '#ffffff',
} as const;

export type ColorTokens = { [K in keyof typeof lightColors]: string };

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
} as const;

export const spacing = {
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  8: 32,
  10: 40,
  12: 48,
} as const;

export const typography = {
  serif: Platform.select({ ios: 'Songti SC', android: 'serif', default: 'serif' }) as string,
  sans: Platform.select({ ios: 'System', android: 'sans-serif', default: 'System' }) as string,
  mono: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }) as string,
  size: {
    xs: 12,
    sm: 13.5,
    md: 15,
    lg: 17,
    xl: 21,
    '2xl': 26,
  },
  lineHeight: {
    ui: 1.5,
    body: 1.6,
    title: 1.3,
  },
} as const;

export type ShadowTokens = {
  1: ViewStyle;
  2: ViewStyle;
  3: ViewStyle;
};

const warmShadow = 'rgb(60, 48, 30)';

export const lightShadows: ShadowTokens = {
  1: {
    shadowColor: warmShadow,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 1,
  },
  2: {
    shadowColor: warmShadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.09,
    shadowRadius: 16,
    elevation: 4,
  },
  3: {
    shadowColor: warmShadow,
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.14,
    shadowRadius: 32,
    elevation: 8,
  },
};

export const darkShadows: ShadowTokens = {
  1: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.35,
    shadowRadius: 4,
    elevation: 1,
  },
  2: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 16,
    elevation: 4,
  },
  3: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.5,
    shadowRadius: 32,
    elevation: 8,
  },
};

export type ThemeTokens = {
  colors: ColorTokens;
  radius: typeof radius;
  spacing: typeof spacing;
  typography: typeof typography;
  shadow: ShadowTokens;
};

export function tokensFor(resolved: 'light' | 'dark'): ThemeTokens {
  const dark = resolved === 'dark';
  return {
    colors: dark ? darkColors : lightColors,
    radius,
    spacing,
    typography,
    shadow: dark ? darkShadows : lightShadows,
  };
}

export const serifTitle: TextStyle = {
  fontFamily: typography.serif,
  fontWeight: '700',
};
