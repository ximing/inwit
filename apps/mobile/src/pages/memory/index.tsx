import type { MemoryCollection, MemoryRevision } from '@inwit/dto';
import { bindServices, observer, useService } from '@rabjs/react';
import { router } from 'expo-router';
import { useEffect, useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StackHeader } from '@/components/stack-header';
import { formatDateTime } from '@/lib/format';
import { useTheme, type ThemeTokens } from '@/theme';
import { MemoryService, revisionCountLabel } from './memory.service';

function CollectionRow({
  collection,
  styles,
  retired,
}: {
  collection: MemoryCollection;
  styles: ReturnType<typeof makeStyles>;
  retired?: boolean;
}) {
  return (
    <View style={[styles.card, retired && styles.cardRetired]}>
      <Text style={[styles.cardTitle, retired && styles.quiet]}>{collection.title}</Text>
      {collection.description ? (
        <Text style={[styles.cardDesc, retired && styles.quiet]} numberOfLines={3}>
          {collection.description}
        </Text>
      ) : null}
      <Text style={styles.cardMeta}>
        {`${String(collection.entryCount)} 条 · 更新于 ${formatDateTime(collection.updatedAt)}`}
      </Text>
    </View>
  );
}

function RevisionRow({
  revision,
  styles,
}: {
  revision: MemoryRevision;
  styles: ReturnType<typeof makeStyles>;
}) {
  return (
    <View style={styles.rev}>
      <Text style={styles.revTime}>{formatDateTime(revision.createdAt)}</Text>
      <Text style={styles.revSummary}>{revision.summary}</Text>
      <Text style={styles.revMeta}>{revisionCountLabel(revision.diff)}</Text>
    </View>
  );
}

const MemoryContent = observer(function MemoryContent() {
  const service = useService(MemoryService);
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);

  useEffect(() => {
    void service.load();
  }, [service]);

  const active = service.activeCollections;
  const retired = service.retiredCollections;
  const loading = service.$model.load.loading;
  const more = service.revisions.length < service.revisionTotal;
  const showCollectionEmpty = !loading && !service.error && active.length === 0;
  const showRevisionEmpty = !loading && !service.error && service.revisions.length === 0;

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <StackHeader title="记忆" onBack={() => router.back()} />
      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.lede}>只供查看。</Text>
        {service.error ? (
          <>
            <Text style={styles.error} accessibilityRole="alert">
              {service.error}
            </Text>
            <Pressable
              onPress={() => void service.load()}
              disabled={loading}
              style={[styles.more, loading && styles.dim]}
            >
              <Text style={styles.moreText}>重试</Text>
            </Pressable>
          </>
        ) : null}
        {!service.ready || (loading && active.length === 0 && service.revisions.length === 0) ? (
          <Text style={styles.hint}>正在读取…</Text>
        ) : null}
        {service.ready ? (
          <>
            <Text style={styles.sec}>集合</Text>
            {showCollectionEmpty ? (
              <Text style={styles.hint}>
                {retired.length === 0
                  ? '还没有记忆集合。整理任务会在处理卡片反馈后写到这里。'
                  : '没有启用中的集合。'}
              </Text>
            ) : active.length === 0 ? null : (
              active.map((collection) => (
                <CollectionRow key={collection.id} collection={collection} styles={styles} />
              ))
            )}
            {retired.length > 0 ? (
              <>
                <Text style={[styles.sec, styles.secQuiet]}>已停用</Text>
                {retired.map((collection) => (
                  <CollectionRow
                    key={collection.id}
                    collection={collection}
                    styles={styles}
                    retired
                  />
                ))}
              </>
            ) : null}
            <Text style={styles.sec}>最近整理</Text>
            {showRevisionEmpty ? (
              <Text style={styles.hint}>还没有整理记录。</Text>
            ) : service.revisions.length === 0 ? null : (
              service.revisions.map((revision) => (
                <RevisionRow key={revision.id} revision={revision} styles={styles} />
              ))
            )}
            {more ? (
              <Pressable
                onPress={() => void service.loadMoreRevisions()}
                disabled={service.$model.loadMoreRevisions.loading}
                style={styles.more}
              >
                <Text style={styles.moreText}>
                  {service.$model.loadMoreRevisions.loading ? '读取中…' : '更早的记录'}
                </Text>
              </Pressable>
            ) : null}
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
});

function makeStyles(theme: ThemeTokens) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.colors.bg },
    body: { paddingHorizontal: theme.spacing[5], paddingBottom: 48 },
    lede: { fontSize: 13.5, color: theme.colors.ink3, marginBottom: 8 },
    error: { color: theme.colors.accent, fontSize: 13.5, marginBottom: 8 },
    hint: { color: theme.colors.ink4, fontSize: 13.5, lineHeight: 20, marginBottom: 8 },
    sec: {
      marginTop: 18,
      marginBottom: 8,
      fontSize: 12,
      fontWeight: '600',
      letterSpacing: 1,
      color: theme.colors.ink3,
    },
    secQuiet: { color: theme.colors.ink4 },
    card: {
      backgroundColor: theme.colors.surface,
      borderRadius: theme.radius.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.colors.lineSoft,
      paddingHorizontal: 16,
      paddingVertical: 14,
      marginBottom: 10,
    },
    cardRetired: {
      backgroundColor: 'transparent',
      borderColor: 'transparent',
      paddingHorizontal: 2,
    },
    cardTitle: { fontSize: 16, fontWeight: '700', color: theme.colors.ink },
    cardDesc: { marginTop: 4, fontSize: 13.5, lineHeight: 20, color: theme.colors.ink2 },
    cardMeta: { marginTop: 6, fontSize: 12.5, color: theme.colors.ink4 },
    quiet: { color: theme.colors.ink3 },
    rev: {
      paddingVertical: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.colors.lineSoft,
    },
    revTime: { fontSize: 12.5, color: theme.colors.ink4 },
    revSummary: { marginTop: 4, fontSize: 15, lineHeight: 22, color: theme.colors.ink },
    revMeta: { marginTop: 4, fontSize: 12.5, lineHeight: 18, color: theme.colors.ink3 },
    more: { marginTop: 16, alignItems: 'flex-start' },
    dim: { opacity: 0.45 },
    moreText: { color: theme.colors.accentDeep, fontSize: 14, fontWeight: '600' },
  });
}

export default bindServices(MemoryContent, [MemoryService]);
