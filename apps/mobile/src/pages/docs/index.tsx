import {
  agentDocumentMetaLabel,
  docDisplayTitle,
  type DocumentListItem,
} from '@inwit/dto';
import { bindServices, observer, useService } from '@rabjs/react';
import { router, useFocusEffect } from 'expo-router';
import { Search } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  Animated,
  AppState,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CaptureBox } from '@/components/capture-box';
import { formatRelativeTime, summarizeAnswer } from '@/lib/format';
import { useTheme, type ThemeTokens } from '@/theme';
import { DocsService } from './docs.service';

function docSummary(doc: DocumentListItem): string | null {
  const desc = doc.description?.trim() ?? '';
  if (doc.title?.trim() && desc) return desc;
  if (doc.source === 'chat' && doc.answer) return summarizeAnswer(doc.answer);
  return desc || null;
}

const PulseLabel = observer(function PulseLabel({ text }: { text: string }) {
  const theme = useTheme();
  const opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.35, duration: 800, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 800, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);
  return (
    <Animated.Text style={{ fontSize: 12, color: theme.colors.gold, opacity }}>{text}</Animated.Text>
  );
});

const DocRow = observer(function DocRow({ doc }: { doc: DocumentListItem }) {
  const service = useService(DocsService);
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const stage = service.stageFor(doc);
  const agent = agentDocumentMetaLabel(doc.source, doc.title, doc.kind);
  const summary = docSummary(doc);
  const failed = doc.status === 'failed' || stage.kind === 'failed';
  const pulse = stage.pulse && stage.label;

  return (
    <Pressable
      onPress={() => router.push({ pathname: '/docs/[id]', params: { id: doc.id } })}
      style={[styles.row, failed && styles.rowFailed]}
    >
      <Text style={[styles.rowTitle, failed && styles.rowTitleFailed]} numberOfLines={2}>
        {docDisplayTitle(doc)}
      </Text>
      {summary ? (
        <Text style={styles.rowSummary} numberOfLines={2}>
          {summary}
        </Text>
      ) : null}
      <View style={styles.rowMeta}>
        {pulse ? <PulseLabel text={stage.label.replace(/…$/, '') || '消化中'} /> : null}
        {failed ? (
          <Text style={styles.failed} numberOfLines={1}>
            失败{doc.failReason ? `：${doc.failReason}` : ''}
          </Text>
        ) : null}
        {agent ? (
          <View style={[styles.tag, styles.tagAi]}>
            <Text style={styles.tagAiText}>{agent}</Text>
          </View>
        ) : null}
        {doc.topicTitle ? (
          <View style={[styles.tag, styles.tagTopic]}>
            <Text style={styles.tagTopicText}>{doc.topicTitle}</Text>
          </View>
        ) : null}
        {doc.cardCount > 0 ? <Text style={styles.metaText}>{doc.cardCount} 卡</Text> : null}
        <Text style={styles.metaText}>{formatRelativeTime(doc.updatedAt)}</Text>
        {stage.canRetry ? (
          <Pressable
            disabled={service.retryingId === doc.id}
            onPress={() => void service.retryFailed(doc.id)}
            hitSlop={8}
          >
            <Text style={styles.retry}>{service.retryingId === doc.id ? '重试中…' : '重试'}</Text>
          </Pressable>
        ) : null}
      </View>
    </Pressable>
  );
});

const DocsContent = observer(function DocsContent() {
  const service = useService(DocsService);
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const refreshing = service.$model.loadDocuments.loading && service.documents.length > 0;
  const loading = service.$model.boot.loading && service.documents.length === 0;

  useFocusEffect(
    useCallback(() => {
      service.setFocused(true);
      service.setAppActive(AppState.currentState === 'active');
      void service.boot();
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

  const openSearch = () => {
    if (service.filterTopicId) {
      router.push({ pathname: '/search', params: { topicId: service.filterTopicId } });
    } else {
      router.push('/search');
    }
  };

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.head}>
        <Text style={styles.title}>文档</Text>
        <Pressable onPress={openSearch} hitSlop={8} style={styles.searchBtn} accessibilityLabel="搜索">
          <Search color={theme.colors.ink2} size={18} strokeWidth={1.8} />
        </Pressable>
      </View>

      <View style={styles.padX}>
        <CaptureBox
          draft={service.draft}
          onChangeDraft={(value) => service.setDraft(value)}
          canSend={service.canSend}
          sending={service.$model.send.loading}
          looksLikeQuestion={service.draftLooksLikeQuestion}
          onSend={(mode) => {
            void service.send(mode).then((id) => {
              if (id) router.push({ pathname: '/docs/[id]', params: { id } });
            });
          }}
          topics={service.topics}
          topicId={service.captureTopicId}
          onSelectTopic={(id) => service.selectCaptureTopic(id)}
          onCreateTopic={(title, goal) => service.createCaptureTopic(title, goal)}
        />
      </View>

      {service.error ? (
        <Text style={styles.error} accessibilityRole="alert">
          {service.error}
        </Text>
      ) : null}

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chips}
      >
        <Pressable
          onPress={() => void service.setFilter(null)}
          style={[styles.chip, service.filterTopicId === null && styles.chipOn]}
        >
          <Text style={[styles.chipText, service.filterTopicId === null && styles.chipTextOn]}>
            全部
          </Text>
        </Pressable>
        {service.topics.map((topic) => {
          const on = service.filterTopicId === topic.id;
          return (
            <Pressable
              key={topic.id}
              onPress={() => void service.setFilter(topic.id)}
              style={[styles.chip, on && styles.chipOn]}
            >
              <Text style={[styles.chipText, on && styles.chipTextOn]}>{topic.title}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <FlatList
        data={service.documents}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <DocRow doc={item} />}
        contentContainerStyle={styles.list}
        onEndReached={() => void service.loadMore()}
        onEndReachedThreshold={0.4}
        refreshControl={
          <RefreshControl
            refreshing={Boolean(refreshing)}
            onRefresh={() => void service.loadDocuments()}
            tintColor={theme.colors.accent}
          />
        }
        ListEmptyComponent={
          loading ? (
            <Text style={styles.hint}>正在打开文档流…</Text>
          ) : (
            <Text style={styles.hint}>这张纸还是空的。扔一句话进来。</Text>
          )
        }
        ListFooterComponent={
          service.hasMore ? (
            <Text style={styles.hint}>
              {service.$model.loadMore.loading ? '载入中…' : ' '}
            </Text>
          ) : null
        }
      />
    </SafeAreaView>
  );
});

function makeStyles(theme: ThemeTokens) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.colors.bg },
    head: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
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
    searchBtn: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.colors.surface,
      borderWidth: 1,
      borderColor: theme.colors.line,
    },
    padX: { paddingHorizontal: theme.spacing[5] },
    error: {
      color: theme.colors.accent,
      fontSize: 13.5,
      paddingHorizontal: theme.spacing[5],
      marginBottom: 8,
    },
    chips: {
      paddingHorizontal: theme.spacing[5],
      gap: 8,
      paddingBottom: 10,
      alignItems: 'center',
    },
    chip: {
      height: 32,
      paddingHorizontal: 12,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: theme.colors.line,
      backgroundColor: theme.colors.surface,
      alignItems: 'center',
      justifyContent: 'center',
    },
    chipOn: { backgroundColor: theme.colors.accentSoft, borderColor: theme.colors.accentLine },
    chipText: { fontSize: 13, color: theme.colors.ink2 },
    chipTextOn: { color: theme.colors.accentDeep, fontWeight: '600' },
    list: { paddingHorizontal: theme.spacing[5], paddingBottom: 40 },
    row: {
      paddingVertical: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.colors.lineSoft,
    },
    rowFailed: { opacity: 0.92 },
    rowTitle: { fontSize: 16, fontWeight: '600', color: theme.colors.ink },
    rowTitleFailed: { color: theme.colors.accent },
    rowSummary: { fontSize: 13.5, color: theme.colors.ink3, marginTop: 4, lineHeight: 20 },
    rowMeta: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginTop: 6 },
    tag: { borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
    tagAi: { backgroundColor: theme.colors.accentSoft },
    tagTopic: { backgroundColor: theme.colors.greenSoft },
    tagAiText: { fontSize: 11, color: theme.colors.accentDeep },
    tagTopicText: { fontSize: 11, color: theme.colors.green },
    metaText: { fontSize: 12, color: theme.colors.ink4 },
    failed: { fontSize: 12, color: theme.colors.accent, fontWeight: '600' },
    retry: { fontSize: 12.5, color: theme.colors.accentDeep, fontWeight: '600' },
    hint: { fontSize: 13.5, color: theme.colors.ink3, marginTop: 16 },
  });
}

export default bindServices(DocsContent, [DocsService]);
