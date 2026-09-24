import { docDisplayTitle, type Annotation, type DocumentCard } from '@inwit/dto';
import { bindServices, observer, useService } from '@rabjs/react';
import * as WebBrowser from 'expo-web-browser';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BottomSheet } from '@/components/bottom-sheet';
import { ClozeText, MasteryDots, MiniCard, cardMasteryLevel, cardNextReviewLabel } from '@/components/mini-card';
import { DocEngineView, type DocEngineHandle } from '@/doc-engine/DocEngineView';
import { useDocEngineAssets } from '@/doc-engine/useDocEngineAssets';
import { groupCardLinks } from '@/lib/card-copy';
import { mapAppHref } from '@/lib/internal-links';
import { ROUTES } from '@/routes';
import { ThemeService, useTheme, type ThemeTokens } from '@/theme';
import { Image } from 'expo-image';
import type { TextSelectionAnchor } from '../../../../../packages/doc-engine/src/protocol';
import { ReaderService } from './reader.service';

function cardEntities(cards: DocumentCard[]) {
  return cards.map((card) => ({
    id: card.id,
    anchorText: card.anchorText,
    anchorBlockIndex: card.anchorBlockIndex,
    hasImage: card.hasImage,
  }));
}

function noteEntities(notes: Annotation[]) {
  return notes.map((item) => ({
    id: item.id,
    kind: item.kind,
    quote: item.quote,
    anchorBlockIndex: item.anchorBlockIndex,
    imageKey: item.imageKey,
  }));
}

const ReaderContent = observer(function ReaderContent() {
  const service = useService(ReaderService);
  const themeService = useService(ThemeService);
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const params = useLocalSearchParams<{ id: string; anchor?: string | string[] }>();
  const id = typeof params.id === 'string' ? params.id : '';
  const anchorParam = Array.isArray(params.anchor) ? params.anchor[0] : params.anchor;
  const engineRef = useRef<DocEngineHandle>(null);
  const onAssetNeeded = useDocEngineAssets(engineRef);

  useEffect(() => {
    service.setFocused(true);
    if (id) void service.load(id, anchorParam ?? null);
    return () => {
      service.setFocused(false);
    };
  }, [service, id, anchorParam]);

  const pushToEngine = useCallback(() => {
    const engine = engineRef.current;
    const doc = service.engineDoc;
    if (!engine || !service.doc || !doc) return;
    engine.setContent(doc);
    engine.setEntities({
      cards: cardEntities(service.doc.cards),
      annotations: noteEntities(service.annotations),
    });
    const focusId = service.consumePendingAnchor();
    if (focusId) {
      engine.focusCard(focusId);
      service.openCard(focusId);
    }
  }, [service]);

  useEffect(() => {
    if (!service.engineReady) return;
    pushToEngine();
  }, [service.engineReady, service.contentGen, pushToEngine]);

  useEffect(() => {
    if (!service.engineReady || service.entityGen === 0) return;
    const current = service.doc;
    if (!current) return;
    engineRef.current?.setEntities({
      cards: cardEntities(current.cards),
      annotations: noteEntities(service.annotations),
    });
  }, [service, service.engineReady, service.entityGen]);

  const onReady = () => {
    service.markEngineReady();
  };

  const onError = (payload: { message: string }) => {
    service.setEngineError(payload.message);
  };

  const onLinkClick = (href: string) => {
    const mapped = mapAppHref(href);
    if (mapped.kind === 'external') {
      void WebBrowser.openBrowserAsync(mapped.url);
      return;
    }
    if (mapped.kind === 'internal') {
      if (mapped.params) {
        router.push({ pathname: mapped.pathname as '/docs/[id]', params: mapped.params });
      } else {
        router.push(mapped.pathname as '/');
      }
    }
  };

  const onSelectionAction = (payload: {
    action: 'annotate' | 'card' | 'digest';
    anchor: TextSelectionAnchor;
  }) => {
    if (payload.action === 'annotate') service.beginAnnotate(payload.anchor);
    else if (payload.action === 'card') service.beginCardForm(payload.anchor);
    else void service.queueDigest(payload.anchor);
  };

  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace(ROUTES.docs);
  };

  const retryEngine = () => {
    service.setEngineError(null);
    engineRef.current?.reload();
  };

  const doc = service.doc;
  const title = doc ? docDisplayTitle(doc) : '文档';
  const showEngine = Boolean(doc && !service.isPdf && !service.isBlank && !service.docError);
  const placeholder =
    service.docError ??
    (service.$model.load.loading && !doc
      ? '打开这张纸…'
      : doc?.status === 'pending' && service.isBlank
        ? '消化中…'
        : doc?.status === 'failed'
          ? doc.failReason
            ? `消化失败：${doc.failReason}`
            : '消化失败'
          : service.isPdf
            ? 'PDF 请在网页端打开'
            : doc && service.isBlank
              ? '这张纸还是空的'
              : null);

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <View style={styles.head}>
        <Pressable onPress={goBack} hitSlop={8} style={styles.headBtn}>
          <Text style={styles.headBtnText}>← 返回</Text>
        </Pressable>
        <Text style={styles.headTitle} numberOfLines={1}>
          {title}
        </Text>
        {service.canConfirmCards ? (
          <Pressable
            onPress={() => void service.acceptAllProposed()}
            disabled={service.deciding}
            hitSlop={8}
            style={styles.headBtn}
          >
            <Text style={styles.headBtnText}>{service.deciding ? '确认中…' : '全部确认'}</Text>
          </Pressable>
        ) : null}
        <Pressable onPress={() => service.openTopicMenu()} hitSlop={8} style={styles.headBtn}>
          <Text style={styles.headBtnText}>主题</Text>
        </Pressable>
        <Pressable onPress={() => themeService.toggleLightDark()} hitSlop={8} style={styles.headBtn}>
          <Text style={styles.headBtnText}>{themeService.resolved === 'dark' ? '浅色' : '深色'}</Text>
        </Pressable>
      </View>

      {service.engineError ? (
        <View style={styles.errorBar}>
          <Text style={styles.errorText}>{service.engineError}</Text>
          <Pressable onPress={retryEngine}>
            <Text style={styles.retry}>重试</Text>
          </Pressable>
        </View>
      ) : null}

      {showEngine ? (
        <DocEngineView
          ref={engineRef}
          style={styles.engine}
          onReady={onReady}
          onError={onError}
          onAssetNeeded={(srcs) => void onAssetNeeded(srcs)}
          onAnchorClick={(ids) => {
            engineRef.current?.setActiveEntity({ kind: 'card', id: ids[0] ?? null });
            service.openAnchors(ids);
          }}
          onAnnotationClick={(ids) => {
            engineRef.current?.setActiveEntity({ kind: 'annotation', id: ids[0] ?? null });
            service.openAnnotations(ids);
          }}
          onSelectionAction={onSelectionAction}
          onLinkClick={onLinkClick}
        />
      ) : (
        <View style={styles.placeholder}>
          <Text style={styles.placeholderText}>{placeholder ?? '打开这张纸…'}</Text>
          {doc?.status === 'failed' ? (
            <Pressable onPress={() => void service.retry()} style={styles.primaryBtn}>
              <Text style={styles.primaryText}>重试消化</Text>
            </Pressable>
          ) : null}
        </View>
      )}

      <CardsSheet />
      <CardDetailSheet />
      <RejectSheet />
      <AnnotationsSheet />
      <AnnotateForm />
      <CardForm />
      <TopicSheet />
    </SafeAreaView>
  );
});

const CardsSheet = observer(function CardsSheet() {
  const service = useService(ReaderService);
  const cards = service.cardsForSheet();
  return (
    <BottomSheet
      visible={service.sheet?.kind === 'cards'}
      title="锚点卡片"
      onClose={() => service.closeSheet()}
    >
      {cards.length === 0 ? (
        <Text>这篇还没有对应的卡片。</Text>
      ) : (
        cards.map((card) => (
          <MiniCard
            key={card.id}
            card={card}
            active={service.activeCardId === card.id}
            digesting={service.doc?.status !== 'digested'}
            thumbUrl={card.hasImage ? service.cardImageUrl(card.id) : null}
            onPress={() => service.openCard(card.id, cards.map((item) => item.id))}
          />
        ))
      )}
    </BottomSheet>
  );
});

const CardDetailSheet = observer(function CardDetailSheet() {
  const service = useService(ReaderService);
  const theme = useTheme();
  const card = service.activeCard();
  const groups = service.links ? groupCardLinks(service.links) : [];
  const question = card ? (card.questions[0]?.question ?? card.concept) : '';
  const answer = card ? (card.questions[0]?.answer ?? card.example) : '';
  const visible = service.sheet?.kind === 'card';
  return (
    <BottomSheet
      visible={visible}
      title="卡片"
      onClose={() => service.closeSheet()}
      footer={
        <Pressable onPress={() => service.backToCards()}>
          <Text style={{ color: theme.colors.accentDeep, fontWeight: '600' }}>← 卡片列表</Text>
        </Pressable>
      }
    >
      {card ? (
        <>
          {card.hasImage && service.cardImageUrl(card.id) ? (
            <Image
              source={{ uri: service.cardImageUrl(card.id) ?? '' }}
              style={{ width: '100%', height: 160, borderRadius: 8 }}
              contentFit="contain"
            />
          ) : null}
          <Text style={{ color: theme.colors.ink3, fontSize: 12 }}>问</Text>
          <ClozeText text={question} />
          {answer ? (
            <>
              <Text style={{ color: theme.colors.ink3, fontSize: 12, marginTop: 8 }}>答</Text>
              <Text style={{ color: theme.colors.ink, fontSize: 14.5, lineHeight: 22 }}>{answer}</Text>
            </>
          ) : null}
          {card.acceptance === 'proposed' ? (
            <Text style={{ color: theme.colors.ink3, fontSize: 12, marginTop: 8 }}>
              {service.doc?.status === 'digested' ? '待确认' : '消化中，还不能确认'}
            </Text>
          ) : (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 }}>
              <MasteryDots level={cardMasteryLevel(card)} />
              <Text style={{ color: theme.colors.ink4, fontSize: 12 }}>{cardNextReviewLabel(card)}</Text>
            </View>
          )}
          {card.acceptance === 'proposed' && service.doc?.status === 'digested' ? (
            <View style={{ flexDirection: 'row', gap: 16, marginTop: 12 }}>
              <Pressable
                disabled={service.deciding}
                onPress={() => void service.acceptOneCard(card.id)}
              >
                <Text style={{ color: theme.colors.accentDeep, fontWeight: '700' }}>确认</Text>
              </Pressable>
              <Pressable disabled={service.deciding} onPress={() => service.beginReject(card.id)}>
                <Text style={{ color: theme.colors.ink2, fontWeight: '600' }}>有问题</Text>
              </Pressable>
            </View>
          ) : null}
          <Text style={{ color: theme.colors.ink, fontWeight: '700', marginTop: 16 }}>脉络</Text>
          {service.links === null ? (
            <Text style={{ color: theme.colors.ink3 }}>脉络加载中…</Text>
          ) : groups.length === 0 ? (
            <Text style={{ color: theme.colors.ink3 }}>还没有关联卡片。</Text>
          ) : (
            groups.map((group) => (
              <View key={group.type} style={{ gap: 8 }}>
                <Text style={{ color: theme.colors.ink3, fontSize: 12 }}>{group.label}</Text>
                {group.items.map((item) => (
                  <Pressable
                    key={item.id}
                    onPress={() => {
                      if (item.card.documentId && item.card.documentId !== service.doc?.id) {
                        router.push({
                          pathname: '/docs/[id]',
                          params: { id: item.card.documentId, anchor: item.card.id },
                        });
                        return;
                      }
                      service.openCard(item.card.id);
                    }}
                  >
                    <Text style={{ color: theme.colors.ink, fontWeight: '600' }}>{item.card.concept}</Text>
                    {item.reason ? (
                      <Text style={{ color: theme.colors.ink3, fontSize: 12 }}>{item.reason}</Text>
                    ) : null}
                  </Pressable>
                ))}
              </View>
            ))
          )}
        </>
      ) : (
        <Text>找不到这张卡。</Text>
      )}
    </BottomSheet>
  );
});

const RejectSheet = observer(function RejectSheet() {
  const service = useService(ReaderService);
  const theme = useTheme();
  const sheet = service.sheet;
  const open = sheet?.kind === 'reject';
  return (
    <BottomSheet
      visible={open}
      title="这张卡有什么问题"
      onClose={() => service.cancelReject()}
      footer={
        <>
          <Pressable onPress={() => service.cancelReject()} disabled={service.deciding}>
            <Text style={{ color: theme.colors.ink2 }}>返回</Text>
          </Pressable>
          <Pressable onPress={() => void service.submitReject()} disabled={service.deciding}>
            <Text style={{ color: theme.colors.accentDeep, fontWeight: '600' }}>
              {service.deciding ? '提交中…' : '提交'}
            </Text>
          </Pressable>
        </>
      }
    >
      <Text style={{ color: theme.colors.ink3, fontSize: 13 }}>可以不填</Text>
      <TextInput
        value={service.rejectDraft}
        onChangeText={(value) => service.setRejectDraft(value)}
        placeholder="可以不填"
        placeholderTextColor={theme.colors.ink4}
        multiline
        textAlignVertical="top"
        style={{
          minHeight: 88,
          borderWidth: 1,
          borderColor: theme.colors.line,
          borderRadius: 8,
          padding: 10,
          color: theme.colors.ink,
          backgroundColor: theme.colors.surface2,
        }}
      />
    </BottomSheet>
  );
});

const AnnotationsSheet = observer(function AnnotationsSheet() {
  const service = useService(ReaderService);
  const theme = useTheme();
  const notes = service.annotationsForSheet();
  return (
    <BottomSheet
      visible={service.sheet?.kind === 'annotations'}
      title="批注"
      onClose={() => service.closeSheet()}
    >
      {notes.length === 0 ? (
        <Text style={{ color: theme.colors.ink3 }}>这条高亮还没有批注。</Text>
      ) : (
        notes.map((item) => {
          const url = service.annotationImageUrl(item.id);
          return (
            <View
              key={item.id}
              style={{
                gap: 6,
                paddingBottom: 12,
                borderBottomWidth: StyleSheet.hairlineWidth,
                borderBottomColor: theme.colors.lineSoft,
              }}
            >
              <Text style={{ color: theme.colors.ink3, fontSize: 13 }}>{item.quote}</Text>
              {item.note ? (
                <Text style={{ color: theme.colors.ink, fontSize: 14.5 }}>{item.note}</Text>
              ) : null}
              {url ? (
                <Image source={{ uri: url }} style={{ width: '100%', height: 140, borderRadius: 8 }} contentFit="contain" />
              ) : null}
            </View>
          );
        })
      )}
    </BottomSheet>
  );
});

const AnnotateForm = observer(function AnnotateForm() {
  const service = useService(ReaderService);
  const theme = useTheme();
  const sheet = service.sheet;
  const open = sheet?.kind === 'annotate';
  const quote = sheet?.kind === 'annotate' ? sheet.anchor.text : '';
  return (
    <BottomSheet
      visible={open}
      title="划线批注"
      onClose={() => service.closeSheet()}
      footer={
        <>
          <Pressable onPress={() => service.closeSheet()}>
            <Text style={{ color: theme.colors.ink2 }}>取消</Text>
          </Pressable>
          <Pressable onPress={() => void service.saveAnnotation()}>
            <Text style={{ color: theme.colors.accentDeep, fontWeight: '600' }}>
              {service.saving ? '保存中…' : '记下'}
            </Text>
          </Pressable>
        </>
      }
    >
      <Text style={{ color: theme.colors.ink3, fontSize: 13 }}>{quote}</Text>
      <TextInput
        value={service.noteDraft}
        onChangeText={(value) => service.setNoteDraft(value)}
        placeholder="我的想法…"
        placeholderTextColor={theme.colors.ink4}
        multiline
        textAlignVertical="top"
        maxLength={20_000}
        style={{
          minHeight: 88,
          borderWidth: 1,
          borderColor: theme.colors.line,
          borderRadius: 8,
          padding: 10,
          color: theme.colors.ink,
          backgroundColor: theme.colors.surface2,
        }}
      />
    </BottomSheet>
  );
});

const CardForm = observer(function CardForm() {
  const service = useService(ReaderService);
  const theme = useTheme();
  const open = service.sheet?.kind === 'card-form';
  return (
    <BottomSheet
      visible={open}
      title="写卡片"
      onClose={() => service.closeSheet()}
      footer={
        <>
          <Pressable onPress={() => service.closeSheet()}>
            <Text style={{ color: theme.colors.ink2 }}>取消</Text>
          </Pressable>
          <Pressable onPress={() => void service.saveManualCard()}>
            <Text style={{ color: theme.colors.accentDeep, fontWeight: '600' }}>
              {service.saving ? '保存中…' : '写成卡片'}
            </Text>
          </Pressable>
        </>
      }
    >
      <Text style={{ color: theme.colors.ink2, fontSize: 13 }}>问题</Text>
      <TextInput
        value={service.cardQuestion}
        onChangeText={(value) => service.setCardQuestion(value)}
        placeholder="问题"
        placeholderTextColor={theme.colors.ink4}
        multiline
        maxLength={2000}
        style={{
          minHeight: 44,
          borderWidth: 1,
          borderColor: theme.colors.line,
          borderRadius: 8,
          padding: 10,
          color: theme.colors.ink,
          backgroundColor: theme.colors.surface2,
        }}
      />
      <Text style={{ color: theme.colors.ink2, fontSize: 13 }}>答案</Text>
      <TextInput
        value={service.cardAnswer}
        onChangeText={(value) => service.setCardAnswer(value)}
        placeholder="答案"
        placeholderTextColor={theme.colors.ink4}
        multiline
        maxLength={4000}
        style={{
          minHeight: 72,
          borderWidth: 1,
          borderColor: theme.colors.line,
          borderRadius: 8,
          padding: 10,
          color: theme.colors.ink,
          backgroundColor: theme.colors.surface2,
        }}
      />
    </BottomSheet>
  );
});

const TopicSheet = observer(function TopicSheet() {
  const service = useService(ReaderService);
  const theme = useTheme();
  return (
    <BottomSheet
      visible={service.sheet?.kind === 'topic'}
      title="挂到主题"
      onClose={() => service.closeSheet()}
    >
      <Pressable onPress={() => void service.setDocTopic(null)} style={{ paddingVertical: 10 }}>
        <Text style={{ color: theme.colors.ink }}>不指定主题</Text>
      </Pressable>
      {service.topics.map((topic) => (
        <Pressable
          key={topic.id}
          onPress={() => void service.setDocTopic(topic.id)}
          style={{ paddingVertical: 10 }}
        >
          <Text
            style={{
              color: theme.colors.ink,
              fontWeight: topic.id === service.doc?.topicId ? '700' : '400',
            }}
          >
            {topic.title}
          </Text>
        </Pressable>
      ))}
    </BottomSheet>
  );
});

function makeStyles(theme: ThemeTokens) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.colors.bg },
    head: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingHorizontal: theme.spacing[4],
      paddingVertical: 8,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.colors.lineSoft,
    },
    headBtn: { paddingVertical: 6, paddingHorizontal: 4 },
    headBtnText: { fontSize: 13.5, color: theme.colors.accentDeep, fontWeight: '600' },
    headTitle: {
      flex: 1,
      fontFamily: theme.typography.serif,
      fontSize: 17,
      fontWeight: '700',
      color: theme.colors.ink,
    },
    errorBar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 8,
      paddingHorizontal: theme.spacing[4],
      paddingVertical: 8,
      backgroundColor: theme.colors.accentSoft,
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.accentLine,
    },
    errorText: { flex: 1, color: theme.colors.accentDeep, fontSize: 13 },
    retry: { color: theme.colors.accentDeep, fontWeight: '700', fontSize: 13.5 },
    engine: { flex: 1 },
    placeholder: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
    placeholderText: { color: theme.colors.ink3, fontSize: 15 },
    primaryBtn: {
      backgroundColor: theme.colors.accent,
      borderRadius: theme.radius.sm,
      paddingHorizontal: theme.spacing[4],
      height: 34,
      alignItems: 'center',
      justifyContent: 'center',
    },
    primaryText: { color: theme.colors.onAccent, fontSize: 13.5, fontWeight: '500' },
  });
}

export default bindServices(ReaderContent, [ReaderService]);
