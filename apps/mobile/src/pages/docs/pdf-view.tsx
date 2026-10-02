import { observer } from '@rabjs/react';
import { useCallback, useEffect, useRef, useState, type ComponentProps } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { useTheme } from '@/theme';
import {
  clipPdfQuote,
  parsePdfViewerEvent,
  pdfGoToInjection,
  pdfMarqueeInjection,
  pdfOpenInjection,
  pdfPageLabel,
  pdfPaintInjection,
  pdfThemeInjection,
  type PdfMark,
  type PdfViewerEvent,
} from './pdf-logic';

// src/pages/docs → apps/mobile/assets. Doc engine uses ../../assets from src/doc-engine.
const viewerHtml = require('../../../assets/pdf-viewer.html') as number;

export type PdfViewProps = {
  url: string | null;
  theme: 'light' | 'dark';
  marks?: readonly PdfMark[];
  jump?: { pageIndex: number; token: number } | null;
  marquee?: boolean;
  onSelection?: (payload: { text: string; pageIndex: number; quads: number[][] }) => void;
  onExcerpt?: (event: Extract<PdfViewerEvent, { type: 'excerpt' }>) => void;
  onError?: (message: string) => void;
  onLoaded?: (pageCount: number) => void;
};

export const PdfView = observer(function PdfView({
  url,
  theme,
  marks = [],
  jump = null,
  marquee = false,
  onSelection,
  onExcerpt,
  onError,
  onLoaded,
}: PdfViewProps) {
  const tokens = useTheme();
  const webRef = useRef<WebView>(null);
  const readyRef = useRef(false);
  const urlRef = useRef(url);
  const themeRef = useRef(theme);
  const marksRef = useRef(marks);
  const jumpRef = useRef(jump);
  const marqueeRef = useRef(marquee);
  const callbacks = useRef({ onSelection, onExcerpt, onError, onLoaded });
  const [pageIndex, setPageIndex] = useState(0);
  const [pageCount, setPageCount] = useState(0);

  urlRef.current = url;
  themeRef.current = theme;
  marksRef.current = marks;
  jumpRef.current = jump;
  marqueeRef.current = marquee;
  callbacks.current = { onSelection, onExcerpt, onError, onLoaded };

  const inject = useCallback((script: string) => {
    webRef.current?.injectJavaScript(script);
  }, []);

  const flushPending = useCallback(() => {
    inject(pdfThemeInjection(themeRef.current));
    inject(pdfPaintInjection(marksRef.current));
    inject(pdfMarqueeInjection(marqueeRef.current));
    const pendingJump = jumpRef.current;
    if (pendingJump) inject(pdfGoToInjection(pendingJump.pageIndex));
    const next = urlRef.current;
    if (next) inject(pdfOpenInjection(next));
  }, [inject]);

  useEffect(() => {
    setPageIndex(0);
    setPageCount(0);
    if (!url) readyRef.current = false;
  }, [url]);

  useEffect(() => {
    if (!url || !readyRef.current) return;
    inject(pdfOpenInjection(url));
  }, [url, inject]);

  useEffect(() => {
    if (!readyRef.current) return;
    inject(pdfThemeInjection(theme));
  }, [theme, inject]);

  useEffect(() => {
    if (!readyRef.current) return;
    inject(pdfPaintInjection(marks));
  }, [marks, inject]);

  useEffect(() => {
    if (!readyRef.current || !jump) return;
    inject(pdfGoToInjection(jump.pageIndex));
  }, [jump, inject]);

  useEffect(() => {
    if (!readyRef.current) return;
    inject(pdfMarqueeInjection(marquee));
  }, [marquee, inject]);

  const onMessage = useCallback(
    (event: WebViewMessageEvent) => {
      const parsed = parsePdfViewerEvent(event.nativeEvent.data);
      if (!parsed.ok) {
        console.warn('[pdf-view]', parsed.message);
        return;
      }
      const message = parsed.value;
      switch (message.type) {
        case 'ready':
          readyRef.current = true;
          flushPending();
          break;
        case 'loaded':
          setPageCount(message.pageCount);
          setPageIndex(0);
          callbacks.current.onLoaded?.(message.pageCount);
          inject(pdfPaintInjection(marksRef.current));
          if (jumpRef.current) inject(pdfGoToInjection(jumpRef.current.pageIndex));
          inject(pdfMarqueeInjection(marqueeRef.current));
          break;
        case 'page':
          setPageIndex(message.pageIndex);
          break;
        case 'selection':
          callbacks.current.onSelection?.({
            text: clipPdfQuote(message.text),
            pageIndex: message.pageIndex,
            quads: message.quads,
          });
          break;
        case 'excerpt':
          callbacks.current.onExcerpt?.(message);
          break;
        case 'error':
          callbacks.current.onError?.(message.message);
          break;
        default:
          break;
      }
    },
    [flushPending],
  );

  const label = pdfPageLabel(pageIndex, pageCount);
  const canvasBg = theme === 'dark' ? '#1c1915' : '#f6f3ec';

  if (!url) {
    return (
      <View style={[styles.center, { backgroundColor: tokens.colors.bg }]}>
        <Text style={[styles.placeholder, { color: tokens.colors.ink3, fontFamily: tokens.typography.sans }]}>
          正在获取 PDF…
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.fill, { backgroundColor: canvasBg }]}>
      <WebView
        ref={webRef}
        source={viewerHtml as unknown as ComponentProps<typeof WebView>['source']}
        style={[styles.web, { backgroundColor: canvasBg }]}
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
        textZoom={100}
        onMessage={onMessage}
        onError={(event) => {
          const message = event.nativeEvent.description || 'PDF 视图加载失败';
          callbacks.current.onError?.(message);
        }}
      />
      {label ? (
        <View
          pointerEvents="none"
          style={[styles.chip, { backgroundColor: tokens.colors.ink }]}
        >
          <Text
            style={[
              styles.chipText,
              { color: tokens.colors.bg, fontFamily: tokens.typography.sans },
            ]}
          >
            {label}
          </Text>
        </View>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  placeholder: { fontSize: 15 },
  web: { flex: 1 },
  chip: {
    position: 'absolute',
    alignSelf: 'center',
    bottom: 18,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  chipText: { fontSize: 12, fontVariant: ['tabular-nums'] },
});
