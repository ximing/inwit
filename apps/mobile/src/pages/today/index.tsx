import {
  agentDocumentMetaLabel,
  docDisplayTitle,
  type DocumentListItem,
  type Job,
  type JobType,
} from '@inwit/dto';
import { bindServices, observer, useService } from '@rabjs/react';
import { router, useFocusEffect } from 'expo-router';
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
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CaptureBox } from '@/components/capture-box';
import { dayGreeting, formatRelativeTime, formatTodayLong } from '@/lib/format';
import { ROUTES } from '@/routes';
import { useTheme, type ThemeTokens } from '@/theme';
import { TodayService } from './today.service';

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

function estimateReviewMinutes(count: number): number {
  return Math.max(1, Math.round((count * 25) / 60));
}

function jobHeadline(job: Job): string {
  if (job.type === 'digest') {
    if (job.status === 'done') return '消化完成';
    if (job.status === 'failed') return '消化失败';
    return '消化中';
  }
  if (job.type === 'chat') {
    if (job.status === 'done') return 'AI 回答';
    if (job.status === 'failed') return '回答失败';
    return '正在回答';
  }
  if (job.type === 'weekly_report') return '周报生成';
  if (job.type === 'selection') {
    if (job.status === 'done') return '选段写卡完成';
    if (job.status === 'failed') return '选段写卡失败';
    return '选段写卡中';
  }
  if (job.type === 'extract') {
    if (job.status === 'done') return '提取完成';
    if (job.status === 'failed') return '提取失败';
    return '提取中';
  }
  if (job.type === 'ocr') {
    if (job.status === 'done') return '识别完成';
    if (job.status === 'failed') return '识别失败';
    return '识别中';
  }
  if (job.type === 'memory_organize') return '记忆整理';
  return '主题进化';
}

function jobDetail(job: Job): string {
  const summary = job.summary.trim();
  const sep = ' · ';
  const split = summary.indexOf(sep);
  if (split > 0) return summary.slice(split + sep.length);
  return summary || job.description;
}

function docTag(doc: DocumentListItem): { tone: 'ai' | 'topic'; label: string } | null {
  const agent = agentDocumentMetaLabel(doc.source, doc.title, doc.kind);
  if (agent) return { tone: 'ai', label: agent };
  if (doc.source === 'chat') return { tone: 'ai', label: 'AI 回答' };
  if (doc.source === 'screenshot') return { tone: 'topic', label: '截图' };
  if (doc.topicTitle) return { tone: 'topic', label: doc.topicTitle };
  return null;
}

const TodayContent = observer(function TodayContent() {
  const service = useService(TodayService);
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const now = new Date();
  const sending = service.$model.send.loading;
  const loading = service.$model.load.loading;

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
        sub.remove();
      };
    }, [service]),
  );

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.date}>{formatTodayLong(now)}</Text>
          <Text style={styles.hi}>{dayGreeting(now)}</Text>

          <CaptureBox
            draft={service.draft}
            onChangeDraft={(value) => service.setDraft(value)}
            canSend={service.canSend}
            sending={sending}
            looksLikeQuestion={service.draftLooksLikeQuestion}
            onSend={(mode) => void service.send(mode)}
            topics={service.topics}
            topicId={service.topicId}
            onSelectTopic={(id) => service.selectTopic(id)}
            onCreateTopic={(title, goal) => service.createCaptureTopic(title, goal)}
          />

          {service.error ? (
            <Text style={styles.error} accessibilityRole="alert">
              {service.error}
            </Text>
          ) : null}

          {service.suggestion ? (
            <View style={styles.banner}>
              <Text style={styles.bannerIco}>💡</Text>
              <View style={styles.bannerBody}>
                <Text style={styles.bannerTitle}>可以开个主题</Text>
                <Text style={styles.bannerSub}>
                  你最近 {service.suggestion.documentCount} 条资料都关于「{service.suggestion.title}
                  」。
                </Text>
              </View>
              <View style={styles.bannerActions}>
                <Pressable
                  disabled={
                    service.$model.acceptSuggestion.loading ||
                    service.$model.dismissSuggestion.loading
                  }
                  onPress={() => void service.acceptSuggestion()}
                  style={styles.primaryBtn}
                >
                  <Text style={styles.primaryText}>
                    {service.$model.acceptSuggestion.loading ? '开题中…' : '开个主题'}
                  </Text>
                </Pressable>
                <Pressable
                  disabled={
                    service.$model.acceptSuggestion.loading ||
                    service.$model.dismissSuggestion.loading
                  }
                  onPress={() => void service.dismissSuggestion()}
                  style={styles.ghostBtn}
                >
                  <Text style={styles.ghostText}>
                    {service.$model.dismissSuggestion.loading ? '忽略中…' : '忽略'}
                  </Text>
                </Pressable>
              </View>
            </View>
          ) : null}

          <Pressable onPress={() => router.navigate(ROUTES.review)} style={styles.actionReview}>
            <Text style={styles.actionKicker}>🔥 连续复习 {service.streak} 天</Text>
            {service.dueCount > 0 ? (
              <>
                <Text style={styles.actionBig}>
                  {service.dueCount}
                  <Text style={styles.actionSmall}>
                    {' '}
                    张待复习 · 约 {estimateReviewMinutes(service.dueCount)} 分钟
                  </Text>
                </Text>
                <Text style={styles.actionSub}>现在刷掉，今天的记忆就稳了</Text>
              </>
            ) : (
              <>
                <Text style={styles.actionBig}>今天刷完了</Text>
                <Text style={styles.actionSub}>
                  {service.streak > 0 ? `已经连续 ${service.streak} 天` : '今天没有到期的卡片'}
                </Text>
              </>
            )}
            <Text style={styles.actionGo}>开始复习 →</Text>
          </Pressable>

          {service.weeklyReport ? (
            <Pressable
              onPress={() => router.push({ pathname: '/review', params: { tab: 'reports', report: service.weeklyReport?.documentId } })}
              style={styles.actionReport}
            >
              <Text style={styles.actionKicker}>📖 本周复盘已生成</Text>
              <Text style={styles.actionBig}>
                {service.weeklyReport.successRate}
                <Text style={styles.actionSmall}>% 成功率</Text>
              </Text>
              <Text style={styles.actionSub}>
                {service.weeklyReport.relearnCount <= 0
                  ? '这周学得很稳'
                  : `有 ${String(service.weeklyReport.relearnCount)} 个概念在偷偷遗忘`}
              </Text>
              <Text style={styles.actionGo}>去看看 →</Text>
            </Pressable>
          ) : null}

          <View style={styles.statStrip}>
            <View style={styles.stat}>
              <Text style={styles.statNum}>
                {service.totalCards}
                <Text style={styles.statUnit}> 张</Text>
              </Text>
              <Text style={styles.statLabel}>总卡片</Text>
            </View>
            <View style={styles.stat}>
              <Text style={styles.statNum}>
                {service.topics.length}
                <Text style={styles.statUnit}> 个</Text>
              </Text>
              <Text style={styles.statLabel}>主题</Text>
            </View>
            <View style={styles.stat}>
              <Text style={styles.statNum}>
                {service.documentTotal}
                <Text style={styles.statUnit}> 篇</Text>
              </Text>
              <Text style={styles.statLabel}>文档</Text>
            </View>
          </View>

          <View style={styles.secRow}>
            <Text style={styles.sec}>最近动态</Text>
            <Pressable onPress={() => service.showToast('网页端可见')}>
              <Text style={styles.more}>全部任务 →</Text>
            </Pressable>
          </View>
          {service.jobs.length === 0 && !loading ? (
            <Text style={styles.hint}>还没有任务动态。</Text>
          ) : null}
          {service.jobs.map((job) => {
            const Icon = JOB_ICONS[job.type];
            const detail = jobDetail(job);
            return (
              <View style={styles.act} key={job.id}>
                <View style={styles.actIco}>
                  <Icon color={theme.colors.ink2} size={16} strokeWidth={2} />
                </View>
                <View style={styles.actBody}>
                  <Text style={styles.actText} numberOfLines={2}>
                    <Text style={styles.actHead}>{jobHeadline(job)}</Text>
                    {detail ? ` · ${detail}` : ''}
                  </Text>
                </View>
                <Text style={styles.actTime}>{formatRelativeTime(job.createdAt)}</Text>
              </View>
            );
          })}

          <View style={styles.secRow}>
            <Text style={styles.sec}>最近文档</Text>
            <Pressable onPress={() => router.navigate(ROUTES.docs)}>
              <Text style={styles.more}>全部文档 →</Text>
            </Pressable>
          </View>
          {service.recentDocuments.length === 0 && !loading ? (
            <Text style={styles.hint}>这张纸还是空的。扔一句话进来。</Text>
          ) : null}
          {service.recentDocuments.map((doc) => {
            const tag = docTag(doc);
            return (
              <Pressable
                key={doc.id}
                onPress={() => router.push({ pathname: '/docs/[id]', params: { id: doc.id } })}
                style={styles.recent}
              >
                <Text style={styles.recentTitle} numberOfLines={1}>
                  {docDisplayTitle(doc)}
                </Text>
                <View style={styles.recentMeta}>
                  {tag ? (
                    <View
                      style={[
                        styles.tag,
                        tag.tone === 'ai' ? styles.tagAi : styles.tagTopic,
                      ]}
                    >
                      <Text
                        style={[
                          styles.tagText,
                          tag.tone === 'ai' ? styles.tagAiText : styles.tagTopicText,
                        ]}
                      >
                        {tag.label}
                      </Text>
                    </View>
                  ) : null}
                  {doc.proposedCount > 0 ? (
                    <Text style={styles.digesting}>待确认 {doc.proposedCount}</Text>
                  ) : null}
                  {doc.status === 'pending' ? (
                    <Text style={styles.digesting}>消化中</Text>
                  ) : doc.status === 'failed' ? (
                    <Text style={styles.failed}>失败</Text>
                  ) : (
                    <Text style={styles.recentTime}>
                      {doc.cardCount > 0 ? `${doc.cardCount} 卡 · ` : ''}
                      {formatRelativeTime(doc.updatedAt)}
                    </Text>
                  )}
                </View>
              </Pressable>
            );
          })}
        </ScrollView>
      </KeyboardAvoidingView>

    </SafeAreaView>
  );
});

function makeStyles(theme: ThemeTokens) {
  return StyleSheet.create({
    flex: { flex: 1 },
    screen: { flex: 1, backgroundColor: theme.colors.bg },
    scroll: { paddingHorizontal: theme.spacing[5], paddingTop: theme.spacing[3], paddingBottom: 40 },
    date: { fontSize: 13, color: theme.colors.ink3 },
    hi: {
      fontFamily: theme.typography.serif,
      fontSize: theme.typography.size['2xl'],
      fontWeight: '700',
      color: theme.colors.ink,
      marginTop: 4,
      marginBottom: theme.spacing[4],
    },
    capture: {
      backgroundColor: theme.colors.surface,
      borderColor: theme.colors.line,
      borderWidth: 1,
      borderRadius: theme.radius.lg,
      padding: theme.spacing[3],
      ...theme.shadow[1],
      marginBottom: 14,
    },
    textarea: {
      minHeight: 72,
      color: theme.colors.ink,
      fontSize: theme.typography.size.md,
      lineHeight: 22,
      padding: 4,
    },
    captureBar: {
      flexDirection: 'row',
      alignItems: 'center',
      flexWrap: 'wrap',
      gap: 8,
      marginTop: 8,
    },
    topicPick: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 10,
      height: 32,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: theme.colors.line,
      backgroundColor: theme.colors.surface2,
      maxWidth: '100%',
      flexShrink: 1,
    },
    dot: {
      width: 7,
      height: 7,
      borderRadius: 4,
      backgroundColor: theme.colors.accent,
    },
    dotOff: { backgroundColor: theme.colors.ink4 },
    topicLabel: { fontSize: 12.5, color: theme.colors.ink2, maxWidth: 140 },
    captureActions: { flexDirection: 'row', gap: 8, marginLeft: 'auto' },
    primaryBtn: {
      backgroundColor: theme.colors.accent,
      borderRadius: theme.radius.sm,
      paddingHorizontal: theme.spacing[4],
      height: 34,
      alignItems: 'center',
      justifyContent: 'center',
    },
    primaryText: { color: theme.colors.onAccent, fontSize: 13.5, fontWeight: '500' },
    ghostBtn: {
      borderRadius: theme.radius.sm,
      paddingHorizontal: theme.spacing[3],
      height: 34,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: theme.colors.line,
      backgroundColor: theme.colors.surface,
    },
    ghostText: { color: theme.colors.ink2, fontSize: 13.5, fontWeight: '500' },
    ghostAccent: { borderColor: theme.colors.accentLine, backgroundColor: theme.colors.accentSoft },
    ghostAccentText: { color: theme.colors.accentDeep },
    disabled: { opacity: 0.45 },
    error: { color: theme.colors.accent, fontSize: 13.5, marginBottom: 10 },
    banner: {
      backgroundColor: theme.colors.goldSoft,
      borderColor: theme.colors.goldLine,
      borderWidth: 1,
      borderRadius: theme.radius.lg,
      padding: theme.spacing[4],
      marginBottom: 14,
      gap: 10,
    },
    bannerIco: { fontSize: 18 },
    bannerBody: { gap: 2 },
    bannerTitle: { fontSize: 14, fontWeight: '700', color: theme.colors.ink },
    bannerSub: { fontSize: 13, color: theme.colors.ink2, lineHeight: 20 },
    bannerActions: { flexDirection: 'row', gap: 8 },
    actionReview: {
      backgroundColor: theme.colors.accentSoft,
      borderColor: theme.colors.accentLine,
      borderWidth: 1,
      borderRadius: theme.radius.lg,
      padding: theme.spacing[5],
      marginBottom: 12,
    },
    actionReport: {
      backgroundColor: theme.colors.surface,
      borderColor: theme.colors.lineSoft,
      borderWidth: 1,
      borderRadius: theme.radius.lg,
      padding: theme.spacing[5],
      marginBottom: 12,
    },
    actionKicker: { fontSize: 12.5, color: theme.colors.ink3, marginBottom: 6 },
    actionBig: {
      fontFamily: theme.typography.serif,
      fontSize: 26,
      fontWeight: '700',
      color: theme.colors.ink,
    },
    actionSmall: {
      fontFamily: theme.typography.sans,
      fontSize: 13,
      fontWeight: '500',
      color: theme.colors.ink3,
    },
    actionSub: { fontSize: 13, color: theme.colors.ink3, marginTop: 4 },
    actionGo: { fontSize: 13, color: theme.colors.accentDeep, fontWeight: '600', marginTop: 10 },
    statStrip: {
      flexDirection: 'row',
      backgroundColor: theme.colors.surface,
      borderColor: theme.colors.lineSoft,
      borderWidth: 1,
      borderRadius: theme.radius.lg,
      paddingVertical: 14,
      marginBottom: 18,
    },
    stat: { flex: 1, alignItems: 'center' },
    statNum: {
      fontFamily: theme.typography.serif,
      fontSize: 22,
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
    secRow: {
      flexDirection: 'row',
      alignItems: 'baseline',
      justifyContent: 'space-between',
      marginBottom: 8,
      marginTop: 6,
    },
    sec: { fontSize: 14, fontWeight: '700', color: theme.colors.ink },
    more: { fontSize: 12.5, color: theme.colors.ink3 },
    hint: { fontSize: 13.5, color: theme.colors.ink3, marginBottom: 10 },
    act: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
    actIco: {
      width: 28,
      height: 28,
      borderRadius: 8,
      backgroundColor: theme.colors.surface2,
      alignItems: 'center',
      justifyContent: 'center',
    },
    actBody: { flex: 1 },
    actText: { fontSize: 13.5, color: theme.colors.ink2, lineHeight: 20 },
    actHead: { fontWeight: '700', color: theme.colors.ink },
    actTime: { fontSize: 12, color: theme.colors.ink4 },
    recent: {
      paddingVertical: 10,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.colors.lineSoft,
    },
    recentTitle: { fontSize: 15, color: theme.colors.ink, fontWeight: '500' },
    recentMeta: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
    tag: { borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
    tagAi: { backgroundColor: theme.colors.accentSoft },
    tagTopic: { backgroundColor: theme.colors.greenSoft },
    tagText: { fontSize: 11 },
    tagAiText: { color: theme.colors.accentDeep },
    tagTopicText: { color: theme.colors.green },
    digesting: { fontSize: 12, color: theme.colors.gold },
    failed: { fontSize: 12, color: theme.colors.accent, fontWeight: '600' },
    recentTime: { fontSize: 12, color: theme.colors.ink4 },
    backdrop: {
      flex: 1,
      backgroundColor: 'rgba(34, 29, 22, 0.35)',
      justifyContent: 'center',
      padding: 24,
    },
    menu: {
      backgroundColor: theme.colors.surface,
      borderRadius: theme.radius.lg,
      borderWidth: 1,
      borderColor: theme.colors.line,
      paddingVertical: 6,
      ...theme.shadow[2],
    },
    menuItem: { paddingHorizontal: 16, paddingVertical: 12 },
    menuItemOn: { backgroundColor: theme.colors.accentSoft },
    menuText: { fontSize: 14, color: theme.colors.ink },
    menuNew: { fontSize: 14, color: theme.colors.accentDeep, fontWeight: '600' },
    menuSep: { height: StyleSheet.hairlineWidth, backgroundColor: theme.colors.line, marginVertical: 4 },
    dialog: {
      backgroundColor: theme.colors.surface,
      borderRadius: theme.radius.lg,
      borderWidth: 1,
      borderColor: theme.colors.line,
      padding: theme.spacing[5],
      ...theme.shadow[3],
    },
    dialogTitle: {
      fontFamily: theme.typography.serif,
      fontSize: 20,
      fontWeight: '700',
      color: theme.colors.ink,
    },
    dialogLede: { fontSize: 13.5, color: theme.colors.ink3, marginTop: 6, marginBottom: 14, lineHeight: 20 },
    fieldLabel: { fontSize: 13.5, color: theme.colors.ink2, marginBottom: 4 },
    input: {
      backgroundColor: theme.colors.surface2,
      borderColor: theme.colors.line,
      borderWidth: 1,
      borderRadius: theme.radius.sm,
      paddingHorizontal: theme.spacing[3],
      minHeight: 38,
      color: theme.colors.ink,
      fontSize: theme.typography.size.md,
      marginBottom: 12,
    },
    inputArea: { minHeight: 80, paddingTop: 8 },
    dialogActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 4 },
  });
}

export default bindServices(TodayContent, [TodayService]);
