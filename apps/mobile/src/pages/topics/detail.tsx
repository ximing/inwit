import {
  agentDocumentMetaLabel,
  docDisplayTitle,
  type DocumentListItem,
  type MapNodeStatus,
  type MapTreeNode,
} from '@inwit/dto';
import { bindServices, observer, useService } from '@rabjs/react';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { ChevronDown, ChevronRight, MoreHorizontal, Search } from 'lucide-react-native';
import { useCallback, useMemo } from 'react';
import {
  AppState,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BottomSheet } from '@/components/bottom-sheet';
import { CaptureBox } from '@/components/capture-box';
import { ProgressBar } from '@/components/progress-bar';
import { StackHeader } from '@/components/stack-header';
import { confirmAction } from '@/lib/confirm';
import { formatRelativeTime, summarizeAnswer } from '@/lib/format';
import { ROUTES } from '@/routes';
import { useTheme, type ThemeTokens } from '@/theme';
import { flattenMapTree, TopicsService, type TopicTab } from './topics.service';

function statusColor(status: MapNodeStatus, theme: ThemeTokens): string {
  if (status === 'covered') return theme.colors.green;
  if (status === 'learning') return theme.colors.gold;
  return theme.colors.ink4;
}

function statusLabel(status: MapNodeStatus): string {
  if (status === 'covered') return '已覆盖';
  if (status === 'learning') return '学习中';
  return '未覆盖';
}

function cardExcerpt(doc: DocumentListItem): string | null {
  const desc = doc.description?.trim() ?? '';
  if (doc.title?.trim() && desc) return desc;
  if (doc.source === 'chat' && doc.answer) return summarizeAnswer(doc.answer, 96);
  return desc || null;
}

const TopicDetailContent = observer(function TopicDetailContent() {
  const service = useService(TopicsService);
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const params = useLocalSearchParams<{ id: string }>();
  const id = typeof params.id === 'string' ? params.id : '';
  const topic = service.topic;
  const archived = topic?.status === 'archived';
  const loading = service.$model.openTopic.loading && !topic;

  useFocusEffect(
    useCallback(() => {
      service.setFocused(true);
      service.setAppActive(AppState.currentState === 'active');
      if (id) void service.openTopic(id);
      const sub = AppState.addEventListener('change', (state) => {
        service.setAppActive(state === 'active');
      });
      return () => {
        service.setFocused(false);
        service.stopJobPolling();
        service.stopDocPolling();
        sub.remove();
      };
    }, [service, id]),
  );

  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace(ROUTES.topics);
  };

  const remove = async () => {
    const ok = await confirmAction(
      '删除主题',
      '删除这个主题？文档会保留，地图会一起删掉。',
      '删除',
      true,
    );
    if (!ok) return;
    if (await service.deleteSelected()) goBack();
  };

  const openDoc = (docId: string) => {
    router.push(`/docs/${docId}`);
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.screen} edges={['top']}>
        <StackHeader title="主题" onBack={goBack} />
        <Text style={styles.hint}>打开主题…</Text>
      </SafeAreaView>
    );
  }

  if (service.detailError && !topic) {
    return (
      <SafeAreaView style={styles.screen} edges={['top']}>
        <StackHeader title="主题" onBack={goBack} />
        <Text style={styles.error}>{service.detailError}</Text>
      </SafeAreaView>
    );
  }

  if (!topic || topic.id !== id) {
    return (
      <SafeAreaView style={styles.screen} edges={['top']}>
        <StackHeader title="主题" onBack={goBack} />
        <Text style={styles.hint}>打开主题…</Text>
      </SafeAreaView>
    );
  }

  const emptyGoal = !topic.goal || topic.goal.trim().length === 0;
  const pct = service.masteryPct;
  const lastAt = service.lastDigestedAt;

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <StackHeader
        title={topic.title}
        onBack={goBack}
        right={
          <View style={styles.headActions}>
            <Pressable
              onPress={() => router.push({ pathname: '/search', params: { topicId: topic.id } })}
              hitSlop={8}
              accessibilityLabel="搜索这个主题"
            >
              <Search color={theme.colors.ink2} size={18} strokeWidth={1.8} />
            </Pressable>
            <Pressable
              onPress={() => service.togglePaneMenu()}
              hitSlop={8}
              accessibilityLabel="主题操作"
            >
              <MoreHorizontal color={theme.colors.ink2} size={18} strokeWidth={1.8} />
            </Pressable>
          </View>
        }
      />

      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {service.editing === 'title' ? (
          <TextInput
            style={styles.titleInput}
            value={service.draftTitle}
            maxLength={200}
            autoFocus
            editable={!service.$model.commitEdit.loading}
            onChangeText={(value) => service.setDraftTitle(value)}
            onBlur={() => void service.commitEdit()}
            onSubmitEditing={() => void service.commitEdit()}
          />
        ) : (
          <Pressable onPress={() => service.startEdit('title')}>
            <Text style={styles.paneTitle}>
              {topic.title}
              {archived ? <Text style={styles.archivedTag}>  已归档</Text> : null}
            </Text>
          </Pressable>
        )}

        {service.editing === 'goal' ? (
          <TextInput
            style={styles.goalInput}
            value={service.draftGoal}
            maxLength={4000}
            autoFocus
            placeholder="一句话锚定这个专题的消化方式"
            placeholderTextColor={theme.colors.ink4}
            editable={!service.$model.commitEdit.loading}
            onChangeText={(value) => service.setDraftGoal(value)}
            onBlur={() => void service.commitEdit()}
            onSubmitEditing={() => void service.commitEdit()}
          />
        ) : (
          <Pressable onPress={() => service.startEdit('goal')}>
            <Text style={[styles.goal, emptyGoal && styles.goalEmpty]}>
              {emptyGoal ? '一句话锚定这个专题的消化方式' : topic.goal}
            </Text>
          </Pressable>
        )}

        {service.detailError ? (
          <Text style={styles.error} accessibilityRole="alert">
            {service.detailError}
          </Text>
        ) : null}

        <View style={styles.statbar}>
          <Text style={styles.stat}>{service.cardCount} 张卡</Text>
          <Text style={styles.statDot}>·</Text>
          <Text style={styles.stat}>{service.documentCount} 篇文档</Text>
          <Text style={styles.statDot}>·</Text>
          <Text style={styles.stat}>掌握度 {pct}%</Text>
        </View>
        <View style={styles.masteryRow}>
          <ProgressBar pct={pct} theme={theme} />
        </View>
        <View style={styles.statbar}>
          <Text style={styles.stat}>{lastAt ? `最近消化 ${formatRelativeTime(lastAt)}` : '还没有消化'}</Text>
          <Text style={styles.statDot}>·</Text>
          <Pressable onPress={() => service.setTab('map')}>
            <Text style={styles.covChip}>
              地图覆盖 {service.coveredCount}/{service.mapNodeCount}
            </Text>
          </Pressable>
        </View>

        <View style={styles.tabs} accessibilityRole="tablist">
          {(['docs', 'map', 'feed'] as TopicTab[]).map((tab) => {
            const on = service.tab === tab;
            const label =
              tab === 'docs'
                ? `文档 ${service.documentCount}`
                : tab === 'map'
                  ? `图谱 ${service.mapNodeCount}`
                  : '动态';
            return (
              <Pressable
                key={tab}
                onPress={() => service.setTab(tab)}
                style={[styles.tab, on && styles.tabOn]}
                accessibilityRole="tab"
                accessibilityState={{ selected: on }}
              >
                <Text style={[styles.tabText, on && styles.tabTextOn]}>{label}</Text>
              </Pressable>
            );
          })}
        </View>

        {service.tab === 'docs' ? <DocsTab archived={archived} onOpenDoc={openDoc} /> : null}
        {service.tab === 'map' ? <MapTab archived={archived} onOpenDoc={openDoc} /> : null}
        {service.tab === 'feed' ? <FeedTab onOpenDoc={openDoc} /> : null}
      </ScrollView>

      <Modal
        visible={service.paneMenuOpen}
        transparent
        animationType="fade"
        onRequestClose={() => service.closePaneMenu()}
      >
        <Pressable style={styles.backdrop} onPress={() => service.closePaneMenu()}>
          <Pressable style={styles.menu} onPress={() => {}}>
            {archived ? (
              <Pressable
                disabled={service.$model.restoreSelected.loading}
                onPress={() => void service.restoreSelected()}
                style={styles.menuItem}
              >
                <Text style={styles.menuText}>
                  {service.$model.restoreSelected.loading ? '恢复中…' : '取消归档'}
                </Text>
              </Pressable>
            ) : (
              <Pressable
                disabled={service.$model.archiveSelected.loading}
                onPress={() => void service.archiveSelected()}
                style={styles.menuItem}
              >
                <Text style={styles.menuText}>
                  {service.$model.archiveSelected.loading ? '归档中…' : '归档'}
                </Text>
              </Pressable>
            )}
            <Pressable
              disabled={service.$model.deleteSelected.loading}
              onPress={() => void remove()}
              style={styles.menuItem}
            >
              <Text style={styles.menuDanger}>
                {service.$model.deleteSelected.loading ? '删除中…' : '删除'}
              </Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
});

const DocsTab = observer(function DocsTab({
  archived,
  onOpenDoc,
}: {
  archived: boolean;
  onOpenDoc: (id: string) => void;
}) {
  const service = useService(TopicsService);
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  return (
    <View>
      <CaptureBox
        draft={service.draft}
        onChangeDraft={(value) => service.setDraft(value)}
        canSend={service.canSend}
        sending={service.$model.send.loading}
        looksLikeQuestion={service.draftLooksLikeQuestion}
        onSend={(mode) => void service.send(mode)}
        topics={service.topic ? [service.topic] : []}
        topicId={service.topic?.id ?? null}
        onSelectTopic={() => {}}
        onCreateTopic={async () => null}
        lockedTopic
        disabled={archived}
        placeholder={archived ? '已归档，不能再往这个主题扔内容' : undefined}
      />
      {service.documents.length === 0 && !service.$model.openTopic.loading ? (
        <Text style={styles.hint}>这张纸还是空的。扔一句话进来。</Text>
      ) : null}
      {service.documents.map((doc) => (
        <DocCard key={doc.id} doc={doc} onOpen={() => onOpenDoc(doc.id)} />
      ))}
      {service.hasMoreDocs ? (
        <Pressable
          disabled={service.$model.loadMoreDocs.loading}
          onPress={() => void service.loadMoreDocs()}
          style={styles.moreBtn}
        >
          <Text style={styles.moreText}>
            {service.$model.loadMoreDocs.loading ? '载入中…' : '更早的文档'}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
});

const DocCard = observer(function DocCard({
  doc,
  onOpen,
}: {
  doc: DocumentListItem;
  onOpen: () => void;
}) {
  const service = useService(TopicsService);
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const excerpt = cardExcerpt(doc);
  const hanging = service.hangingTitle(doc);
  const agent = agentDocumentMetaLabel(doc.source, doc.title);
  const pending = doc.status === 'pending';
  return (
    <Pressable onPress={onOpen} style={styles.docCard}>
      <Text style={styles.docTitle} numberOfLines={2}>
        {docDisplayTitle(doc)}
      </Text>
      {excerpt ? (
        <Text style={styles.docExcerpt} numberOfLines={2}>
          {excerpt}
        </Text>
      ) : null}
      <View style={styles.docMeta}>
        {pending ? <Text style={styles.gold}>消化中</Text> : null}
        {doc.status === 'failed' ? <Text style={styles.failed}>失败</Text> : null}
        {agent ? <Text style={styles.aiTag}>{agent}</Text> : null}
        <Text style={styles.metaText}>
          {doc.cardCount} 张卡 · {formatRelativeTime(doc.updatedAt)}
        </Text>
      </View>
      {hanging ? (
        <Text style={styles.hang}>
          挂在：<Text style={styles.hangB}>{hanging}</Text>
        </Text>
      ) : null}
    </Pressable>
  );
});

const MapTab = observer(function MapTab({
  archived,
  onOpenDoc,
}: {
  archived: boolean;
  onOpenDoc: (id: string) => void;
}) {
  const service = useService(TopicsService);
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const rows = flattenMapTree(service.tree, service.collapsedIds);
  const fillDisabled = archived || service.jobRunning || !service.fillTarget;
  const organizeDisabled = archived || service.jobRunning;

  const jobLine = service.jobRunning
    ? service.organizing
      ? '正在整理地图…'
      : service.fillingNodeId
        ? '正在补充节点…'
        : '主题任务进行中…'
    : null;

  return (
    <View>
      <View style={styles.mapToolbar}>
        <Pressable
          disabled={organizeDisabled}
          onPress={() => void service.organize()}
          style={[styles.ghostBtn, organizeDisabled && styles.dim]}
        >
          <Text style={styles.ghostText}>{service.organizing ? '整理中…' : '整理'}</Text>
        </Pressable>
        <Pressable
          disabled={fillDisabled}
          onPress={() => void service.fill()}
          style={[styles.ghostBtn, fillDisabled && styles.dim]}
        >
          <Text style={styles.ghostText}>
            {service.fillingNodeId ? '补充中…' : '补充'}
          </Text>
        </Pressable>
        <Text style={styles.covText}>
          已覆盖 {service.coveredCount}/{service.summary?.totalNodes ?? 0}
        </Text>
      </View>
      {jobLine ? <Text style={styles.jobLine}>{jobLine}</Text> : null}

      {service.emptyMap ? (
        <View style={styles.mapEmpty}>
          <Text style={styles.hint}>{service.organizing ? '正在长出地图…' : '还没有地图'}</Text>
          <Pressable
            disabled={organizeDisabled}
            onPress={() => void service.organize()}
            style={[styles.primaryBtn, organizeDisabled && styles.dim]}
          >
            <Text style={styles.primaryText}>
              {service.organizing ? '整理中…' : '让 AI 整理一张地图'}
            </Text>
          </Pressable>
        </View>
      ) : (
        rows.map(({ node, depth }) => (
          <MapNodeRow key={node.id} node={node} depth={depth} />
        ))
      )}

      <NodeSheet onOpenDoc={onOpenDoc} />
    </View>
  );
});

const MapNodeRow = observer(function MapNodeRow({
  node,
  depth,
}: {
  node: MapTreeNode;
  depth: number;
}) {
  const service = useService(TopicsService);
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const hasKids = node.children.length > 0;
  const collapsed = service.isCollapsed(node.id);
  return (
    <View style={[styles.mapRow, { paddingLeft: 4 + depth * 16 }]}>
      {hasKids ? (
        <Pressable onPress={() => service.toggleCollapsed(node.id)} hitSlop={8} style={styles.chev}>
          {collapsed ? (
            <ChevronRight color={theme.colors.ink3} size={14} strokeWidth={1.8} />
          ) : (
            <ChevronDown color={theme.colors.ink3} size={14} strokeWidth={1.8} />
          )}
        </Pressable>
      ) : (
        <View style={styles.chev} />
      )}
      <Pressable style={styles.mapMain} onPress={() => void service.openNode(node.id)}>
        <View
          style={[styles.dot, { backgroundColor: statusColor(node.status, theme) }]}
          accessibilityLabel={statusLabel(node.status)}
        />
        <Text style={styles.mapTitle} numberOfLines={1}>
          {node.title}
        </Text>
        <Text style={styles.metaText}>{node.cardCount} 卡</Text>
      </Pressable>
    </View>
  );
});

const NodeSheet = observer(function NodeSheet({ onOpenDoc }: { onOpenDoc: (id: string) => void }) {
  const service = useService(TopicsService);
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const detail = service.nodeDetail;
  const loading = service.$model.openNode.loading && service.selectedNodeId !== null;
  const uncovered = detail?.node.status === 'uncovered';
  const filling = detail ? service.fillingNodeId === detail.node.id : false;
  const archived = service.topic?.status === 'archived';

  return (
    <BottomSheet
      visible={service.drawerOpen}
      title={detail?.node.title ?? '节点'}
      onClose={() => service.closeDrawer()}
    >
      {loading && !detail ? <Text style={styles.hint}>打开节点…</Text> : null}
      {detail ? (
        <>
          {detail.node.note ? <Text style={styles.goal}>{detail.node.note}</Text> : null}
          {uncovered ? (
            <Pressable
              disabled={archived || service.jobRunning}
              onPress={() => void service.fill(detail.node.id)}
              style={[styles.ghostBtn, (archived || service.jobRunning) && styles.dim]}
            >
              <Text style={styles.ghostText}>{filling ? '补充中…' : '让 AI 补'}</Text>
            </Pressable>
          ) : null}

          <Text style={styles.subhead}>卡片</Text>
          {detail.cards.length === 0 ? <Text style={styles.hint}>这个节点还没有卡片。</Text> : null}
          {detail.cards.map((card) => (
            <Pressable
              key={card.id}
              style={styles.sheetRow}
              onPress={() => {
                service.closeDrawer();
                if (card.documentId) {
                  router.push({
                    pathname: '/docs/[id]',
                    params: { id: card.documentId, anchor: card.id },
                  });
                }
              }}
            >
              <Text style={styles.docTitle}>{card.concept}</Text>
              {card.tags.length > 0 ? (
                <Text style={styles.metaText}>{card.tags.join(' · ')}</Text>
              ) : null}
            </Pressable>
          ))}

          <Text style={styles.subhead}>资料</Text>
          {detail.documents.length === 0 ? <Text style={styles.hint}>这个节点还没有资料。</Text> : null}
          {detail.documents.map((doc) => (
            <Pressable
              key={doc.id}
              style={styles.sheetRow}
              onPress={() => {
                service.closeDrawer();
                onOpenDoc(doc.id);
              }}
            >
              <Text style={styles.docTitle}>{docDisplayTitle(doc)}</Text>
            </Pressable>
          ))}
        </>
      ) : null}
    </BottomSheet>
  );
});

const FeedTab = observer(function FeedTab({ onOpenDoc }: { onOpenDoc: (id: string) => void }) {
  const service = useService(TopicsService);
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);

  if (service.documents.length === 0) {
    return <Text style={styles.hint}>这个主题还没有资料。到「文档」里扔一点进来。</Text>;
  }

  return (
    <View>
      {service.documents.map((doc) => (
        <View key={doc.id} style={styles.feedItem}>
          <Text style={styles.feedTime}>{formatRelativeTime(doc.updatedAt)}</Text>
          <DocCard doc={doc} onOpen={() => onOpenDoc(doc.id)} />
        </View>
      ))}
      {service.hasMoreDocs ? (
        <Pressable
          disabled={service.$model.loadMoreDocs.loading}
          onPress={() => void service.loadMoreDocs()}
          style={styles.moreBtn}
        >
          <Text style={styles.moreText}>
            {service.$model.loadMoreDocs.loading ? '载入中…' : '更早的文档'}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
});

function makeStyles(theme: ThemeTokens) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.colors.bg },
    scroll: { paddingHorizontal: theme.spacing[5], paddingBottom: 48 },
    headActions: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    paneTitle: {
      fontFamily: theme.typography.serif,
      fontSize: 22,
      fontWeight: '700',
      color: theme.colors.ink,
      marginTop: 4,
    },
    archivedTag: { fontFamily: theme.typography.sans, fontSize: 12, color: theme.colors.ink3 },
    titleInput: {
      fontFamily: theme.typography.serif,
      fontSize: 22,
      fontWeight: '700',
      color: theme.colors.ink,
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.line,
      paddingVertical: 4,
    },
    goal: { fontSize: 14, color: theme.colors.ink2, marginTop: 8, lineHeight: 20 },
    goalEmpty: { color: theme.colors.ink4 },
    goalInput: {
      fontSize: 14,
      color: theme.colors.ink,
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.line,
      paddingVertical: 6,
      marginTop: 8,
    },
    error: { color: theme.colors.accent, fontSize: 13.5, marginTop: 10 },
    hint: { fontSize: 13.5, color: theme.colors.ink3, marginTop: 12 },
    statbar: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginTop: 12 },
    stat: { fontSize: 12.5, color: theme.colors.ink3 },
    statDot: { color: theme.colors.ink4 },
    masteryRow: { marginTop: 8 },
    covChip: { fontSize: 12.5, color: theme.colors.accentDeep, fontWeight: '600' },
    tabs: {
      flexDirection: 'row',
      backgroundColor: theme.colors.surface2,
      borderRadius: theme.radius.md,
      padding: 3,
      marginTop: 16,
      marginBottom: 14,
      borderWidth: 1,
      borderColor: theme.colors.lineSoft,
    },
    tab: { flex: 1, height: 32, alignItems: 'center', justifyContent: 'center', borderRadius: 8 },
    tabOn: { backgroundColor: theme.colors.surface, ...theme.shadow[1] },
    tabText: { fontSize: 13, color: theme.colors.ink3 },
    tabTextOn: { color: theme.colors.ink, fontWeight: '600' },
    docCard: {
      backgroundColor: theme.colors.surface,
      borderWidth: 1,
      borderColor: theme.colors.line,
      borderRadius: theme.radius.md,
      padding: 12,
      marginBottom: 10,
      ...theme.shadow[1],
    },
    docTitle: { fontSize: 15, fontWeight: '600', color: theme.colors.ink },
    docExcerpt: { fontSize: 13.5, color: theme.colors.ink3, marginTop: 4, lineHeight: 20 },
    docMeta: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6, alignItems: 'center' },
    metaText: { fontSize: 12, color: theme.colors.ink4 },
    gold: { fontSize: 12, color: theme.colors.gold },
    failed: { fontSize: 12, color: theme.colors.accent, fontWeight: '600' },
    aiTag: { fontSize: 11, color: theme.colors.accentDeep },
    hang: { fontSize: 12, color: theme.colors.ink3, marginTop: 4 },
    hangB: { fontWeight: '600', color: theme.colors.ink2 },
    moreBtn: { alignSelf: 'center', paddingVertical: 10 },
    moreText: { color: theme.colors.accentDeep, fontWeight: '600' },
    mapToolbar: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
    ghostBtn: {
      borderRadius: theme.radius.sm,
      paddingHorizontal: 12,
      height: 32,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: theme.colors.line,
      backgroundColor: theme.colors.surface,
    },
    ghostText: { color: theme.colors.ink2, fontSize: 13, fontWeight: '500' },
    primaryBtn: {
      backgroundColor: theme.colors.accent,
      borderRadius: theme.radius.sm,
      paddingHorizontal: 16,
      height: 34,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 12,
    },
    primaryText: { color: theme.colors.onAccent, fontSize: 13.5, fontWeight: '500' },
    dim: { opacity: 0.45 },
    covText: { fontSize: 12, color: theme.colors.ink3, marginLeft: 'auto' },
    jobLine: { fontSize: 12.5, color: theme.colors.gold, marginBottom: 8 },
    mapEmpty: { alignItems: 'flex-start', paddingVertical: 12 },
    mapRow: { flexDirection: 'row', alignItems: 'center', minHeight: 40 },
    chev: { width: 20, alignItems: 'center' },
    mapMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8 },
    mapTitle: { flex: 1, fontSize: 14.5, color: theme.colors.ink },
    dot: { width: 8, height: 8, borderRadius: 4 },
    subhead: { fontSize: 13, fontWeight: '700', color: theme.colors.ink3, marginTop: 14, marginBottom: 6 },
    sheetRow: {
      paddingVertical: 10,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.colors.lineSoft,
    },
    feedItem: { marginBottom: 4 },
    feedTime: { fontSize: 12, color: theme.colors.ink4, marginBottom: 4 },
    backdrop: {
      flex: 1,
      backgroundColor: 'rgba(34, 29, 22, 0.35)',
      justifyContent: 'flex-start',
      alignItems: 'flex-end',
      paddingTop: 88,
      paddingRight: 16,
    },
    menu: {
      backgroundColor: theme.colors.surface,
      borderRadius: theme.radius.md,
      borderWidth: 1,
      borderColor: theme.colors.line,
      minWidth: 160,
      ...theme.shadow[2],
    },
    menuItem: { paddingHorizontal: 16, paddingVertical: 12 },
    menuText: { fontSize: 14, color: theme.colors.ink },
    menuDanger: { fontSize: 14, color: theme.colors.accent, fontWeight: '600' },
  });
}

export default bindServices(TopicDetailContent, [TopicsService]);
