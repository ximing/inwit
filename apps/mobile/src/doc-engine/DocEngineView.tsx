import { observer, useService } from '@rabjs/react';
import type { PmDocJson } from '@inwit/dto';
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
} from 'react';
import { Platform, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { getDocEngineDevUrl } from '@/config';
import { ThemeService } from '@/theme';
import type {
  AnnotationAnchorInput,
  CardAnchorInput,
  DocEngineCommand,
  EntityKind,
  FormatName,
  FormatState,
  PlatformName,
  TextSelectionAnchor,
  ThemeName,
} from '../../../../packages/doc-engine/src/protocol';
import {
  emptyCommandQueue,
  enqueueCommand,
  markQueueReady,
  resetCommandQueue,
  type CommandQueueState,
} from './command-queue';
import { dispatchScript, parseDocEngineEvent } from './parse-event';

// Bundled single-file engine. Path from src/doc-engine → apps/mobile/assets.
const bundledEngineHtml = require('../../assets/doc-engine.html') as number;

export type DocEngineHandle = {
  init: (payload: { theme: ThemeName; platform: PlatformName }) => void;
  setContent: (doc: PmDocJson) => void;
  setEntities: (payload: { cards: CardAnchorInput[]; annotations: AnnotationAnchorInput[] }) => void;
  setActiveEntity: (payload: { kind: EntityKind; id: string | null }) => void;
  focusCard: (cardId: string) => void;
  injectAssetUrls: (urls: Record<string, string | null>) => void;
  setTheme: (theme: ThemeName) => void;
  setEditable: (editable: boolean) => void;
  format: (payload: { name: FormatName; href?: string; src?: string }) => void;
  getDoc: () => Promise<PmDocJson>;
  reload: () => void;
};

export type DocEngineViewProps = {
  style?: StyleProp<ViewStyle>;
  onAnchorClick?: (cardIds: string[]) => void;
  onAnnotationClick?: (annotationIds: string[]) => void;
  onSelectionChange?: (payload: {
    anchor: TextSelectionAnchor | null;
    rect: { x: number; y: number; width: number; height: number } | null;
  }) => void;
  onSelectionAction?: (payload: {
    action: 'annotate' | 'card' | 'digest';
    anchor: TextSelectionAnchor;
  }) => void;
  onAssetNeeded?: (srcs: string[]) => void;
  onLinkClick?: (href: string) => void;
  onDocChanged?: () => void;
  onFormatState?: (state: FormatState) => void;
  onError?: (payload: { message: string; stack?: string }) => void;
  onReady?: () => void;
};

const GET_DOC_TIMEOUT_MS = 4000;

type PendingDoc = {
  resolve: (doc: PmDocJson) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

function rejectPending(pending: Map<string, PendingDoc>, reason: string): void {
  for (const [id, item] of pending) {
    clearTimeout(item.timer);
    item.reject(new Error(reason));
    pending.delete(id);
  }
}

function platformName(): PlatformName {
  return Platform.OS === 'android' ? 'android' : 'ios';
}

const DocEngineViewInner = forwardRef<DocEngineHandle, DocEngineViewProps>(
  function DocEngineViewInner(props, ref) {
    const themeService = useService(ThemeService);
    const webRef = useRef<WebView>(null);
    const queueRef = useRef<CommandQueueState>(emptyCommandQueue());
    const pendingDocs = useRef<Map<string, PendingDoc>>(new Map());
    const getDocSeq = useRef(0);
    const [reloadKey, setReloadKey] = useState(0);
    const callbacks = useRef(props);
    callbacks.current = props;

    useEffect(() => {
      const pending = pendingDocs.current;
      return () => {
        rejectPending(pending, '文档引擎已关闭');
      };
    }, []);

    const pump = useCallback((cmds: DocEngineCommand[]) => {
      const web = webRef.current;
      if (!web) return;
      for (const cmd of cmds) web.injectJavaScript(dispatchScript(cmd));
    }, []);

    const send = useCallback(
      (cmd: DocEngineCommand) => {
        const next = enqueueCommand(queueRef.current, cmd);
        queueRef.current = next.state;
        if (next.flush.length > 0) pump(next.flush);
      },
      [pump],
    );

    useImperativeHandle(
      ref,
      () => ({
        init: (payload) => send({ type: 'init', payload }),
        setContent: (doc) => send({ type: 'setContent', payload: { doc } }),
        setEntities: (payload) => send({ type: 'setEntities', payload }),
        setActiveEntity: (payload) => send({ type: 'setActiveEntity', payload }),
        focusCard: (cardId) => send({ type: 'focusCard', payload: { cardId } }),
        injectAssetUrls: (urls) => send({ type: 'injectAssetUrls', payload: { urls } }),
        setTheme: (theme) => send({ type: 'setTheme', payload: { theme } }),
        setEditable: (editable) => send({ type: 'setEditable', payload: { editable } }),
        format: (payload) => send({ type: 'format', payload }),
        getDoc: () =>
          new Promise<PmDocJson>((resolve, reject) => {
            getDocSeq.current += 1;
            const requestId = `d${Date.now().toString(36)}${getDocSeq.current.toString(36)}`;
            const timer = setTimeout(() => {
              pendingDocs.current.delete(requestId);
              reject(new Error('读取正文超时'));
            }, GET_DOC_TIMEOUT_MS);
            pendingDocs.current.set(requestId, { resolve, reject, timer });
            send({ type: 'getDoc', payload: { requestId } });
          }),
        reload: () => {
          rejectPending(pendingDocs.current, '文档引擎已关闭');
          queueRef.current = resetCommandQueue();
          setReloadKey((n) => n + 1);
        },
      }),
      [send],
    );

    const theme = themeService.resolved;
    useEffect(() => {
      if (queueRef.current.ready) {
        send({ type: 'setTheme', payload: { theme } });
        return;
      }
      send({ type: 'init', payload: { theme, platform: platformName() } });
    }, [theme, send, reloadKey]);

    const onMessage = useCallback(
      (event: WebViewMessageEvent) => {
        const parsed = parseDocEngineEvent(event.nativeEvent.data);
        if (!parsed.ok) {
          console.error('[doc-engine] bad event', parsed.message);
          callbacks.current.onError?.({ message: parsed.message });
          return;
        }
        const evt = parsed.value;
        switch (evt.type) {
          case 'ready': {
            const next = markQueueReady(queueRef.current);
            queueRef.current = next.state;
            pump(next.flush);
            callbacks.current.onReady?.();
            break;
          }
          case 'error':
            console.error('[doc-engine]', evt.payload.message, evt.payload.stack);
            callbacks.current.onError?.(evt.payload);
            break;
          case 'anchorClick':
            callbacks.current.onAnchorClick?.(evt.payload.cardIds);
            break;
          case 'annotationClick':
            callbacks.current.onAnnotationClick?.(evt.payload.annotationIds);
            break;
          case 'selectionChange':
            callbacks.current.onSelectionChange?.(evt.payload);
            break;
          case 'selectionAction':
            callbacks.current.onSelectionAction?.(evt.payload);
            break;
          case 'assetNeeded':
            callbacks.current.onAssetNeeded?.(evt.payload.srcs);
            break;
          case 'linkClick':
            callbacks.current.onLinkClick?.(evt.payload.href);
            break;
          case 'docChanged':
            callbacks.current.onDocChanged?.();
            break;
          case 'docJson': {
            const pending = pendingDocs.current.get(evt.payload.requestId);
            if (!pending) break;
            clearTimeout(pending.timer);
            pendingDocs.current.delete(evt.payload.requestId);
            pending.resolve(evt.payload.doc);
            break;
          }
          case 'formatState':
            callbacks.current.onFormatState?.(evt.payload);
            break;
          default:
            break;
        }
      },
      [pump],
    );

    const source = useMemo(() => {
      const devUrl = getDocEngineDevUrl();
      if (devUrl.length > 0) return { uri: devUrl };
      return bundledEngineHtml;
    }, []);

    return (
      <WebView
        key={reloadKey}
        ref={webRef}
        source={source as ComponentProps<typeof WebView>['source']}
        style={[styles.web, props.style]}
        originWhitelist={['*']}
        javaScriptEnabled
        domStorageEnabled
        allowFileAccess
        allowFileAccessFromFileURLs
        allowUniversalAccessFromFileURLs
        mixedContentMode="always"
        setSupportMultipleWindows={false}
        nestedScrollEnabled
        hideKeyboardAccessoryView
        keyboardDisplayRequiresUserAction={false}
        onMessage={onMessage}
        onError={(event) => {
          const message = event.nativeEvent.description || 'WebView 加载失败';
          console.error('[doc-engine] webview', message);
          callbacks.current.onError?.({ message });
        }}
        onHttpError={(event) => {
          const message = `引擎 HTTP ${String(event.nativeEvent.statusCode)}`;
          console.error('[doc-engine]', message);
          callbacks.current.onError?.({ message });
        }}
      />
    );
  },
);

export const DocEngineView = observer(DocEngineViewInner);

const styles = StyleSheet.create({
  web: { flex: 1, backgroundColor: 'transparent' },
});
