import { docDisplayTitle, type Annotation, type DocumentCard } from '@inwit/dto';
import { bindServices, observer, useService } from '@rabjs/react';
import * as Clipboard from 'expo-clipboard';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Dimensions,
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { BottomSheet } from '@/components/bottom-sheet';
import { ClozeText, MasteryDots, MiniCard, cardMasteryLevel, cardNextReviewLabel } from '@/components/mini-card';
import { DocEngineView, type DocEngineHandle } from '@/doc-engine/DocEngineView';
import { useDocEngineAssets } from '@/doc-engine/useDocEngineAssets';
import { groupCardLinks } from '@/lib/card-copy';
import { mapAppHref } from '@/lib/internal-links';
import { ROUTES } from '@/routes';
import { ThemeService, useTheme, type ThemeTokens } from '@/theme';
import type { FormatName, FormatState, TextSelectionAnchor } from '../../../../../packages/doc-engine/src/protocol';
import { PdfView } from './pdf-view';
import { ReaderService } from './reader.service';

function useKeyboardOverlap(): number {
  const [overlap, setOverlap] = useState(0);
  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const show = Keyboard.addListener(showEvent, (event) => {
      const windowHeight = Dimensions.get('window').height;
      setOverlap(Math.max(0, Math.round(windowHeight - event.endCoordinates.screenY)));
    });
    const hide = Keyboard.addListener(hideEvent, () => setOverlap(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return overlap;
}

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
  const params = useLocalSearchParams<{ id: string; anchor?: string | string[]; edit?: string | string[] }>();
  const id = typeof params.id === 'string' ? params.id : '';
  const anchorParam = Array.isArray(params.anchor) ? params.anchor[0] : params.anchor;
  const editParam = Array.isArray(params.edit) ? params.edit[0] : params.edit;
  const engineRef = useRef<DocEngineHandle>(null);
  const appliedEditable = useRef(false);
  const leaving = useRef(false);
  const navigation = useNavigation();
  const onAssetNeeded = useDocEngineAssets(engineRef);
  const insets = useSafeAreaInsets();
  const keyboardOverlap = useKeyboardOverlap();

  useEffect(() => {
    service.setDocGetter(async () => {
      const engine = engineRef.current;
      if (!engine) throw new Error('文档引擎还没准备好');
      return engine.getDoc();
    });
    service.setFocused(true);
    if (id) void service.load(id, anchorParam ?? null, editParam === '1');
    return () => {
      service.setFocused(false);
      service.setDocGetter(null);
    };
  }, [service, id, anchorParam, editParam]);

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
    appliedEditable.current = false;
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
    if (service.editing) return;
    if (payload.action === 'annotate') service.beginAnnotate(payload.anchor);
    else if (payload.action === 'card') service.beginCardForm(payload.anchor);
    else void service.queueDigest(payload.anchor);
  };

  const captureBody = async () => {
    const engine = engineRef.current;
    if (!engine || (!service.editing && !service.editorLive && !service.dirty)) return;
    try {
      const seq = service.nextBodyRead();
      service.noteJson(await engine.getDoc(), seq);
    } catch {
      // flushSave keeps the last draft that did arrive.
    }
  };

  const goBack = () => {
    if (leaving.current) return;
    leaving.current = true;
    void (async () => {
      await captureBody();
      await service.flushSave();
      if (service.saveState === 'error') {
        leaving.current = false;
        return;
      }
      if (router.canGoBack()) router.back();
      else router.replace(ROUTES.docs);
    })();
  };

  const enterEdit = () => {
    if (!service.canEdit) return;
    service.setEditing(true);
  };

  const leaveEdit = () => {
    void (async () => {
      await captureBody();
      await service.flushSave();
      if (service.saveState === 'error') return;
      service.setEditing(false);
    })();
  };

  useEffect(() => {
    const sub = navigation.addListener('beforeRemove', (event) => {
      if (leaving.current) return;
      if (!service.editing && !service.dirty && !service.editorLive) return;
      event.preventDefault();
      leaving.current = true;
      void (async () => {
        await captureBody();
        await service.flushSave();
        if (service.saveState === 'error') {
          leaving.current = false;
          return;
        }
        navigation.dispatch(event.data.action);
      })();
    });
    return () => sub();
  }, [navigation, service]);

  const trashDoc = () => {
    void (async () => {
      const ok = await service.trashDocument();
      if (!ok) return;
      leaving.current = true;
      if (router.canGoBack()) router.back();
      else router.replace(ROUTES.docs);
    })();
  };

  const pickEditorImage = () => {
    service.closeSheet();
    void (async () => {
      try {
        const result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['images'],
          quality: 0.85,
        });
        if (result.canceled) return;
        const asset = result.assets[0];
        if (!asset) return;
        const src = await service.uploadEditorImage({
          uri: asset.uri,
          mimeType: asset.mimeType ?? null,
          fileSize: asset.fileSize ?? null,
        });
        if (!src) return;
        engineRef.current?.format({ name: 'image', src });
      } catch {
        service.showToast('图片没传上');
      }
    })();
  };

  const confirmLink = () => {
    const href = service.linkDraft.trim();
    engineRef.current?.format(href ? { name: 'link', href } : { name: 'unsetLink' });
    service.closeSheet();
  };

  const retryEngine = () => {
    service.setEngineError(null);
    engineRef.current?.reload();
  };

  const doc = service.doc;
  const title = doc ? docDisplayTitle(doc) : '文档';
  const showEngine = Boolean(doc && !service.isPdf && !service.docError && (!service.isBlank || service.editing));

  useEffect(() => {
    if (!service.engineReady) return;
    const next = service.editing && showEngine;
    if (appliedEditable.current === next) return;
    appliedEditable.current = next;
    engineRef.current?.setEditable(next);
  }, [service, service.engineReady, service.editing, service.contentGen, showEngine]);
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
          : doc && service.isBlank
              ? '这张纸还是空的'
              : null);

  const bottomGap = service.editing && keyboardOverlap > 0 ? keyboardOverlap : insets.bottom;

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.head}>
        <View style={styles.headRow}>
          <Pressable onPress={goBack} hitSlop={8} style={styles.headBtn}>
            <Text style={styles.headBtnText}>← 返回</Text>
          </Pressable>
          {service.editing ? (
            <TextInput
              value={service.draftTitle}
              onChangeText={(value) => service.noteTitle(value)}
              placeholder="无标题"
              placeholderTextColor={theme.colors.ink4}
              style={styles.headTitleInput}
              returnKeyType="done"
            />
          ) : (
            <Text style={styles.headTitle} numberOfLines={1}>
              {title}
            </Text>
          )}
          <Pressable
            onPress={() => service.openMore()}
            hitSlop={8}
            style={styles.headBtn}
            accessibilityLabel="更多"
          >
            <Text style={styles.moreMark}>···</Text>
          </Pressable>
        </View>
        {service.canEdit ? (
          <View style={styles.modeRow}>
            <View style={styles.segment}>
              <Pressable
                accessibilityRole="tab"
                accessibilityState={{ selected: !service.editing }}
                onPress={leaveEdit}
                style={[styles.segmentBtn, !service.editing && styles.segmentOn]}
              >
                <Text style={[styles.segmentText, !service.editing && styles.segmentTextOn]}>阅读</Text>
              </Pressable>
              <Pressable
                accessibilityRole="tab"
                accessibilityState={{ selected: service.editing }}
                onPress={enterEdit}
                style={[styles.segmentBtn, service.editing && styles.segmentOn]}
              >
                <Text style={[styles.segmentText, service.editing && styles.segmentTextOn]}>编辑</Text>
              </Pressable>
            </View>
            <Text style={styles.saveLabel} numberOfLines={2}>
              {service.saveLabel}
            </Text>
          </View>
        ) : null}
      </View>
      {service.canConfirmCards ? (
        <Pressable
          onPress={() => void service.acceptAllProposed()}
          disabled={service.deciding}
          style={styles.confirmBanner}
        >
          <Text style={styles.confirmText}>{service.deciding ? '确认中…' : '全部确认'}</Text>
        </Pressable>
      ) : null}

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
          onDocChanged={() => {
            service.markEditorLive();
            const engine = engineRef.current;
            if (!engine) return;
            const seq = service.nextBodyRead();
            void engine.getDoc().then((json) => service.noteJson(json, seq)).catch(() => undefined);
          }}
          onFormatState={(state) => service.noteFormatState(state)}
        />
      ) : service.isPdf && doc ? (
        <View style={styles.engine}>
          {service.pdfError ? (
            <View style={styles.placeholder}>
              <Text style={styles.placeholderText}>{service.pdfError}</Text>
              <Pressable onPress={() => void service.loadPdf()} style={styles.primaryBtn}>
                <Text style={styles.primaryText}>重试</Text>
              </Pressable>
            </View>
          ) : (
            <PdfView
              url={service.pdfUrl}
              theme={themeService.resolved}
              onSelection={(payload) => service.setPdfSelection(payload.text, payload.pageIndex)}
              onError={(message) => service.setPdfError(message)}
            />
          )}
          {service.pdfSelection && service.sheet == null ? (
            <View style={styles.formatBar}>
              <Pressable onPress={() => service.beginPdfAnnotate()} style={styles.formatBtn}>
                <Text style={styles.formatLabel}>批注</Text>
              </Pressable>
              <Pressable onPress={() => service.beginPdfCard()} style={styles.formatBtn}>
                <Text style={styles.formatLabel}>写卡</Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  const text = service.pdfSelection?.text;
                  if (!text) return;
                  void Clipboard.setStringAsync(text).then(() => {
                    service.clearPdfSelection();
                    service.showToast('已复制');
                  });
                }}
                style={styles.formatBtn}
              >
                <Text style={styles.formatLabel}>复制</Text>
              </Pressable>
              <Pressable onPress={() => service.clearPdfSelection()} style={styles.formatBtn}>
                <Text style={styles.formatLabel}>取消</Text>
              </Pressable>
            </View>
          ) : null}
        </View>
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

      {service.editing && showEngine ? (
        <FormatBar state={service.formatState} onFormat={(name) => engineRef.current?.format({ name })} onMore={() => service.openFormatMenu()} />
      ) : null}
      <View style={{ height: bottomGap }} />

      <CardsSheet />
      <CardDetailSheet />
      <CardEditSheet />
      <RejectSheet />
      <AnnotationsSheet />
      <AnnotateForm />
      <CardForm />
      <TopicSheet />
      <MoreSheet onTrash={trashDoc} />
      <FormatMenu onFormat={(name) => engineRef.current?.format({ name })} onPickImage={pickEditorImage} />
      <LinkSheet onConfirm={confirmLink} />
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
          {card.acceptance !== 'proposed' ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 16, marginTop: 12 }}>
              <Pressable disabled={service.cardBusy} onPress={() => service.beginCardEdit(card.id)}>
                <Text style={{ color: theme.colors.accentDeep, fontWeight: '700' }}>编辑</Text>
              </Pressable>
              <Pressable disabled={service.cardBusy} onPress={() => void service.archiveDocCard(card.id)}>
                <Text style={{ color: theme.colors.ink2, fontWeight: '600' }}>移入回收站</Text>
              </Pressable>
              {card.review ? (
                <Pressable disabled={service.cardBusy} onPress={() => void service.toggleCardSuspended(card.id)}>
                  <Text style={{ color: theme.colors.ink2, fontWeight: '600' }}>
                    {card.review.suspendedAt ? '恢复复习' : '已熟悉，不复习'}
                  </Text>
                </Pressable>
              ) : null}
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
  const [editingId, setEditingId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState('');
  const open = service.sheet?.kind === 'annotations';
  useEffect(() => {
    if (!open) setEditingId(null);
  }, [open]);
  return (
    <BottomSheet
      visible={open}
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
              {editingId === item.id ? (
                <TextInput
                  value={noteDraft}
                  onChangeText={setNoteDraft}
                  placeholder="我的想法…"
                  placeholderTextColor={theme.colors.ink4}
                  multiline
                  textAlignVertical="top"
                  maxLength={20_000}
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
              ) : item.note ? (
                <Text style={{ color: theme.colors.ink, fontSize: 14.5 }}>{item.note}</Text>
              ) : null}
              <View style={{ flexDirection: 'row', gap: 16 }}>
                {editingId === item.id ? (
                  <>
                    <Pressable
                      onPress={() => {
                        void (async () => {
                          const ok = await service.saveAnnotationNote(item.id, noteDraft);
                          if (ok) setEditingId(null);
                        })();
                      }}
                    >
                      <Text style={{ color: theme.colors.accentDeep, fontWeight: '700' }}>
                        {service.saving ? '保存中…' : '保存'}
                      </Text>
                    </Pressable>
                    <Pressable onPress={() => setEditingId(null)}>
                      <Text style={{ color: theme.colors.ink2 }}>取消</Text>
                    </Pressable>
                  </>
                ) : (
                  <>
                    <Pressable
                      onPress={() => {
                        setEditingId(item.id);
                        setNoteDraft(item.note ?? '');
                      }}
                    >
                      <Text style={{ color: theme.colors.accentDeep, fontWeight: '700' }}>编辑</Text>
                    </Pressable>
                    <Pressable onPress={() => void service.deleteAnnotationNote(item.id)}>
                      <Text style={{ color: theme.colors.ink2, fontWeight: '600' }}>删除</Text>
                    </Pressable>
                  </>
                )}
              </View>
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

const BAR_ACTIONS: { name: FormatName; label: string; active: (state: FormatState) => boolean }[] = [
  { name: 'bold', label: '粗体', active: (state) => state.bold },
  { name: 'italic', label: '斜体', active: (state) => state.italic },
  { name: 'strike', label: '删除线', active: (state) => state.strike },
  { name: 'bulletList', label: '列表', active: (state) => state.bulletList },
  { name: 'heading2', label: '标题', active: (state) => state.heading2 },
];

const MENU_ACTIONS: {
  name: FormatName;
  label: string;
  active?: (state: FormatState) => boolean;
  disabled?: (state: FormatState | null) => boolean;
}[] = [
  { name: 'heading1', label: '标题 1', active: (state) => state.heading1 },
  { name: 'heading2', label: '标题 2', active: (state) => state.heading2 },
  { name: 'orderedList', label: '有序列表', active: (state) => state.orderedList },
  { name: 'taskList', label: '任务列表', active: (state) => state.taskList },
  { name: 'blockquote', label: '引用', active: (state) => state.blockquote },
  { name: 'codeBlock', label: '代码', active: (state) => state.codeBlock },
  { name: 'alignLeft', label: '左对齐', active: (state) => state.textAlign === 'left' },
  { name: 'alignCenter', label: '居中', active: (state) => state.textAlign === 'center' },
  { name: 'alignRight', label: '右对齐', active: (state) => state.textAlign === 'right' },
  { name: 'link', label: '链接', active: (state) => state.link },
  { name: 'image', label: '图片' },
  { name: 'horizontalRule', label: '分割线' },
  { name: 'table', label: '表格', active: (state) => state.table },
  { name: 'undo', label: '撤销', disabled: (state) => !state?.canUndo },
  { name: 'redo', label: '重做', disabled: (state) => !state?.canRedo },
];

function FormatBar({
  state,
  onFormat,
  onMore,
}: {
  state: FormatState | null;
  onFormat: (name: FormatName) => void;
  onMore: () => void;
}) {
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  return (
    <View style={styles.formatBar}>
      {BAR_ACTIONS.map((item) => {
        const on = state ? item.active(state) : false;
        return (
          <Pressable key={item.name} onPress={() => onFormat(item.name)} style={styles.formatBtn}>
            <Text style={[styles.formatLabel, on && styles.formatLabelOn]}>{item.label}</Text>
          </Pressable>
        );
      })}
      <Pressable onPress={onMore} style={styles.formatBtn}>
        <Text style={styles.formatLabel}>更多</Text>
      </Pressable>
    </View>
  );
}

const FormatMenu = observer(function FormatMenu({
  onFormat,
  onPickImage,
}: {
  onFormat: (name: FormatName) => void;
  onPickImage: () => void;
}) {
  const service = useService(ReaderService);
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const state = service.formatState;
  return (
    <BottomSheet visible={service.sheet?.kind === 'format'} title="格式" onClose={() => service.closeSheet()}>
      <View style={styles.formatGrid}>
        {MENU_ACTIONS.map((item) => {
          const disabled = item.disabled?.(state) ?? false;
          const on = state && item.active ? item.active(state) : false;
          return (
            <View key={item.name} style={styles.formatCellWrap}>
              <Pressable
                disabled={disabled}
                onPress={() => {
                  if (item.name === 'link') {
                    service.openLinkSheet();
                    return;
                  }
                  if (item.name === 'image') {
                    onPickImage();
                    return;
                  }
                  onFormat(item.name);
                }}
                style={[styles.formatCell, disabled && styles.formatCellOff]}
              >
                <Text style={[styles.formatLabel, on && styles.formatLabelOn, disabled && styles.formatLabelOff]}>
                  {item.label}
                </Text>
              </Pressable>
            </View>
          );
        })}
      </View>
    </BottomSheet>
  );
});

const LinkSheet = observer(function LinkSheet({ onConfirm }: { onConfirm: () => void }) {
  const service = useService(ReaderService);
  const theme = useTheme();
  return (
    <BottomSheet
      visible={service.sheet?.kind === 'link'}
      title="链接"
      onClose={() => service.closeSheet()}
      footer={
        <Pressable onPress={onConfirm}>
          <Text style={{ color: theme.colors.accentDeep, fontWeight: '700' }}>确定</Text>
        </Pressable>
      }
    >
      <TextInput
        value={service.linkDraft}
        onChangeText={(value) => service.setLinkDraft(value)}
        placeholder="https://"
        placeholderTextColor={theme.colors.ink4}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        style={{
          minHeight: 44,
          borderWidth: 1,
          borderColor: theme.colors.line,
          borderRadius: 8,
          paddingHorizontal: 10,
          color: theme.colors.ink,
          backgroundColor: theme.colors.surface2,
        }}
      />
    </BottomSheet>
  );
});

const MoreSheet = observer(function MoreSheet({ onTrash }: { onTrash: () => void }) {
  const service = useService(ReaderService);
  const themeService = useService(ThemeService);
  const theme = useTheme();
  return (
    <BottomSheet visible={service.sheet?.kind === 'more'} title="更多" onClose={() => service.closeSheet()}>
      <Pressable
        disabled={!service.doc}
        onPress={() => service.openTopicMenu()}
        style={{ paddingVertical: 12, minHeight: 44, justifyContent: 'center' }}
      >
        <Text style={{ color: service.doc ? theme.colors.ink : theme.colors.ink4, fontSize: 16 }}>更换主题</Text>
      </Pressable>
      <Pressable
        onPress={() => themeService.toggleLightDark()}
        style={{ paddingVertical: 12, minHeight: 44, justifyContent: 'center' }}
      >
        <Text style={{ color: theme.colors.ink, fontSize: 16 }}>
          {themeService.resolved === 'dark' ? '浅色' : '深色'}
        </Text>
      </Pressable>
      {service.doc && !service.isPdf ? (
        <Pressable onPress={onTrash} style={{ paddingVertical: 12, minHeight: 44, justifyContent: 'center' }}>
          <Text style={{ color: theme.colors.accentDeep, fontSize: 16 }}>移入回收站</Text>
        </Pressable>
      ) : null}
    </BottomSheet>
  );
});

const CardEditSheet = observer(function CardEditSheet() {
  const service = useService(ReaderService);
  const theme = useTheme();
  const open = service.sheet?.kind === 'card-edit';
  return (
    <BottomSheet
      visible={open}
      title="编辑卡片"
      onClose={() => service.closeCardEdit()}
      footer={
        <>
          <Pressable onPress={() => service.closeCardEdit()} disabled={service.cardBusy}>
            <Text style={{ color: theme.colors.ink2 }}>取消</Text>
          </Pressable>
          <Pressable onPress={() => void service.saveCardEdit()} disabled={service.cardBusy}>
            <Text style={{ color: theme.colors.accentDeep, fontWeight: '700' }}>
              {service.cardBusy ? '保存中…' : '保存'}
            </Text>
          </Pressable>
        </>
      }
    >
      <Text style={{ color: theme.colors.ink2, fontSize: 13 }}>问</Text>
      <TextInput
        value={service.cardEditQuestion}
        onChangeText={(value) => service.setCardEditQuestion(value)}
        placeholder="问"
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
      <Text style={{ color: theme.colors.ink2, fontSize: 13 }}>答</Text>
      <TextInput
        value={service.cardEditAnswer}
        onChangeText={(value) => service.setCardEditAnswer(value)}
        placeholder="答"
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

function makeStyles(theme: ThemeTokens) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.colors.bg },
    head: {
      gap: 4,
      paddingHorizontal: theme.spacing[4],
      paddingVertical: 8,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.colors.lineSoft,
    },
    headRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    headBtn: { paddingVertical: 6, paddingHorizontal: 4, minHeight: 44, justifyContent: 'center' },
    headBtnText: { fontSize: 13.5, color: theme.colors.accentDeep, fontWeight: '600' },
    moreMark: { fontSize: 18, color: theme.colors.ink2, fontWeight: '700', letterSpacing: 1 },
    headTitle: {
      flex: 1,
      fontFamily: theme.typography.serif,
      fontSize: 17,
      fontWeight: '700',
      color: theme.colors.ink,
    },
    headTitleInput: {
      flex: 1,
      fontFamily: theme.typography.serif,
      fontSize: 17,
      fontWeight: '700',
      color: theme.colors.ink,
      paddingVertical: 4,
      paddingHorizontal: 0,
    },
    modeRow: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 36 },
    segment: {
      flexDirection: 'row',
      borderRadius: theme.radius.sm,
      backgroundColor: theme.colors.surface2,
      padding: 2,
    },
    segmentBtn: {
      minHeight: 32,
      paddingHorizontal: 12,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 6,
    },
    segmentOn: { backgroundColor: theme.colors.surface },
    segmentText: { fontSize: 13, color: theme.colors.ink3, fontWeight: '600' },
    segmentTextOn: { color: theme.colors.accent },
    saveLabel: { flex: 1, textAlign: 'right', color: theme.colors.ink3, fontSize: 12 },
    confirmBanner: {
      paddingVertical: 8,
      paddingHorizontal: theme.spacing[4],
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.colors.lineSoft,
      backgroundColor: theme.colors.accentSoft,
    },
    confirmText: { color: theme.colors.accentDeep, fontSize: 13.5, fontWeight: '700' },
    formatBar: {
      flexDirection: 'row',
      alignItems: 'stretch',
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.colors.line,
      backgroundColor: theme.colors.surface,
    },
    formatBtn: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 2 },
    formatLabel: { fontSize: 12, color: theme.colors.ink2, fontWeight: '600' },
    formatLabelOn: { color: theme.colors.accent },
    formatLabelOff: { color: theme.colors.ink4 },
    formatGrid: { flexDirection: 'row', flexWrap: 'wrap' },
    formatCellWrap: { width: '33.33%', padding: 4 },
    formatCell: {
      minHeight: 44,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: theme.radius.sm,
      backgroundColor: theme.colors.surface2,
    },
    formatCellOff: { opacity: 0.45 },
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
