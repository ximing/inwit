import type { Annotation, DocumentCard } from '@inwit/dto';
import { observer, useService } from '@rabjs/react';
import type { Editor } from '@tiptap/react';
import { EditorContent, useEditor } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import {
  Bold,
  Code,
  Film,
  Heading1,
  Heading2,
  ImageIcon,
  Italic,
  Link as LinkIcon,
  List,
  ListChecks,
  ListOrdered,
  Minus,
  Quote,
  Strikethrough,
  Table as TableIcon,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type MouseEvent,
  type ReactNode,
} from 'react';
import {
  completeAssetMultipart,
  initAssetMultipart,
  presignAsset,
  signAssetMultipart,
} from '@/api/assets';
import { createDocExtensions } from '@/components/doc/extensions';
import { docEntities } from '@/lib/anchors';
import {
  createDocEditorHost,
  ensureEntityMarksOnEditor,
  selectionAnchorFromEditor,
  stripEntityMarksFromSlice,
  type DocEditorHost,
} from '@/lib/entity-marks';
import { asPmJson, clonePmJson } from '@/lib/pm-doc';
import { AssetUrlsService } from '@/services/asset-urls.service';
import { DialogService } from '@/services/dialog.service';
import { AnchorHighlight } from './anchor-highlight';
import { SelectionActions } from './selection-toolbar';
import {
  AssetUploadError,
  ingestAssetFiles,
  putViaFetch,
  UPLOAD_FAILED_MESSAGE,
  type UploadDocAssetApi,
} from './upload-asset';

const NEW_DOC_JSON = {
  type: 'doc',
  content: [{ type: 'paragraph' }],
};

const TOOL_ICON = 15;

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

function ToolButton({
  label,
  active,
  disabled,
  onAction,
  children,
}: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onAction: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={`float-tool${active ? ' is-on' : ''}`}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onMouseDown={(event: MouseEvent<HTMLButtonElement>) => {
        event.preventDefault();
        if (disabled) return;
        onAction();
      }}
    >
      {children}
    </button>
  );
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
  const [, setTick] = useState(0);
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
      handlePaste: (_view, event) => {
        const files = event.clipboardData?.files;
        if (files && files.length > 0) {
          event.preventDefault();
          void ingestRef.current(files);
          return true;
        }
        return false;
      },
      handleDrop: (_view, event) => {
        const files = event.dataTransfer?.files;
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
    const refresh = () => setTick((n) => n + 1);
    editor.on('selectionUpdate', refresh);
    return () => {
      editor.off('selectionUpdate', refresh);
    };
  }, [editor]);

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
      {uploadNotice ? (
        <p
          className={`save-state${uploadNotice.error ? ' is-error' : ''}`}
          role={uploadNotice.error ? 'alert' : 'status'}
        >
          {uploadNotice.text}
        </p>
      ) : null}
      <BubbleMenu
        editor={editor}
        className="float-toolbar"
        aria-label="编辑工具"
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
        <ToolButton
          label="粗体"
          active={editor.isActive('bold')}
          onAction={() => editor.chain().focus().toggleBold().run()}
        >
          <Bold width={TOOL_ICON} height={TOOL_ICON} strokeWidth={2} />
        </ToolButton>
        <ToolButton
          label="斜体"
          active={editor.isActive('italic')}
          onAction={() => editor.chain().focus().toggleItalic().run()}
        >
          <Italic width={TOOL_ICON} height={TOOL_ICON} strokeWidth={2} />
        </ToolButton>
        <ToolButton
          label="划线"
          active={editor.isActive('strike')}
          onAction={() => editor.chain().focus().toggleStrike().run()}
        >
          <Strikethrough width={TOOL_ICON} height={TOOL_ICON} strokeWidth={2} />
        </ToolButton>
        <span className="float-tool-sep" />
        <ToolButton
          label="一级标题"
          active={editor.isActive('heading', { level: 1 })}
          onAction={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
        >
          <Heading1 width={TOOL_ICON} height={TOOL_ICON} strokeWidth={2} />
        </ToolButton>
        <ToolButton
          label="二级标题"
          active={editor.isActive('heading', { level: 2 })}
          onAction={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        >
          <Heading2 width={TOOL_ICON} height={TOOL_ICON} strokeWidth={2} />
        </ToolButton>
        <ToolButton
          label="引用"
          active={editor.isActive('blockquote')}
          onAction={() => editor.chain().focus().toggleBlockquote().run()}
        >
          <Quote width={TOOL_ICON} height={TOOL_ICON} strokeWidth={2} />
        </ToolButton>
        <span className="float-tool-sep" />
        <ToolButton
          label="无序列表"
          active={editor.isActive('bulletList')}
          onAction={() => editor.chain().focus().toggleBulletList().run()}
        >
          <List width={TOOL_ICON} height={TOOL_ICON} strokeWidth={2} />
        </ToolButton>
        <ToolButton
          label="有序列表"
          active={editor.isActive('orderedList')}
          onAction={() => editor.chain().focus().toggleOrderedList().run()}
        >
          <ListOrdered width={TOOL_ICON} height={TOOL_ICON} strokeWidth={2} />
        </ToolButton>
        <ToolButton
          label="任务列表"
          active={editor.isActive('taskList')}
          onAction={() => editor.chain().focus().toggleTaskList().run()}
        >
          <ListChecks width={TOOL_ICON} height={TOOL_ICON} strokeWidth={2} />
        </ToolButton>
        <ToolButton
          label="代码块"
          active={editor.isActive('codeBlock')}
          onAction={() => editor.chain().focus().toggleCodeBlock().run()}
        >
          <Code width={TOOL_ICON} height={TOOL_ICON} strokeWidth={2} />
        </ToolButton>
        <span className="float-tool-sep" />
        <ToolButton label="链接" active={editor.isActive('link')} onAction={insertLink}>
          <LinkIcon width={TOOL_ICON} height={TOOL_ICON} strokeWidth={2} />
        </ToolButton>
        <ToolButton
          label="图片"
          disabled={!canInsertMedia}
          onAction={() => imageInputRef.current?.click()}
        >
          <ImageIcon width={TOOL_ICON} height={TOOL_ICON} strokeWidth={2} />
        </ToolButton>
        <ToolButton
          label="视频"
          disabled={!canInsertMedia}
          onAction={() => videoInputRef.current?.click()}
        >
          <Film width={TOOL_ICON} height={TOOL_ICON} strokeWidth={2} />
        </ToolButton>
        <ToolButton
          label="表格"
          active={editor.isActive('table')}
          onAction={toggleTable}
        >
          <TableIcon width={TOOL_ICON} height={TOOL_ICON} strokeWidth={2} />
        </ToolButton>
        <ToolButton
          label="分割线"
          onAction={() => editor.chain().focus().setHorizontalRule().run()}
        >
          <Minus width={TOOL_ICON} height={TOOL_ICON} strokeWidth={2} />
        </ToolButton>
        {uploading ? (
          <span className="float-tool is-wide" aria-live="polite">
            上传中…
          </span>
        ) : null}
        <span className="float-tool-sep" />
        <SelectionActions
          text={editor.state.doc.textBetween(
            editor.state.selection.from,
            editor.state.selection.to,
            ' ',
          )}
          documentId={documentId}
          getSelection={() => selectionAnchorFromEditor(editor)}
          getRect={() => {
            const { from, to } = editor.state.selection;
            const start = editor.view.coordsAtPos(from);
            const end = editor.view.coordsAtPos(to);
            return {
              left: (start.left + end.right) / 2,
              top: Math.min(start.top, end.top),
              bottom: Math.max(start.bottom, end.bottom),
            };
          }}
        />
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
