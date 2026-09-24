import { bindServices, observer, useService } from '@rabjs/react';
import { formatAgentTurn, type Job, type JobStatus, type JobType } from '@inwit/dto';
import {
  BookOpen,
  BrainCircuit,
  FileText,
  MessageCircle,
  Library,
  ScanText,
  StickyNote,
  Sparkles,
  type LucideIcon,
} from 'lucide-react-native';
import { useCallback, useMemo } from 'react';
import {
  AppState,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { formatDuration } from '@/lib/format';
import { useTheme, type ThemeTokens } from '@/theme';
import { UsageBars, UsageLegend } from './charts';
import {
  formatElapsedSec,
  formatJobTime,
  formatQueueWhen,
  jobContent,
  jobDurationMs,
  JOB_STATUS_LABELS,
  JOB_STATUSES,
  JOB_TYPE_LABELS,
  JOB_TYPES,
  JobsService,
} from './jobs.service';

const JOB_ICONS: Record<JobType, LucideIcon> = {
  digest: BrainCircuit,
  chat: MessageCircle,
  weekly_report: BookOpen,
  evolve: Sparkles,
  topic: Sparkles,
  selection: Sparkles,
  extract: FileText,
  ocr: ScanText,
  annotation_resurface: StickyNote,
  memory_organize: Library,
};

const JobsContent = observer(function JobsContent() {
  const service = useService(JobsService);
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const refreshing = service.$model.load.loading && service.queue !== null;

  useFocusEffect(
    useCallback(() => {
      service.setFocused(true);
      service.setAppActive(AppState.currentState === 'active');
      void service.load();
      const sub = AppState.addEventListener('change', (state) => {
        service.setAppActive(state === 'active');
      });
      return () => {
        service.setFocused(false);
        service.stopPolling();
        service.stopTick();
        sub.remove();
      };
    }, [service]),
  );

  const counts = service.counts;

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.head}>
        <Text style={styles.title}>任务</Text>
      </View>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl
            refreshing={Boolean(refreshing)}
            onRefresh={() => void service.load()}
            tintColor={theme.colors.accent}
          />
        }
      >
        {service.error ? (
          <Text style={styles.error} accessibilityRole="alert">
            {service.error}
          </Text>
        ) : null}

        <View style={styles.strip}>
          <StatCell n={counts.running} label="进行中" live={counts.running > 0} styles={styles} />
          <StatCell n={counts.pending} label="排队中" styles={styles} />
          <StatCell n={counts.doneToday} label="今日完成" styles={styles} />
          <StatCell n={counts.failed} label="失败待处理" bad={counts.failed > 0} styles={styles} />
        </View>

        {service.running.length > 0 ? (
          <>
            <Text style={styles.sec}>正在进行</Text>
            {service.running.map((job) => (
              <View key={job.id} style={styles.card}>
                <JobHead job={job} theme={theme} styles={styles} />
                <Text style={styles.desc}>{job.description}</Text>
                <Text style={styles.dur}>
                  {formatElapsedSec(job.startedElapsedSec ?? 0)} · 第{' '}
                  {Math.max(1, job.attempts)} 次尝试
                </Text>
              </View>
            ))}
          </>
        ) : null}

        {service.pending.length > 0 ? (
          <>
            <Text style={styles.sec}>排队中 · {service.pending.length}</Text>
            {service.pending.map((job) => {
              const when = formatQueueWhen(job.scheduledFor ?? job.runAt);
              return (
                <View key={job.id} style={styles.card}>
                  <View style={styles.queueWhen}>
                    <Text style={styles.whenPrimary}>{when.primary}</Text>
                    <Text style={styles.whenSecondary}>{when.secondary}</Text>
                  </View>
                  <JobHead job={job} theme={theme} styles={styles} />
                  <Text style={styles.desc}>{job.description}</Text>
                  <Pressable
                    disabled={service.cancellingId === job.id}
                    onPress={() => void service.cancel(job.id)}
                    style={styles.ghostBtn}
                  >
                    <Text style={styles.ghostText}>
                      {service.cancellingId === job.id ? '取消中…' : '取消'}
                    </Text>
                  </Pressable>
                </View>
              );
            })}
          </>
        ) : null}

        <Text style={styles.sec}>Token 用量 · 近 7 天</Text>
        <View style={styles.card}>
          {!service.usage ? (
            <Text style={styles.hint}>读取用量…</Text>
          ) : (
            <>
              <UsageBars usage={service.usage} max={service.usageMax} theme={theme} />
              <UsageLegend usage={service.usage} theme={theme} />
            </>
          )}
        </View>

        <Text style={styles.sec}>执行历史</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chips}
        >
          <Chip
            label="全部状态"
            on={service.jobStatus === ''}
            onPress={() => service.setJobStatus('')}
            styles={styles}
          />
          {JOB_STATUSES.map((status) => (
            <Chip
              key={status}
              label={JOB_STATUS_LABELS[status]}
              on={service.jobStatus === status}
              onPress={() => service.setJobStatus(status)}
              styles={styles}
            />
          ))}
        </ScrollView>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chips}
        >
          <Chip
            label="全部类型"
            on={service.jobType === ''}
            onPress={() => service.setJobType('')}
            styles={styles}
          />
          {JOB_TYPES.map((type) => (
            <Chip
              key={type}
              label={JOB_TYPE_LABELS[type]}
              on={service.jobType === type}
              onPress={() => service.setJobType(type)}
              styles={styles}
            />
          ))}
        </ScrollView>

        {service.$model.loadHistory.loading && service.jobs.length === 0 ? (
          <Text style={styles.hint}>读取任务…</Text>
        ) : null}
        {!service.$model.loadHistory.loading && service.jobs.length === 0 ? (
          <Text style={styles.hint}>还没有任务。扔进文档后，消化记录会出现在这里。</Text>
        ) : null}
        {service.jobs.map((job) => (
          <HistoryRow key={job.id} job={job} styles={styles} />
        ))}
        {service.jobsTotal > 0 ? (
          <View style={styles.pager}>
            <Pressable
              disabled={!service.jobsHasPrev}
              onPress={() => service.setJobsPage(service.jobsPage - 1)}
              style={[styles.ghostBtn, !service.jobsHasPrev && styles.dim]}
            >
              <Text style={styles.ghostText}>上一页</Text>
            </Pressable>
            <Text style={styles.pageText}>
              {(service.jobsPage - 1) * service.jobsLimit + 1}–
              {Math.min(service.jobsPage * service.jobsLimit, service.jobsTotal)} /{' '}
              {service.jobsTotal}
            </Text>
            <Pressable
              disabled={!service.jobsHasNext}
              onPress={() => service.setJobsPage(service.jobsPage + 1)}
              style={[styles.ghostBtn, !service.jobsHasNext && styles.dim]}
            >
              <Text style={styles.ghostText}>下一页</Text>
            </Pressable>
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
});

const HistoryRow = observer(function HistoryRow({
  job,
  styles,
}: {
  job: Job;
  styles: ReturnType<typeof makeStyles>;
}) {
  const service = useService(JobsService);
  const duration = formatDuration(jobDurationMs(job));
  const time = formatJobTime(job.finishedAt ?? job.createdAt);
  const expanded = service.expandedErrorId === job.id;
  const detailOpen = service.executionsJobId === job.id;
  return (
    <Pressable
      style={[styles.histRow, job.status === 'failed' && styles.histFail]}
      onPress={() => {
        if (job.status === 'failed' && job.lastError) service.toggleError(job.id);
      }}
    >
      <View style={styles.histTop}>
        <Text style={styles.histType}>{JOB_TYPE_LABELS[job.type]}</Text>
        <StatusPill status={job.status} styles={styles} />
      </View>
      <Text style={styles.histBody} numberOfLines={2}>
        {jobContent(job.summary)}
      </Text>
      <Text style={styles.metaText}>
        {time} · {duration}
      </Text>
      <View style={styles.histOps}>
        {job.status === 'failed' ? (
          <Pressable
            disabled={service.retryingId === job.id}
            onPress={() => void service.retry(job.id)}
            style={styles.retry}
            hitSlop={8}
          >
            <Text style={styles.retryText}>{service.retryingId === job.id ? '重试中…' : '重试'}</Text>
          </Pressable>
        ) : null}
        <Pressable
          onPress={() => void service.toggleExecutions(job.id)}
          style={styles.retry}
          hitSlop={8}
        >
          <Text style={styles.detailText}>{detailOpen ? '收起明细' : '执行明细'}</Text>
        </Pressable>
      </View>
      {expanded && job.lastError ? <Text style={styles.errDetail}>{job.lastError}</Text> : null}
      {job.status === 'failed' && job.lastError && !expanded ? (
        <Text style={styles.expandHint}>点按展开错误详情</Text>
      ) : null}
      {detailOpen ? <ExecutionDetail styles={styles} /> : null}
    </Pressable>
  );
});

const ExecutionDetail = observer(function ExecutionDetail({
  styles,
}: {
  styles: ReturnType<typeof makeStyles>;
}) {
  const service = useService(JobsService);
  if (!service.executionsLoaded) {
    return <Text style={styles.expandHint}>读取执行明细…</Text>;
  }
  if (service.executions.length === 0) {
    return <Text style={styles.expandHint}>没有执行记录（该任务早于执行审计）。</Text>;
  }
  return (
    <View style={styles.execList}>
      {service.executions.map((execution, index) => {
        const duration = execution.finishedAt
          ? formatDuration(
              new Date(execution.finishedAt).getTime() - new Date(execution.startedAt).getTime(),
            )
          : '进行中';
        return (
          <View style={styles.execItem} key={execution.id}>
            <Text style={styles.execHead}>
              {`第 ${String(index + 1)} 次 · ${formatJobTime(execution.startedAt)} · ${duration}`}
            </Text>
            {execution.resultSummary ? (
              <Text style={styles.execSummary}>{execution.resultSummary}</Text>
            ) : null}
            {execution.error ? <Text style={styles.errDetail}>{execution.error}</Text> : null}
            {(execution.turns ?? []).map((turn) => (
              <View key={`${turn.phase}-${String(turn.index)}`} style={styles.execStep}>
                <Text style={styles.execTurn}>{formatAgentTurn(turn)}</Text>
                {turn.text_tail ? (
                  <Text style={styles.execIo} numberOfLines={3}>
                    {turn.text_tail}
                  </Text>
                ) : null}
                {turn.reasoning_tail ? (
                  <Text style={styles.execIo} numberOfLines={3}>
                    {`思考 ${turn.reasoning_tail}`}
                  </Text>
                ) : null}
              </View>
            ))}
            {execution.steps.map((step, stepIndex) => (
              <View key={stepIndex} style={styles.execStep}>
                <Text style={styles.execTool}>
                  {step.tool}
                  <Text style={styles.execMs}>
                    {` ${String(step.duration_ms)}ms`}
                    {step.output_chars != null ? ` · ${String(step.output_chars)}字` : ''}
                  </Text>
                </Text>
                {step.output_summary ? (
                  <Text style={styles.execIo} numberOfLines={3}>
                    {step.output_summary}
                  </Text>
                ) : null}
              </View>
            ))}
          </View>
        );
      })}
    </View>
  );
});

function JobHead({
  job,
  theme,
  styles,
}: {
  job: Job;
  theme: ThemeTokens;
  styles: ReturnType<typeof makeStyles>;
}) {
  const Icon = JOB_ICONS[job.type];
  return (
    <View style={styles.jobHead}>
      <Icon color={theme.colors.ink2} size={16} strokeWidth={1.8} />
      <Text style={styles.jobName} numberOfLines={2}>
        {job.summary}
      </Text>
    </View>
  );
}

function StatusPill({
  status,
  styles,
}: {
  status: JobStatus;
  styles: ReturnType<typeof makeStyles>;
}) {
  const tone =
    status === 'done' ? styles.pillDone : status === 'failed' ? styles.pillFail : styles.pillBusy;
  const text =
    status === 'done' ? styles.pillDoneText : status === 'failed' ? styles.pillFailText : styles.pillBusyText;
  return (
    <View style={[styles.pill, tone]}>
      <Text style={[styles.pillText, text]}>{JOB_STATUS_LABELS[status]}</Text>
    </View>
  );
}

function StatCell({
  n,
  label,
  live,
  bad,
  styles,
}: {
  n: number;
  label: string;
  live?: boolean;
  bad?: boolean;
  styles: ReturnType<typeof makeStyles>;
}) {
  return (
    <View style={styles.stat}>
      <Text style={[styles.statN, live && styles.statLive, bad && styles.statBad]}>{n}</Text>
      <Text style={styles.statL}>{label}</Text>
    </View>
  );
}

function Chip({
  label,
  on,
  onPress,
  styles,
}: {
  label: string;
  on: boolean;
  onPress: () => void;
  styles: ReturnType<typeof makeStyles>;
}) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, on && styles.chipOn]}>
      <Text style={[styles.chipText, on && styles.chipTextOn]}>{label}</Text>
    </Pressable>
  );
}

function makeStyles(theme: ThemeTokens) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.colors.bg },
    head: {
      paddingHorizontal: theme.spacing[5],
      paddingTop: theme.spacing[3],
      paddingBottom: theme.spacing[2],
    },
    title: {
      fontFamily: theme.typography.serif,
      fontSize: theme.typography.size['2xl'],
      fontWeight: '700',
      color: theme.colors.ink,
    },
    scroll: { paddingHorizontal: theme.spacing[5], paddingBottom: 48 },
    error: { color: theme.colors.accent, fontSize: 13.5, marginBottom: 8 },
    hint: { fontSize: 13.5, color: theme.colors.ink3, marginTop: 8 },
    strip: {
      flexDirection: 'row',
      backgroundColor: theme.colors.surface,
      borderWidth: 1,
      borderColor: theme.colors.line,
      borderRadius: theme.radius.lg,
      paddingVertical: 12,
      ...theme.shadow[1],
    },
    stat: { flex: 1, alignItems: 'center' },
    statN: { fontSize: 20, fontWeight: '700', color: theme.colors.ink },
    statLive: { color: theme.colors.gold },
    statBad: { color: theme.colors.accent },
    statL: { fontSize: 11, color: theme.colors.ink3, marginTop: 2 },
    sec: {
      fontSize: 13,
      fontWeight: '700',
      color: theme.colors.ink3,
      marginTop: 22,
      marginBottom: 10,
    },
    card: {
      backgroundColor: theme.colors.surface,
      borderWidth: 1,
      borderColor: theme.colors.line,
      borderRadius: theme.radius.md,
      padding: 12,
      marginBottom: 10,
      ...theme.shadow[1],
    },
    jobHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
    jobName: { flex: 1, fontSize: 14.5, fontWeight: '600', color: theme.colors.ink },
    desc: { fontSize: 13, color: theme.colors.ink3, marginTop: 6, lineHeight: 18 },
    dur: { fontSize: 12, color: theme.colors.gold, marginTop: 6, fontWeight: '600' },
    queueWhen: { flexDirection: 'row', alignItems: 'baseline', gap: 8, marginBottom: 6 },
    whenPrimary: { fontSize: 13, fontWeight: '700', color: theme.colors.ink },
    whenSecondary: { fontSize: 12, color: theme.colors.ink4 },
    ghostBtn: {
      alignSelf: 'flex-start',
      marginTop: 8,
      borderRadius: theme.radius.sm,
      paddingHorizontal: 12,
      height: 30,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: theme.colors.line,
    },
    ghostText: { fontSize: 13, color: theme.colors.ink2, fontWeight: '500' },
    dim: { opacity: 0.4 },
    chips: { gap: 8, paddingBottom: 10 },
    chip: {
      height: 30,
      paddingHorizontal: 12,
      borderRadius: 15,
      borderWidth: 1,
      borderColor: theme.colors.line,
      backgroundColor: theme.colors.surface,
      alignItems: 'center',
      justifyContent: 'center',
    },
    chipOn: { backgroundColor: theme.colors.accentSoft, borderColor: theme.colors.accentLine },
    chipText: { fontSize: 12.5, color: theme.colors.ink2 },
    chipTextOn: { color: theme.colors.accentDeep, fontWeight: '600' },
    histRow: {
      paddingVertical: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.colors.lineSoft,
    },
    histFail: {},
    histTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    histType: { fontSize: 13, fontWeight: '700', color: theme.colors.ink2 },
    histBody: { fontSize: 14, color: theme.colors.ink, marginTop: 4 },
    metaText: { fontSize: 12, color: theme.colors.ink4, marginTop: 4 },
    retry: { marginTop: 6 },
    retryText: { color: theme.colors.accentDeep, fontWeight: '600', fontSize: 13 },
    errDetail: { fontSize: 12.5, color: theme.colors.accent, marginTop: 8, lineHeight: 18 },
    expandHint: { fontSize: 11, color: theme.colors.ink4, marginTop: 4 },
    histOps: { flexDirection: 'row', alignItems: 'center', gap: 16 },
    detailText: { color: theme.colors.ink3, fontWeight: '600', fontSize: 13 },
    execList: { marginTop: 10, gap: 10 },
    execItem: {
      borderLeftWidth: 2,
      borderLeftColor: theme.colors.line,
      paddingLeft: 10,
    },
    execHead: { fontSize: 12, color: theme.colors.ink3, fontWeight: '600' },
    execSummary: { fontSize: 12, color: theme.colors.ink4, marginTop: 2 },
    execTurn: { fontSize: 12, color: theme.colors.ink2, lineHeight: 18 },
    execStep: { marginTop: 6 },
    execTool: { fontSize: 12, color: theme.colors.ink2, fontWeight: '600' },
    execMs: { color: theme.colors.ink4, fontWeight: '400' },
    execIo: { fontSize: 12, color: theme.colors.ink4, marginTop: 2, lineHeight: 17 },
    pager: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: 16,
    },
    pageText: { fontSize: 12.5, color: theme.colors.ink3 },
    pill: { borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
    pillText: { fontSize: 11, fontWeight: '600' },
    pillDone: { backgroundColor: theme.colors.greenSoft },
    pillDoneText: { color: theme.colors.green },
    pillFail: { backgroundColor: theme.colors.accentSoft },
    pillFailText: { color: theme.colors.accent },
    pillBusy: { backgroundColor: theme.colors.goldSoft },
    pillBusyText: { color: theme.colors.gold },
  });
}

export default bindServices(JobsContent, [JobsService]);
