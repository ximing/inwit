import type { ReviewStrugglingCard } from '@inwit/dto';
import { bindServices, observer, useService } from '@rabjs/react';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { ChevronLeft, ChevronRight } from 'lucide-react-native';
import { useCallback, useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ROUTES } from '@/routes';
import { useTheme, type ThemeTokens } from '@/theme';
import { buildCheckinGrid, type CheckinLevel } from './checkin-logic';
import { ForecastBars, WeekBars, WeekLegend } from './charts';
import { ReviewService } from './review.service';
import { ReportsPane } from './reports-pane';
import { SettingsPanel } from './settings-panel';

function estimateReviewMinutes(count: number): number {
  if (count <= 0) return 0;
  return Math.ceil((count * 25) / 60);
}

const HubContent = observer(function HubContent() {
  const service = useService(ReviewService);
  const params = useLocalSearchParams<{ tab?: string }>();
  const reportsActive = params.tab === 'reports';
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
      <View style={{ flexDirection: 'row', gap: 24, paddingHorizontal: 20, paddingVertical: 12 }}>
        {(['overview', 'reports'] as const).map(tab => <Pressable key={tab} accessibilityRole="tab" accessibilityState={{ selected: reportsActive === (tab === 'reports') }} onPress={() => router.setParams({ tab })}><Text style={{ color: reportsActive === (tab === 'reports') ? theme.colors.accentDeep : theme.colors.ink3, fontWeight: '600', fontSize: 16 }}>{tab === 'reports' ? '学习周报' : '复习概览'}</Text></Pressable>)}
      </View>
      {reportsActive ? <ReportsPane /> : <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
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
            {service.backlogCount > 0 ? (
              <Text style={styles.due}>另有 {service.backlogCount} 张积压顺延到明天</Text>
            ) : null}
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

        <CheckinMonth />

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

        <View style={styles.panel}>
          <View style={styles.panelHead}>
            <Text style={styles.panelTitle}>最需要巩固</Text>
            <Text style={styles.panelSub}>近 30 天里忘记或模糊最多的</Text>
          </View>
          {service.struggling.length === 0 ? (
            <Text style={styles.hint}>还没有明显卡壳的卡片。</Text>
          ) : (
            service.struggling.map((card) => (
              <StrugglingRow key={card.id} card={card} styles={styles} theme={theme} />
            ))
          )}
        </View>

        <SettingsPanel />
      </ScrollView>}
    </SafeAreaView>
  );
});

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'] as const;

const CheckinMonth = observer(function CheckinMonth() {
  const service = useService(ReviewService);
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const today = new Date();
  const grid = buildCheckinGrid({ month: service.calMonth, counts: service.checkins, today });
  const streak = service.stats?.streak ?? { current: 0, longest: 0 };
  const label =
    grid.year === today.getFullYear() ? `${String(grid.month)}月` : `${String(grid.year)}年${String(grid.month)}月`;
  const fills: Record<CheckinLevel, string> = {
    0: theme.colors.lineSoft,
    1: theme.colors.accentSoft,
    2: theme.colors.accentLine,
    3: theme.colors.accent,
  };

  return (
    <View style={styles.cal}>
      <View style={styles.calTop}>
        <Text style={styles.panelTitle}>打卡</Text>
        <View style={styles.calNav}>
          <Pressable accessibilityLabel="上个月" onPress={() => void service.shiftCalMonth(-1)} hitSlop={8}>
            <ChevronLeft color={theme.colors.ink2} size={16} strokeWidth={2.2} />
          </Pressable>
          <Text style={styles.calMonth}>{label}</Text>
          <Pressable
            accessibilityLabel="下个月"
            disabled={!grid.canGoForward}
            onPress={() => void service.shiftCalMonth(1)}
            hitSlop={8}
            style={!grid.canGoForward ? styles.disabled : undefined}
          >
            <ChevronRight color={theme.colors.ink2} size={16} strokeWidth={2.2} />
          </Pressable>
        </View>
      </View>
      <View style={styles.calGrid}>
        {WEEKDAYS.map((day) => (
          <Text key={day} style={styles.calWd}>
            {day}
          </Text>
        ))}
        {grid.cells.map((cell) =>
          cell.kind === 'day' ? (
            <Pressable
              key={cell.key}
              accessibilityLabel={`${cell.date} ${cell.count > 0 ? `复习 ${String(cell.count)} 次` : '没刷'}`}
              onPress={() => {}}
              style={styles.calSlot}
            >
              <View
                style={[
                  styles.calCell,
                  { backgroundColor: fills[cell.level] },
                  cell.isToday && styles.calToday,
                ]}
              />
            </Pressable>
          ) : (
            <View key={cell.key} style={styles.calSlot} />
          ),
        )}
      </View>
      <Text style={styles.calFoot}>
        本月 {grid.checkinDays} 天 · 连续 {streak.current} 天 · 最长 {streak.longest} 天
      </Text>
    </View>
  );
});

function struggleMeta(card: ReviewStrugglingCard): string {
  const parts: string[] = [];
  if (card.forgotCount > 0) parts.push(`忘了 ${String(card.forgotCount)} 次`);
  if (card.fuzzyCount > 0) parts.push(`模糊 ${String(card.fuzzyCount)} 次`);
  return parts.join(' · ');
}

const StrugglingRow = observer(function StrugglingRow({
  card,
  styles,
  theme,
}: {
  card: ReviewStrugglingCard;
  styles: ReturnType<typeof makeStyles>;
  theme: ThemeTokens;
}) {
  const service = useService(ReviewService);
  const meta = struggleMeta(card);
  return (
    <Pressable
      onPress={() => {
        if (card.documentId) {
          router.push({ pathname: '/docs/[id]', params: { id: card.documentId, anchor: card.id } });
          return;
        }
        service.showToast('这张卡没有所属文档');
      }}
      style={styles.weakRow}
    >
      <View style={styles.weakBody}>
        <Text style={styles.weakConcept} numberOfLines={1}>
          {card.concept}
        </Text>
        {meta ? <Text style={styles.weakMeta}>{meta}</Text> : null}
      </View>
      <ChevronRight color={theme.colors.ink4} size={16} strokeWidth={1.8} />
    </Pressable>
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
    cal: {
      backgroundColor: theme.colors.surface,
      borderColor: theme.colors.lineSoft,
      borderWidth: 1,
      borderRadius: theme.radius.lg,
      paddingHorizontal: theme.spacing[4],
      paddingVertical: theme.spacing[4],
      marginBottom: 14,
    },
    calTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
    calNav: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    calMonth: { fontSize: 13.5, fontWeight: '600', color: theme.colors.ink, minWidth: 64, textAlign: 'center' },
    calGrid: { flexDirection: 'row', flexWrap: 'wrap' },
    calWd: {
      width: `${100 / 7}%`,
      textAlign: 'center',
      fontSize: 11,
      color: theme.colors.ink4,
      marginBottom: 4,
    },
    calSlot: { width: `${100 / 7}%`, padding: 2 },
    calCell: { aspectRatio: 1, borderRadius: 4 },
    calToday: { borderWidth: 1.5, borderColor: theme.colors.accentDeep },
    calFoot: { fontSize: 12, color: theme.colors.ink3, marginTop: 8 },
    weakRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingVertical: 10,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.colors.lineSoft,
    },
    weakBody: { flex: 1 },
    weakConcept: { fontSize: 15, fontWeight: '600', color: theme.colors.ink },
    weakMeta: { fontSize: 12, color: theme.colors.ink3, marginTop: 2 },
  });
}

export default bindServices(HubContent, [ReviewService]);
