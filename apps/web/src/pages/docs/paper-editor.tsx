import type { Annotation, DocumentCard } from '@inwit/dto';
import { observer, useService } from '@rabjs/react';
import type { Editor } from '@tiptap/react';
import { EditorContent, useEditor } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import {
  completeAssetMultipart,
  importAsset,
  initAssetMultipart,
  presignAsset,
  signAssetMultipart,
} from '@/api/assets';
import { createDocExtensions } from '@/components/doc/extensions';
import { docEntities } from '@/lib/anchors';
import {
  createDocEditorHost,
  ensureEntityMarksOnEditor,
  stripEntityMarksFromSlice,
  type DocEditorHost,
} from '@/lib/entity-marks';
import { asPmJson, clonePmJson } from '@/lib/pm-doc';
import { AssetUrlsService } from '@/services/asset-urls.service';
import { DialogService } from '@/services/dialog.service';
import { AnchorHighlight } from './anchor-highlight';
import { fetchMediaAsFile, filesFromDataTransfer } from './paste-media';
import {
  decidePasteAction,
  needsRehostSrc,
  rehostMediaSrc,
  rehostPastedHtml,
} from './paste-media-logic';
import { PaperToolbar, SelectionFormatBar } from './paper-toolbar';
import {
  AssetUploadError,
  classifyAssetFile,
  ingestAssetFiles,
  putViaFetch,
  storeDocAsset,
  UPLOAD_FAILED_MESSAGE,
  type UploadDocAssetApi,
} from './upload-asset';

const NEW_DOC_JSON = {
  type: 'doc',
  content: [{ type: 'paragraph' }],
};

const IMAGE_ACCEPT = 'image/jpeg,image/png,image/webp,image/gif';
const VIDEO_ACCEPT = 'video/mp4,video/webm,video/quicktime';

const assetApi: UploadDocAssetApi = {
  presign: presignAsset,
  initMultipart: initAssetMultipart,
  signMultipart: signAssetMultipart,
  completeMultipart: completeAssetMultipart,
  put: putViaFetch,
};

function contentFromSeed(seedDoc: unknown | null) {
  if (seedDoc === null) return NEW_DOC_JSON;
  const json = asPmJson(seedDoc);
  const content = json.content;
  if (!Array.isArray(content) || content.length === 0) return NEW_DOC_JSON;
  return json;
}

type PaperEditorProps = {
  seedKey: string;
  seedDoc: unknown | null;
  documentId?: string | null;
  cards?: DocumentCard[];
  annotations?: Annotation[];
  activeCardId?: string | null;
  activeAnnotationId?: string | null;
  onChange: (json: ReturnType<typeof asPmJson>) => void;
  onSave: () => void;
  onAnchorClick?: (cardIds: string[]) => void;
  onAnnotationClick?: (ids: string[]) => void;
  bindHost?: (host: DocEditorHost | null) => void;
};

export const PaperEditor = observer(function PaperEditor({
  seedKey,
  seedDoc,
  documentId = null,
  cards = [],
  annotations = [],
  activeCardId = null,
  activeAnnotationId = null,
  onChange,
  onSave,
  onAnchorClick,
  onAnnotationClick,
  bindHost,
}: PaperEditorProps) {
  const assetUrls = useService(AssetUrlsService);
  const dialog = useService(DialogService);
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  const onAnchorClickRef = useRef(onAnchorClick);
  const onAnnotationClickRef = useRef(onAnnotationClick);
  const entities = useMemo(() => docEntities(cards, annotations), [cards, annotations]);
  const entitiesRef = useRef(entities);
  const cardsRef = useRef(cards);
  const annotationsRef = useRef(annotations);
  const activeCardIdRef = useRef(activeCardId);
  const activeAnnotationIdRef = useRef(activeAnnotationId);
  const editorRef = useRef<Editor | null>(null);
  const ingestRef = useRef<(files: FileList | File[]) => Promise<void>>(async () => undefined);
  const pasteRef = useRef<(dt: DataTransfer, insertAt: number) => boolean>(() => false);
  const rehostRef = useRef<() => Promise<void>>(async () => undefined);
  const uploadingRef = useRef(false);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  onChangeRef.current = onChange;
  onSaveRef.current = onSave;
  onAnchorClickRef.current = onAnchorClick;
  onAnnotationClickRef.current = onAnnotationClick;
  entitiesRef.current = entities;
  cardsRef.current = cards;
  annotationsRef.current = annotations;
  activeCardIdRef.current = activeCardId;
  activeAnnotationIdRef.current = activeAnnotationId;
  const [uploading, setUploading] = useState(false);
  const [uploadNotice, setUploadNotice] = useState<{ text: string; error: boolean } | null>(null);

  const ingestFiles = useCallback(
    async (files: FileList | File[]) => {
      const instance = editorRef.current;
      const list = Array.from(files);
      if (!instance || uploadingRef.current || list.length === 0) return;
      uploadingRef.current = true;
      setUploading(true);
      setUploadNotice({ text: '上传中…', error: false });
      try {
        await ingestAssetFiles(list, assetApi, {
          insertImage: (src, alt) => {
            instance.chain().focus().setImage({ src, alt }).run();
          },
          insertVideo: (src, mime) => {
            instance.chain().focus().insertContent({ type: 'video', attrs: { src, mime } }).run();
          },
          ensure: (srcs) => assetUrls.ensure(srcs),
        });
        setUploadNotice(null);
      } catch (err) {
        const invalid = err instanceof AssetUploadError && err.code === 'invalid';
        setUploadNotice({
          text: invalid ? err.message : UPLOAD_FAILED_MESSAGE,
          error: true,
        });
        console.error(err);
      } finally {
        uploadingRef.current = false;
        setUploading(false);
      }
    },
    [assetUrls],
  );
  ingestRef.current = ingestFiles;

  const rehostDeps = useMemo(
    () => ({
      storeFile: async (file: File) => (await storeDocAsset(file, assetApi)).assetSrc,
      fetchSrc: fetchMediaAsFile,
      importUrl: async (url: string) => (await importAsset({ url })).assetSrc,
    }),
    [],
  );

  const ingestPastedHtml = useCallback(
    async (html: string, files: File[], insertAt: number) => {
      const instance = editorRef.current;
      if (!instance || uploadingRef.current) return;
      const extra = files.filter((file) => classifyAssetFile(file).ok);
      uploadingRef.current = true;
      setUploading(true);
      setUploadNotice({ text: '上传中…', error: false });
      try {
        const result = await rehostPastedHtml(html, extra, rehostDeps);
        if (result.assetSrcs.length > 0) await assetUrls.ensure(result.assetSrcs);
        instance.chain().focus().insertContentAt(insertAt, result.html).run();
        if (result.failed.length > 0) {
          setUploadNotice({ text: '部分图片或视频未能转存', error: true });
        } else {
          setUploadNotice(null);
        }
      } catch (err) {
        const invalid = err instanceof AssetUploadError && err.code === 'invalid';
        setUploadNotice({
          text: invalid ? err.message : UPLOAD_FAILED_MESSAGE,
          error: true,
        });
        console.error(err);
      } finally {
        uploadingRef.current = false;
        setUploading(false);
      }
    },
    [assetUrls, rehostDeps],
  );

  const rehostExternalInEditor = useCallback(async () => {
    const instance = editorRef.current;
    if (!instance || uploadingRef.current) return;
    const srcs: string[] = [];
    instance.state.doc.descendants((node) => {
      if (node.type.name !== 'image' && node.type.name !== 'video') return;
      const src = typeof node.attrs.src === 'string' ? node.attrs.src : '';
      if (needsRehostSrc(src)) srcs.push(src);
    });
    const unique = [...new Set(srcs)];
    if (unique.length === 0) return;
    uploadingRef.current = true;
    setUploading(true);
    setUploadNotice({ text: '上传中…', error: false });
    try {
      const map = new Map<string, string>();
      const failed: string[] = [];
      for (const src of unique) {
        const assetSrc = await rehostMediaSrc(src, () => null, rehostDeps);
        if (assetSrc) map.set(src, assetSrc);
        else failed.push(src);
      }
      if (map.size > 0) {
        const { tr } = instance.state;
        instance.state.doc.descendants((node, pos) => {
          if (node.type.name !== 'image' && node.type.name !== 'video') return;
          const src = typeof node.attrs.src === 'string' ? node.attrs.src : '';
          const next = map.get(src);
          if (next) tr.setNodeMarkup(pos, undefined, { ...node.attrs, src: next });
        });
        instance.view.dispatch(tr);
        await assetUrls.ensure([...map.values()]);
      }
      if (failed.length > 0) {
        setUploadNotice({ text: '部分图片或视频未能转存', error: true });
      } else {
        setUploadNotice(null);
      }
    } catch (err) {
      setUploadNotice({ text: UPLOAD_FAILED_MESSAGE, error: true });
      console.error(err);
    } finally {
      uploadingRef.current = false;
      setUploading(false);
    }
  }, [assetUrls, rehostDeps]);

  pasteRef.current = (dt, insertAt) => {
    const html = dt.getData('text/html') ?? '';
    const files = filesFromDataTransfer(dt);
    const action = decidePasteAction(html, files.length);
    if (action === 'rehost-html') {
      void ingestPastedHtml(html, files, insertAt);
      return true;
    }
    if (action === 'ingest-files') {
      void ingestFiles(files);
      return true;
    }
    return false;
  };
  rehostRef.current = rehostExternalInEditor;

  const anchorHighlight = useMemo(
    () =>
      AnchorHighlight.configure({
        getEntities: () => entitiesRef.current,
        getActiveCardId: () => activeCardIdRef.current,
        getActiveAnnotationId: () => activeAnnotationIdRef.current,
        onAnchorClick: (ids) => onAnchorClickRef.current?.(ids),
        onAnnotationClick: (ids) => onAnnotationClickRef.current?.(ids),
      }),
    [],
  );

  const extensions = useMemo(
    () =>
      createDocExtensions({
        editable: true,
        placeholder: '开始写，或者从左边扔进来…',
        assetUrls,
        anchorHighlight,
      }),
    [anchorHighlight, assetUrls],
  );

  const editor = useEditor({
    immediatelyRender: false,
    shouldRerenderOnTransaction: false,
    extensions,
    content: contentFromSeed(seedDoc),
    editorProps: {
      attributes: {
        class: 'paper-body prose',
        spellcheck: 'false',
      },
      transformPasted: (slice) => stripEntityMarksFromSlice(slice),
      handlePaste: (view, event) => {
        const dt = event.clipboardData;
        if (!dt) return false;
        if (pasteRef.current(dt, view.state.selection.from)) {
          event.preventDefault();
          return true;
        }
        queueMicrotask(() => void rehostRef.current());
        return false;
      },
      handleDrop: (view, event) => {
        const dt = event.dataTransfer;
        if (!dt) return false;
        const coords = view.posAtCoords({ left: event.clientX, top: event.clientY });
        const insertAt = coords?.pos ?? view.state.selection.from;
        if (pasteRef.current(dt, insertAt)) {
          event.preventDefault();
          return true;
        }
        const files = dt.files;
        if (files && files.length > 0) {
          event.preventDefault();
          void ingestRef.current(files);
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor: instance }) => {
      onChangeRef.current(clonePmJson(instance.getJSON()));
    },
  });
  editorRef.current = editor ?? null;

  useEffect(() => {
    if (!editor) return;
    editor.commands.setContent(contentFromSeed(seedDoc), { emitUpdate: false });
    editor.commands.focus('end');
    ensureEntityMarksOnEditor(editor, cardsRef.current, annotationsRef.current);
  }, [editor, seedKey]);

  const bindHostRef = useRef(bindHost);
  bindHostRef.current = bindHost;
  useEffect(() => {
    if (!editor) return;
    const host = createDocEditorHost(editor);
    bindHostRef.current?.(host);
    return () => bindHostRef.current?.(null);
  }, [editor]);

  useEffect(() => {
    if (!editor) return;
    ensureEntityMarksOnEditor(editor, cards, annotations);
  }, [editor, cards, annotations]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        onSaveRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (!editor) return;
    editor.commands.updateDecorations('anchorHighlight');
  }, [editor, entities, activeCardId, activeAnnotationId]);

  const onPickFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    event.target.value = '';
    if (files) void ingestFiles(files);
  };

  if (!editor) {
    return <div className="ws-writer" />;
  }

  const insertLink = () => {
    const previous = editor.getAttributes('link').href;
    const fallback =
      typeof previous === 'string' && previous.length > 0 ? previous : 'https://';
    void dialog.prompt('链接地址', fallback).then((href) => {
      if (href === null) return;
      const trimmed = href.trim();
      if (trimmed === '') {
        editor.chain().focus().extendMarkRange('link').unsetLink().run();
        return;
      }
      editor.chain().focus().extendMarkRange('link').setLink({ href: trimmed }).run();
    });
  };

  const toggleTable = () => {
    if (editor.isActive('table')) {
      editor.chain().focus().deleteTable().run();
      return;
    }
    editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
  };

  const pane = editor.view.dom.closest('.ws-pane');
  const scrollTarget = pane instanceof HTMLElement ? pane : window;
  const canInsertMedia = !uploading;

  return (
    <div className="ws-writer" aria-busy={uploading}>
      {uploadNotice?.error ? (
        <p className="save-state is-error" role="alert">
          {uploadNotice.text}
        </p>
      ) : null}
      <PaperToolbar
        editor={editor}
        uploading={uploading}
        canInsertMedia={canInsertMedia}
        onInsertLink={insertLink}
        onPickImage={() => imageInputRef.current?.click()}
        onPickVideo={() => videoInputRef.current?.click()}
        onToggleTable={toggleTable}
      />
      <BubbleMenu
        editor={editor}
        className="float-toolbar"
        aria-label="划词工具"
        updateDelay={10}
        appendTo={() => document.body}
        shouldShow={({ editor: instance, from, to, state, view }) => {
          if (!instance.isEditable) return false;
          if (state.selection.empty || from === to) return false;
          const text = state.doc.textBetween(from, to, ' ');
          if (!text.trim()) return false;
          return view.hasFocus() || instance.isFocused;
        }}
        options={{
          strategy: 'fixed',
          placement: 'top',
          offset: 12,
          flip: true,
          shift: { padding: 8 },
          scrollTarget,
        }}
      >
        <SelectionFormatBar editor={editor} documentId={documentId} onInsertLink={insertLink} />
      </BubbleMenu>
      <input
        ref={imageInputRef}
        type="file"
        accept={IMAGE_ACCEPT}
        multiple
        hidden
        onChange={onPickFiles}
      />
      <input
        ref={videoInputRef}
        type="file"
        accept={VIDEO_ACCEPT}
        multiple
        hidden
        onChange={onPickFiles}
      />
      <EditorContent editor={editor} />
    </div>
  );
});
