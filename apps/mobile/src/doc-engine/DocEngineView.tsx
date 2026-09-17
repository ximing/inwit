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
  onError?: (payload: { message: string; stack?: string }) => void;
  onReady?: () => void;
};

function platformName(): PlatformName {
  return Platform.OS === 'android' ? 'android' : 'ios';
}

const DocEngineViewInner = forwardRef<DocEngineHandle, DocEngineViewProps>(
  function DocEngineViewInner(props, ref) {
    const themeService = useService(ThemeService);
    const webRef = useRef<WebView>(null);
    const queueRef = useRef<CommandQueueState>(emptyCommandQueue());
    const [reloadKey, setReloadKey] = useState(0);
    const callbacks = useRef(props);
    callbacks.current = props;

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
        reload: () => {
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
