import { docDisplayTitle } from '@inwit/dto';
import { bindServices, observer, useService } from '@rabjs/react';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StackHeader } from '@/components/stack-header';
import { formatRelativeTime } from '@/lib/format';
import { useTheme, type ThemeTokens } from '@/theme';
import { ArchiveService } from './archive.service';

const ArchiveContent = observer(function ArchiveContent() {
  const service = useService(ArchiveService);
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const loading = service.$model.load.loading;

  useFocusEffect(
    useCallback(() => {
      void service.load();
    }, [service]),
  );

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <StackHeader title="回收站" onBack={() => router.back()} />
      <ScrollView contentContainerStyle={styles.body}>
        <Group
          title="文档"
          empty="回收站里没有文档。"
          error={service.documentsError}
          loading={loading && service.documents.length === 0 && !service.documentsError}
          hasMore={service.documentsHasMore}
          moreLoading={service.$model.loadMoreDocuments.loading}
          onMore={() => void service.loadMoreDocuments()}
          styles={styles}
        >
          {service.documents.map((doc) => (
            <Row
              key={doc.id}
              title={docDisplayTitle(doc)}
              titleLines={1}
              when={doc.deletedAt ?? doc.updatedAt}
              busy={service.busyId === doc.id}
              onRestore={() => void service.restoreArchivedDocument(doc.id)}
              onDestroy={() => void service.destroyArchivedDocument(doc.id)}
              styles={styles}
            />
          ))}
        </Group>
        <Group
          title="卡片"
          empty="没有卡片。"
          error={service.cardsError}
          loading={loading && service.cards.length === 0 && !service.cardsError}
          hasMore={service.cardsHasMore}
          moreLoading={service.$model.loadMoreCards.loading}
          onMore={() => void service.loadMoreCards()}
          styles={styles}
        >
          {service.cards.map((card) => (
            <Row
              key={card.id}
              title={card.concept}
              titleLines={1}
              when={card.deletedAt ?? card.updatedAt}
              busy={service.busyId === card.id}
              onRestore={() => void service.restoreArchivedCard(card.id)}
              onDestroy={() => void service.destroyArchivedCard(card.id)}
              styles={styles}
            />
          ))}
        </Group>
        <Group
          title="批注"
          empty="没有批注。"
          error={service.annotationsError}
          loading={loading && service.annotations.length === 0 && !service.annotationsError}
          hasMore={service.annotationsHasMore}
          moreLoading={service.$model.loadMoreAnnotations.loading}
          onMore={() => void service.loadMoreAnnotations()}
          styles={styles}
        >
          {service.annotations.map((note) => (
            <Row
              key={note.id}
              title={note.quote}
              titleLines={2}
              when={note.deletedAt ?? note.updatedAt}
              busy={service.busyId === note.id}
              onRestore={() => void service.restoreArchivedAnnotation(note.id)}
              onDestroy={() => void service.destroyArchivedAnnotation(note.id)}
              styles={styles}
            />
          ))}
        </Group>
      </ScrollView>
    </SafeAreaView>
  );
});

function Group({
  title,
  empty,
  error,
  loading,
  hasMore,
  moreLoading,
  onMore,
  styles,
  children,
}: {
  title: string;
  empty: string;
  error: string | null;
  loading: boolean;
  hasMore: boolean;
  moreLoading: boolean;
  onMore: () => void;
  styles: ReturnType<typeof makeStyles>;
  children: ReactNode;
}) {
  const emptyVisible = !loading && !error && !hasItems(children);
  return (
    <View style={styles.group}>
      <Text style={styles.groupTitle}>{title}</Text>
      {error ? (
        <Text style={styles.error} accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
      {children}
      {emptyVisible ? <Text style={styles.empty}>{empty}</Text> : null}
      {hasMore ? (
        <Pressable onPress={onMore} disabled={moreLoading} style={styles.more}>
          <Text style={styles.moreText}>{moreLoading ? '载入中…' : '更早的'}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function hasItems(children: ReactNode): boolean {
  if (Array.isArray(children)) return children.length > 0;
  return children != null;
}

function Row({
  title,
  titleLines,
  when,
  busy,
  onRestore,
  onDestroy,
  styles,
}: {
  title: string;
  titleLines: number;
  when: string;
  busy: boolean;
  onRestore: () => void;
  onDestroy: () => void;
  styles: ReturnType<typeof makeStyles>;
}) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowTitle} numberOfLines={titleLines}>
        {title}
      </Text>
      <Text style={styles.when}>{formatRelativeTime(when)}</Text>
      <View style={styles.actions}>
        <Pressable disabled={busy} onPress={onRestore} hitSlop={6}>
          <Text style={[styles.action, busy && styles.dim]}>恢复</Text>
        </Pressable>
        <Pressable disabled={busy} onPress={onDestroy} hitSlop={6}>
          <Text style={[styles.destroy, busy && styles.dim]}>彻底删除</Text>
        </Pressable>
      </View>
    </View>
  );
}

function makeStyles(theme: ThemeTokens) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.colors.bg },
    body: { paddingHorizontal: theme.spacing[5], paddingBottom: 40 },
    group: { marginTop: 8, marginBottom: 18 },
    groupTitle: {
      fontSize: 13,
      fontWeight: '700',
      color: theme.colors.ink3,
      marginBottom: 6,
    },
    error: { color: theme.colors.accent, fontSize: 13.5, marginBottom: 8 },
    empty: { fontSize: 13.5, color: theme.colors.ink3, paddingVertical: 8 },
    row: {
      paddingVertical: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.colors.lineSoft,
    },
    rowTitle: { fontSize: 15.5, fontWeight: '600', color: theme.colors.ink },
    when: { fontSize: 12, color: theme.colors.ink4, marginTop: 4 },
    actions: { flexDirection: 'row', gap: 16, marginTop: 8 },
    action: { fontSize: 13.5, color: theme.colors.accentDeep, fontWeight: '600' },
    destroy: { fontSize: 13.5, color: theme.colors.accent, fontWeight: '600' },
    dim: { opacity: 0.45 },
    more: { paddingVertical: 12 },
    moreText: { fontSize: 13.5, color: theme.colors.accentDeep, fontWeight: '600' },
  });
}

export default bindServices(ArchiveContent, [ArchiveService]);
