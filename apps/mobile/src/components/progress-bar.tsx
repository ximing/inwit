import { View } from 'react-native';
import type { ThemeTokens } from '@/theme';

export function ProgressBar({
  pct,
  theme,
  height = 5,
  color,
}: {
  pct: number;
  theme: ThemeTokens;
  height?: number;
  color?: string;
}) {
  const fill = Math.max(0, Math.min(100, pct));
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(fill) }}
      style={{
        height,
        borderRadius: height,
        backgroundColor: theme.colors.lineSoft,
        overflow: 'hidden',
        flex: 1,
      }}
    >
      <View
        style={{
          width: `${fill}%`,
          height: '100%',
          backgroundColor: color ?? theme.colors.green,
          borderRadius: height,
        }}
      />
    </View>
  );
}
