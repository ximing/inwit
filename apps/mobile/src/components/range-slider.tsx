import { useRef } from 'react';
import { View } from 'react-native';
import type { ThemeTokens } from '@/theme';

function snap(raw: number, min: number, max: number, step: number): number {
  const n = Math.round((raw - min) / step) * step + min;
  const rounded = Math.round(n * 1e6) / 1e6;
  return Math.min(max, Math.max(min, rounded));
}

export function RangeSlider({
  min,
  max,
  step,
  value,
  onChange,
  theme,
}: {
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (value: number) => void;
  theme: ThemeTokens;
}) {
  const originX = useRef(0);
  const trackW = useRef(1);
  const trackRef = useRef<View>(null);
  const span = Math.max(step, max - min);
  const ratio = Math.min(1, Math.max(0, (value - min) / span));

  const measure = () => {
    trackRef.current?.measureInWindow((x, _y, w) => {
      originX.current = x;
      trackW.current = w > 0 ? w : 1;
    });
  };

  const setFromPageX = (pageX: number) => {
    const t = Math.min(1, Math.max(0, (pageX - originX.current) / trackW.current));
    onChange(snap(min + t * span, min, max, step));
  };

  return (
    <View
      ref={trackRef}
      collapsable={false}
      onLayout={measure}
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      onResponderGrant={(event) => {
        measure();
        setFromPageX(event.nativeEvent.pageX);
      }}
      onResponderMove={(event) => setFromPageX(event.nativeEvent.pageX)}
      hitSlop={{ top: 12, bottom: 12 }}
      accessibilityRole="adjustable"
      accessibilityValue={{ min, max, now: value }}
      style={{ height: 28, justifyContent: 'center' }}
    >
      <View
        style={{
          height: 4,
          borderRadius: 2,
          backgroundColor: theme.colors.line,
          overflow: 'hidden',
        }}
      >
        <View
          style={{
            width: `${ratio * 100}%`,
            height: 4,
            backgroundColor: theme.colors.accent,
          }}
        />
      </View>
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          left: `${ratio * 100}%`,
          marginLeft: -10,
          width: 20,
          height: 20,
          borderRadius: 10,
          backgroundColor: theme.colors.accent,
          borderWidth: 2,
          borderColor: theme.colors.surface,
          ...theme.shadow[1],
        }}
      />
    </View>
  );
}
