import {
  agentDocumentMetaLabel,
  BLANK_DOCUMENT_LABEL,
  docCardFace,
  docCardLabel,
  docDisplayTitle,
  type DocumentListItem,
} from '@inwit/dto';
import { bindServices, observer, useService } from '@rabjs/react';
import { router, useFocusEffect } from 'expo-router';
import { Plus, Search } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  AppState,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BottomSheet } from '@/components/bottom-sheet';
import { CaptureBox } from '@/components/capture-box';
import { confirmAction } from '@/lib/confirm';
import { formatRelativeTime } from '@/lib/format';
import { useTheme, type ThemeTokens } from '@/theme';
import { DocsService } from './docs.service';
import { ImportService } from './import.service';

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

const DocRow = observer(function DocRow({
  doc,
  onOpenMenu,
}: {
  doc: DocumentListItem;
  onOpenMenu: (doc: DocumentListItem) => void;
}) {
  const service = useService(DocsService);
  const imports = useService(ImportService);
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const stage = service.stageFor(doc);
  const agent = agentDocumentMetaLabel(doc.source, doc.title, doc.kind);
  const face = docCardFace(doc, 120);
  const failed = doc.status === 'failed' || stage.kind === 'failed';
  const uploading = stage.kind === 'upload';
  const pulse = !uploading && stage.pulse && stage.label;
  const live = imports.uploadByDoc[doc.id];
  const checkpoint = imports.checkpointFor(doc.id);
  const uploadName = live?.filename ?? checkpoint?.filename ?? '';
  const uploadPercent = live?.percent ?? stage.percent ?? 0;

  return (
    <Pressable
      onPress={() => router.push({ pathname: '/docs/[id]', params: { id: doc.id } })}
      onLongPress={() => onOpenMenu(doc)}
      style={[styles.row, failed && styles.rowFailed]}
      accessibilityLabel={docCardLabel(face)}
    >
      {face.title ? (
        <Text style={[styles.rowTitle, failed && styles.rowTitleFailed]} numberOfLines={2}>
          {face.title}
        </Text>
      ) : null}
      {face.preview ? (
        <Text
          style={face.title ? styles.rowSummary : styles.rowLead}
          numberOfLines={face.title ? 2 : 3}
        >
          {face.preview}
        </Text>
      ) : !face.title ? (
        <Text style={styles.rowBlank}>{BLANK_DOCUMENT_LABEL}</Text>
      ) : null}
      <View style={styles.rowMeta}>
        {doc.proposedCount > 0 ? (
          <Text style={styles.proposed}>待确认 {doc.proposedCount}</Text>
        ) : null}
        {pulse ? <PulseLabel text={stage.label.replace(/…$/, '') || '消化中'} /> : null}
        {uploading ? (
          <View style={styles.uploadLine}>
            <Text style={styles.uploadName} numberOfLines={1}>
              {uploadName} {uploadPercent}%
            </Text>
            <Pressable
              disabled={service.cancelingId === doc.id}
              onPress={() => void service.cancelImport(doc.id)}
              hitSlop={8}
            >
              <Text style={styles.retry}>{service.cancelingId === doc.id ? '取消中…' : '取消'}</Text>
            </Pressable>
          </View>
        ) : null}
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
  const imports = useService(ImportService);
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const refreshing = service.$model.loadDocuments.loading && service.documents.length > 0;
  const loading = service.$model.boot.loading && service.documents.length === 0;
  const [createOpen, setCreateOpen] = useState(false);
  const [actionDoc, setActionDoc] = useState<DocumentListItem | null>(null);
  const [renameDoc, setRenameDoc] = useState<DocumentListItem | null>(null);
  const [renameDraft, setRenameDraft] = useState('');

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

  const openCreated = (id: string | null, edit = false) => {
    if (!id) return;
    router.push({
      pathname: '/docs/[id]',
      params: edit ? { id, edit: '1' } : { id },
    });
  };

  const trashDoc = (doc: DocumentListItem) => {
    setActionDoc(null);
    void (async () => {
      const ok = await confirmAction(
        '移入回收站',
        '30 天内可以在「我的 → 回收站」恢复。',
        '移入回收站',
        true,
      );
      if (ok) await service.archiveDocument(doc.id);
    })();
  };

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.head}>
        <Text style={styles.title}>文档</Text>
        <View style={styles.headActions}>
          <Pressable
            onPress={() => setCreateOpen(true)}
            hitSlop={8}
            style={styles.searchBtn}
            accessibilityLabel="新建"
          >
            <Plus color={theme.colors.ink2} size={18} strokeWidth={1.8} />
          </Pressable>
          <Pressable onPress={openSearch} hitSlop={8} style={styles.searchBtn} accessibilityLabel="搜索">
            <Search color={theme.colors.ink2} size={18} strokeWidth={1.8} />
          </Pressable>
        </View>
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
        renderItem={({ item }) => <DocRow doc={item} onOpenMenu={setActionDoc} />}
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
      <BottomSheet visible={createOpen} title="新建" onClose={() => setCreateOpen(false)}>
        <Pressable
          onPress={() => {
            setCreateOpen(false);
            void service.createBlank().then((id) => openCreated(id, true));
          }}
          style={styles.sheetRow}
        >
          <Text style={styles.sheetLabel}>写一篇</Text>
        </Pressable>
        <Pressable
          onPress={() => {
            setCreateOpen(false);
            void imports.pickAndImport().then((id) => openCreated(id));
          }}
          style={styles.sheetRow}
        >
          <Text style={styles.sheetLabel}>导入文件</Text>
        </Pressable>
        <Pressable
          onPress={() => {
            setCreateOpen(false);
            void imports.takePhoto().then((id) => openCreated(id));
          }}
          style={styles.sheetRow}
        >
          <Text style={styles.sheetLabel}>拍照</Text>
        </Pressable>
        <Pressable
          onPress={() => {
            setCreateOpen(false);
            void imports.pickPhoto().then((id) => openCreated(id));
          }}
          style={styles.sheetRow}
        >
          <Text style={styles.sheetLabel}>从相册选择</Text>
        </Pressable>
      </BottomSheet>
      <BottomSheet
        visible={actionDoc !== null}
        title={actionDoc ? docDisplayTitle(actionDoc) : undefined}
        onClose={() => setActionDoc(null)}
      >
        <Pressable
          onPress={() => {
            if (!actionDoc) return;
            setRenameDraft(actionDoc.title ?? '');
            setRenameDoc(actionDoc);
            setActionDoc(null);
          }}
          style={styles.sheetRow}
        >
          <Text style={styles.sheetLabel}>重命名</Text>
        </Pressable>
        <Pressable
          onPress={() => {
            if (actionDoc) trashDoc(actionDoc);
          }}
          style={styles.sheetRow}
        >
          <Text style={styles.sheetDanger}>移入回收站</Text>
        </Pressable>
      </BottomSheet>
      <BottomSheet
        visible={renameDoc !== null}
        title="重命名"
        onClose={() => setRenameDoc(null)}
        footer={
          <>
            <Pressable onPress={() => setRenameDoc(null)} hitSlop={8}>
              <Text style={styles.sheetLabel}>取消</Text>
            </Pressable>
            <Pressable
              disabled={service.$model.renameDocument.loading}
              onPress={() => {
                if (!renameDoc) return;
                void service.renameDocument(renameDoc.id, renameDraft).then((ok) => {
                  if (ok) setRenameDoc(null);
                });
              }}
              hitSlop={8}
            >
              <Text style={styles.sheetSave}>
                {service.$model.renameDocument.loading ? '保存中…' : '保存'}
              </Text>
            </Pressable>
          </>
        }
      >
        <TextInput
          value={renameDraft}
          onChangeText={setRenameDraft}
          placeholder="文档标题"
          placeholderTextColor={theme.colors.ink4}
          style={styles.renameInput}
          maxLength={500}
          autoFocus
        />
      </BottomSheet>
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
    headActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
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
    rowLead: { fontSize: 15, color: theme.colors.ink2, lineHeight: 22 },
    rowBlank: { fontSize: 14, color: theme.colors.ink4, fontStyle: 'italic' },
    rowMeta: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginTop: 6 },
    tag: { borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
    tagAi: { backgroundColor: theme.colors.accentSoft },
    tagTopic: { backgroundColor: theme.colors.greenSoft },
    tagAiText: { fontSize: 11, color: theme.colors.accentDeep },
    tagTopicText: { fontSize: 11, color: theme.colors.green },
    metaText: { fontSize: 12, color: theme.colors.ink4 },
    proposed: { fontSize: 12, color: theme.colors.gold },
    failed: { fontSize: 12, color: theme.colors.accent, fontWeight: '600' },
    retry: { fontSize: 12.5, color: theme.colors.accentDeep, fontWeight: '600' },
    uploadLine: { flexDirection: 'row', alignItems: 'center', gap: 8, maxWidth: '100%' },
    uploadName: { flexShrink: 1, fontSize: 12, color: theme.colors.ink2 },
    hint: { fontSize: 13.5, color: theme.colors.ink3, marginTop: 16 },
    sheetRow: { paddingVertical: 14 },
    sheetLabel: { fontSize: 16, color: theme.colors.ink },
    sheetDanger: { fontSize: 16, color: theme.colors.accent },
    sheetSave: { fontSize: 16, color: theme.colors.accentDeep, fontWeight: '600' },
    renameInput: {
      height: 44,
      borderRadius: theme.radius.md,
      borderWidth: 1,
      borderColor: theme.colors.line,
      backgroundColor: theme.colors.bg,
      paddingHorizontal: 12,
      color: theme.colors.ink,
      fontSize: 16,
    },
  });
}

export default bindServices(DocsContent, [DocsService, ImportService]);
