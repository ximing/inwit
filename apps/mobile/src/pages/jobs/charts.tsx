import { useState } from 'react';
import { Text, View } from 'react-native';
import Svg, { Rect, Text as SvgText, G } from 'react-native-svg';
import type { JobUsage } from '@inwit/dto';
import { formatTokens } from '@/lib/format';
import type { ThemeTokens } from '@/theme';
import {
  barHeightPct,
  isLocalDateToday,
  usageSwatchColor,
  usageTypeLabel,
  weekdayShort,
} from './jobs.service';

const BAR_H = 88;
const LABEL_H = 18;

export function UsageBars({
  usage,
  max,
  theme,
}: {
  usage: JobUsage;
  max: number;
  theme: ThemeTokens;
}) {
  const [width, setWidth] = useState(0);
  const daily = usage.daily;
  const n = daily.length;
  const gap = 10;
  const colW = n > 0 && width > 0 ? (width - gap * (n - 1)) / n : 0;
  const barW = Math.min(40, Math.max(8, colW));

  return (
    <View onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
      {width <= 0 || n === 0 ? <View style={{ height: BAR_H + LABEL_H }} /> : (
        <Svg width={width} height={BAR_H + LABEL_H}>
          {daily.map((row, index) => {
            const x = index * (colW + gap) + (colW - barW) / 2;
            const pct = barHeightPct(row.tokens, max);
            const h = Math.max(row.tokens > 0 ? 4 : 0, (pct / 100) * BAR_H);
            const y = BAR_H - h;
            const today = isLocalDateToday(row.date);
            return (
              <G key={row.date}>
                <Rect
                  x={x}
                  y={0}
                  width={barW}
                  height={BAR_H}
                  rx={6}
                  fill={theme.colors.lineSoft}
                />
                {h > 0 ? (
                  <Rect
                    x={x}
                    y={y}
                    width={barW}
                    height={h}
                    rx={6}
                    fill={today ? theme.colors.accent : theme.colors.gold}
                  />
                ) : null}
                <SvgText
                  x={x + barW / 2}
                  y={BAR_H + 14}
                  fill={theme.colors.ink4}
                  fontSize={10.5}
                  textAnchor="middle"
                >
                  {weekdayShort(row.date)}
                </SvgText>
              </G>
            );
          })}
        </Svg>
      )}
    </View>
  );
}

export function UsageLegend({ usage, theme }: { usage: JobUsage; theme: ThemeTokens }) {
  return (
    <View style={{ marginTop: 12, gap: 8 }}>
      {usage.byType.map((row) => (
        <View
          key={row.type}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}
        >
          <View
            style={{
              width: 9,
              height: 9,
              borderRadius: 3,
              backgroundColor: usageSwatchColor(row.type, theme.colors),
            }}
          />
          <Text style={{ fontSize: 13, color: theme.colors.ink2, flex: 1 }}>
            {usageTypeLabel(row.type)}
          </Text>
          <Text style={{ fontSize: 13, color: theme.colors.ink3 }}>{formatTokens(row.tokens)}</Text>
        </View>
      ))}
      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
        <Text style={{ fontSize: 13.5, fontWeight: '700', color: theme.colors.ink, flex: 1 }}>
          合计
        </Text>
        <Text style={{ fontSize: 13.5, fontWeight: '700', color: theme.colors.ink }}>
          {formatTokens(usage.total)}
        </Text>
      </View>
    </View>
  );
}
