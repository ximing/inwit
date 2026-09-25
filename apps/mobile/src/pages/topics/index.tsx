import { bindServices, observer, useService } from '@rabjs/react';
import { router, useFocusEffect } from 'expo-router';
import { ChevronDown, ChevronRight } from 'lucide-react-native';
import { useCallback, useMemo } from 'react';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ProgressBar } from '@/components/progress-bar';
import { useTheme, type ThemeTokens } from '@/theme';
import { TopicsService, type TopicListItem } from './topics.service';

const TopicRow = observer(function TopicRow({
  item,
  archived = false,
}: {
  item: TopicListItem;
  archived?: boolean;
}) {
  const service = useService(TopicsService);
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const { topic } = item;
  const retention = service.topicStats[topic.id]?.retention7d;
  return (
    <Pressable
      onPress={() => router.push(`/topics/${topic.id}`)}
      style={[styles.row, archived && styles.rowArchived]}
    >
      <Text style={styles.rowTitle} numberOfLines={1}>
        {topic.title}
      </Text>
      <View style={styles.rowMeta}>
        <Text style={styles.metaText}>
          {item.cardCount} 卡 · {item.documentCount} 篇文档
          {retention != null ? ` · 7 天想起 ${String(retention)}%` : ''}
        </Text>
        <ProgressBar pct={item.masteryPct} theme={theme} />
        <Text style={styles.pct}>{item.masteryPct}%</Text>
      </View>
    </Pressable>
  );
});

const TopicsContent = observer(function TopicsContent() {
  const service = useService(TopicsService);
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const loading = service.$model.load.loading && service.items.length === 0;
  const refreshing = service.$model.load.loading && service.items.length > 0;

  useFocusEffect(
    useCallback(() => {
      void service.load();
    }, [service]),
  );

  const submitNew = () => {
    void service.createNewTopic().then((id) => {
      if (id) router.push(`/topics/${id}`);
    });
  };

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.head}>
        <Text style={styles.title}>主题</Text>
      </View>
      <TextInput
        style={styles.create}
        value={service.newTitle}
        onChangeText={(value) => service.setNewTitle(value)}
        placeholder="主题名称，回车创建"
        placeholderTextColor={theme.colors.ink4}
        maxLength={200}
        returnKeyType="done"
        blurOnSubmit
        editable={!service.$model.createNewTopic.loading}
        onSubmitEditing={submitNew}
      />
      {service.newTopicError ? (
        <Text style={styles.error} accessibilityRole="alert">
          {service.newTopicError}
        </Text>
      ) : null}
      {service.error ? (
        <Text style={styles.error} accessibilityRole="alert">
          {service.error}
        </Text>
      ) : null}

      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={Boolean(refreshing)}
            onRefresh={() => void service.load()}
            tintColor={theme.colors.accent}
          />
        }
      >
        {loading ? <Text style={styles.hint}>读取主题…</Text> : null}
        {!loading && service.active.length === 0 && service.archived.length === 0 ? (
          <Text style={styles.hint}>还没有主题。在上方输入名称，回车创建一个。</Text>
        ) : null}
        {service.active.map((item) => (
          <TopicRow key={item.topic.id} item={item} />
        ))}

        {service.archived.length > 0 ? (
          <View style={styles.archive}>
            <Pressable
              onPress={() => service.toggleArchiveOpen()}
              style={styles.archiveToggle}
              accessibilityState={{ expanded: service.archiveOpen }}
            >
              {service.archiveOpen ? (
                <ChevronDown color={theme.colors.ink3} size={14} strokeWidth={1.8} />
              ) : (
                <ChevronRight color={theme.colors.ink3} size={14} strokeWidth={1.8} />
              )}
              <Text style={styles.archiveLabel}>已归档 · {service.archived.length}</Text>
            </Pressable>
            {service.archiveOpen
              ? service.archived.map((item) => (
                  <TopicRow key={item.topic.id} item={item} archived />
                ))
              : null}
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
});

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
    create: {
      marginHorizontal: theme.spacing[5],
      marginBottom: 10,
      height: 40,
      borderRadius: theme.radius.md,
      borderWidth: 1,
      borderColor: theme.colors.line,
      backgroundColor: theme.colors.surface,
      paddingHorizontal: 12,
      color: theme.colors.ink,
      fontSize: 15,
    },
    error: {
      color: theme.colors.accent,
      fontSize: 13.5,
      paddingHorizontal: theme.spacing[5],
      marginBottom: 8,
    },
    scroll: { paddingHorizontal: theme.spacing[5], paddingBottom: 40 },
    hint: { fontSize: 13.5, color: theme.colors.ink3, marginTop: 16 },
    row: {
      paddingVertical: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.colors.lineSoft,
    },
    rowArchived: { opacity: 0.72 },
    rowTitle: { fontSize: 16, fontWeight: '600', color: theme.colors.ink },
    rowMeta: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
    metaText: { fontSize: 12, color: theme.colors.ink4 },
    pct: { fontSize: 11, color: theme.colors.ink4, width: 32, textAlign: 'right' },
    archive: { marginTop: 20 },
    archiveToggle: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8 },
    archiveLabel: { fontSize: 13, color: theme.colors.ink3, fontWeight: '600' },
  });
}

export default bindServices(TopicsContent, [TopicsService]);
