import { bindServices, observer, useService } from '@rabjs/react';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ROUTES } from '@/routes';
import { useTheme, type ThemeTokens } from '@/theme';
import { ForecastBars, WeekBars, WeekLegend } from './charts';
import { ReviewService } from './review.service';
import { SettingsPanel } from './settings-panel';

function estimateReviewMinutes(count: number): number {
  if (count <= 0) return 0;
  return Math.ceil((count * 25) / 60);
}

const HubContent = observer(function HubContent() {
  const service = useService(ReviewService);
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const stats = service.stats;
  const streak = stats?.streak.current ?? 0;
  const longest = stats?.streak.longest ?? 0;
  const due = service.dueCount;
  const minutes = estimateReviewMinutes(due);
  const retention = stats?.retention7d ?? null;
  const starting = service.$model.startSession.loading;

  useFocusEffect(
    useCallback(() => {
      void service.load();
    }, [service]),
  );

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {!service.ready ? <Text style={styles.hint}>正在加载复习中心…</Text> : null}
        {service.error ? (
          <Text style={styles.error} accessibilityRole="alert">
            {service.error}
          </Text>
        ) : null}

        <View style={styles.hero}>
          <View style={styles.flame}>
            <Text style={styles.flameGlyph}>🔥</Text>
          </View>
          <View style={styles.heroBody}>
            {streak === 0 ? (
              <Text style={styles.streakNum}>今天开始第一天</Text>
            ) : (
              <Text style={styles.streakNum}>
                {streak}
                <Text style={styles.streakSmall}> 天连续复习</Text>
              </Text>
            )}
            <Text style={styles.streakSub}>最长纪录 {longest} 天 · 保持住，别断。</Text>
            <Text style={styles.due}>
              今日待复习 <Text style={styles.dueN}>{due}</Text> 张
              {due > 0 ? ` · 约 ${String(minutes)} 分钟` : ''}
            </Text>
            <Pressable
              disabled={starting}
              onPress={() => {
                void service.startSession().then((ok) => {
                  if (ok) router.push(ROUTES.reviewSession);
                });
              }}
              style={[styles.startBtn, starting && styles.disabled]}
            >
              <Text style={styles.startText}>{starting ? '准备中…' : '开始复习'}</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.statGrid}>
          <Stat num={stats?.totalCards ?? 0} unit=" 张" label="总卡片" styles={styles} />
          <Stat
            num={stats?.masteredCount ?? 0}
            unit=" 张"
            label="已掌握（间隔 ≥ 21 天）"
            styles={styles}
          />
          <Stat
            num={retention}
            unit={retention == null ? '' : '%'}
            label="近 7 天想起率"
            styles={styles}
            empty={retention == null}
          />
          <Stat num={stats?.reviews7d ?? 0} unit=" 次" label="近 7 天复习次数" styles={styles} />
        </View>

        <View style={styles.panel}>
          <View style={styles.panelHead}>
            <Text style={styles.panelTitle}>近 7 天表现</Text>
            <Text style={styles.panelSub}>每天刷了多少、想起来多少</Text>
          </View>
          <WeekBars daily={stats?.daily ?? []} theme={theme} />
          <WeekLegend theme={theme} />
        </View>

        <View style={styles.panel}>
          <View style={styles.panelHead}>
            <Text style={styles.panelTitle}>未来 7 天到期</Text>
            <Text style={styles.panelSub}>提前知道哪天的复习量大</Text>
          </View>
          <ForecastBars forecast={stats?.forecast ?? []} theme={theme} />
        </View>

        <SettingsPanel />
      </ScrollView>
    </SafeAreaView>
  );
});

function Stat({
  num,
  unit,
  label,
  styles,
  empty,
}: {
  num: number | null;
  unit: string;
  label: string;
  styles: ReturnType<typeof makeStyles>;
  empty?: boolean;
}) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statNum}>
        {empty ? '—' : num}
        {empty ? null : <Text style={styles.statUnit}>{unit}</Text>}
      </Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function makeStyles(theme: ThemeTokens) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.colors.bg },
    scroll: { paddingHorizontal: theme.spacing[5], paddingTop: theme.spacing[3], paddingBottom: 40 },
    hint: { fontSize: 13.5, color: theme.colors.ink3, marginBottom: 10 },
    error: { fontSize: 13.5, color: theme.colors.accent, marginBottom: 10 },
    hero: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 16,
      backgroundColor: theme.colors.accentSoft,
      borderColor: theme.colors.accentLine,
      borderWidth: 1,
      borderRadius: theme.radius.xl,
      padding: theme.spacing[5],
      marginBottom: 14,
    },
    flame: {
      width: 56,
      height: 56,
      borderRadius: 16,
      backgroundColor: theme.colors.accent,
      alignItems: 'center',
      justifyContent: 'center',
    },
    flameGlyph: { fontSize: 26 },
    heroBody: { flex: 1, gap: 4 },
    streakNum: {
      fontFamily: theme.typography.serif,
      fontSize: 28,
      fontWeight: '700',
      color: theme.colors.ink,
    },
    streakSmall: {
      fontFamily: theme.typography.sans,
      fontSize: 15,
      fontWeight: '500',
      color: theme.colors.ink3,
    },
    streakSub: { fontSize: 13, color: theme.colors.ink3 },
    due: { fontSize: 13, color: theme.colors.ink3, marginTop: 6 },
    dueN: { color: theme.colors.accentDeep, fontSize: 16, fontWeight: '700' },
    startBtn: {
      alignSelf: 'flex-start',
      marginTop: 8,
      backgroundColor: theme.colors.accent,
      borderRadius: theme.radius.sm,
      paddingHorizontal: theme.spacing[5],
      height: 40,
      alignItems: 'center',
      justifyContent: 'center',
    },
    startText: { color: theme.colors.onAccent, fontSize: 15, fontWeight: '600' },
    disabled: { opacity: 0.45 },
    statGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 14 },
    stat: {
      width: '47%',
      flexGrow: 1,
      backgroundColor: theme.colors.surface,
      borderColor: theme.colors.lineSoft,
      borderWidth: 1,
      borderRadius: theme.radius.lg,
      paddingHorizontal: 16,
      paddingVertical: 14,
    },
    statNum: {
      fontFamily: theme.typography.serif,
      fontSize: 24,
      fontWeight: '700',
      color: theme.colors.ink,
    },
    statUnit: {
      fontFamily: theme.typography.sans,
      fontSize: 13,
      fontWeight: '500',
      color: theme.colors.ink3,
    },
    statLabel: { fontSize: 12, color: theme.colors.ink3, marginTop: 2 },
    panel: {
      backgroundColor: theme.colors.surface,
      borderColor: theme.colors.lineSoft,
      borderWidth: 1,
      borderRadius: theme.radius.lg,
      paddingHorizontal: theme.spacing[5],
      paddingVertical: theme.spacing[5],
      marginBottom: 14,
    },
    panelHead: { flexDirection: 'row', alignItems: 'baseline', gap: 10, marginBottom: 14, flexWrap: 'wrap' },
    panelTitle: { fontSize: 14, fontWeight: '700', color: theme.colors.ink },
    panelSub: { fontSize: 12, color: theme.colors.ink4 },
  });
}

export default bindServices(HubContent, [ReviewService]);
