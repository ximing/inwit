import type { ReviewDailyBucket, ReviewForecastBucket } from '@inwit/dto';
import { useState } from 'react';
import { Text, View } from 'react-native';
import Svg, { ClipPath, Defs, G, Rect, Text as SvgText } from 'react-native-svg';
import type { ThemeTokens } from '@/theme';

const WEEKDAY_SHORT = ['日', '一', '二', '三', '四', '五', '六'] as const;
const FORGOT_COLOR = '#d0765a';
const STACK_H = 88;
const FORECAST_H = 64;
const LABEL_H = 18;

function parseDateKey(key: string): Date {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year ?? 0, (month ?? 1) - 1, day ?? 1);
}

function weekdayShort(key: string): string {
  return WEEKDAY_SHORT[parseDateKey(key).getDay()] ?? '';
}

function forecastLabel(key: string, index: number): string {
  if (index === 0) return '今天';
  return `周${weekdayShort(key)}`;
}

function dayTotal(row: ReviewDailyBucket): number {
  return row.forgot + row.fuzzy + row.remembered;
}

export function WeekBars({ daily, theme }: { daily: ReviewDailyBucket[]; theme: ThemeTokens }) {
  const [width, setWidth] = useState(0);
  const max = Math.max(1, ...daily.map(dayTotal));
  const n = daily.length;
  const gap = 10;
  const colW = n > 0 && width > 0 ? (width - gap * (n - 1)) / n : 0;
  const barW = Math.min(40, Math.max(8, colW));

  return (
    <View onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
      {width <= 0 || n === 0 ? <View style={{ height: STACK_H + LABEL_H }} /> : (
        <Svg width={width} height={STACK_H + LABEL_H}>
          {daily.map((row, index) => {
            const x = index * (colW + gap) + (colW - barW) / 2;
            const rememberedH = (row.remembered / max) * STACK_H;
            const fuzzyH = (row.fuzzy / max) * STACK_H;
            const forgotH = (row.forgot / max) * STACK_H;
            const clipId = `wb-${row.date}`;
            let y = STACK_H;
            const slices: { key: string; y: number; h: number; fill: string }[] = [];
            y -= rememberedH;
            if (row.remembered > 0) {
              slices.push({ key: 'g', y, h: rememberedH, fill: theme.colors.green });
            }
            y -= fuzzyH;
            if (row.fuzzy > 0) {
              slices.push({ key: 'h', y, h: fuzzyH, fill: theme.colors.gold });
            }
            y -= forgotH;
            if (row.forgot > 0) {
              slices.push({ key: 'b', y, h: forgotH, fill: FORGOT_COLOR });
            }
            return (
              <G key={row.date}>
                <Defs>
                  <ClipPath id={clipId}>
                    <Rect x={x} y={0} width={barW} height={STACK_H} rx={6} />
                  </ClipPath>
                </Defs>
                <G clipPath={`url(#${clipId})`}>
                  <Rect x={x} y={0} width={barW} height={STACK_H} fill={theme.colors.lineSoft} />
                  {slices.map((slice) => (
                    <Rect
                      key={slice.key}
                      x={x}
                      y={slice.y}
                      width={barW}
                      height={slice.h}
                      fill={slice.fill}
                    />
                  ))}
                </G>
                <SvgText
                  x={x + barW / 2}
                  y={STACK_H + 14}
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

export function WeekLegend({ theme }: { theme: ThemeTokens }) {
  const item = (color: string, label: string) => (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
      <View style={{ width: 9, height: 9, borderRadius: 3, backgroundColor: color }} />
      <Text style={{ fontSize: 12, color: theme.colors.ink3 }}>{label}</Text>
    </View>
  );
  return (
    <View style={{ flexDirection: 'row', gap: 16, marginTop: 12 }}>
      {item(theme.colors.green, '想起来了')}
      {item(theme.colors.gold, '模糊')}
      {item(FORGOT_COLOR, '忘了')}
    </View>
  );
}

export function ForecastBars({
  forecast,
  theme,
}: {
  forecast: ReviewForecastBucket[];
  theme: ThemeTokens;
}) {
  const [width, setWidth] = useState(0);
  const max = Math.max(1, ...forecast.map((row) => row.count));
  const n = forecast.length;
  const gap = 8;
  const colW = n > 0 && width > 0 ? (width - gap * (n - 1)) / n : 0;
  const barW = Math.min(34, Math.max(8, colW));

  return (
    <View onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
      {width <= 0 || n === 0 ? <View style={{ height: FORECAST_H + LABEL_H }} /> : (
        <Svg width={width} height={FORECAST_H + LABEL_H}>
          {forecast.map((row, index) => {
            const x = index * (colW + gap) + (colW - barW) / 2;
            const h = Math.max(4, (row.count / max) * FORECAST_H);
            const y = FORECAST_H - h;
            return (
              <G key={row.date}>
                <Rect
                  x={x}
                  y={y}
                  width={barW}
                  height={h}
                  rx={4}
                  fill={theme.colors.accentSoft}
                  stroke={theme.colors.accentLine}
                />
                {row.count > 0 ? (
                  <SvgText
                    x={x + barW / 2}
                    y={y + 12}
                    fill={theme.colors.accentDeep}
                    fontSize={11}
                    fontWeight="600"
                    textAnchor="middle"
                  >
                    {String(row.count)}
                  </SvgText>
                ) : null}
                <SvgText
                  x={x + barW / 2}
                  y={FORECAST_H + 14}
                  fill={theme.colors.ink4}
                  fontSize={10.5}
                  textAnchor="middle"
                >
                  {forecastLabel(row.date, index)}
                </SvgText>
              </G>
            );
          })}
        </Svg>
      )}
    </View>
  );
}
