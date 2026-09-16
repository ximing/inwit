import Placeholder from '@tiptap/extension-placeholder';
import type { Editor } from '@tiptap/react';
import { EditorContent, useEditor } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import StarterKit from '@tiptap/starter-kit';
import {
  Bold,
  Code,
  Heading2,
  Italic,
  Link as LinkIcon,
  List,
  Strikethrough,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { Markdown } from 'tiptap-markdown';
import type { AnchorSpec } from '@/lib/anchors';
import { AnchorHighlight } from './anchor-highlight';
import { SelectionActions } from './selection-toolbar';

const NEW_DOC_JSON = {
  type: 'doc',
  content: [{ type: 'paragraph' }],
};

const TOOL_ICON = 15;

function toMarkdown(editor: Editor): string {
  const storage = editor.storage as unknown as { markdown?: { getMarkdown?: () => string } };
  return storage.markdown?.getMarkdown?.() ?? '';
}

function ToolButton({
  label,
  active,
  onAction,
  children,
}: {
  label: string;
  active?: boolean;
  onAction: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={`float-tool${active ? ' is-on' : ''}`}
      aria-label={label}
      aria-pressed={active}
      onMouseDown={(event: MouseEvent<HTMLButtonElement>) => {
        event.preventDefault();
        onAction();
      }}
    >
      {children}
    </button>
  );
}

type PaperEditorProps = {
  seedKey: string;
  seedMarkdown: string | null;
  documentId?: string | null;
  anchors?: AnchorSpec[];
  activeCardId?: string | null;
  activeAnnotationId?: string | null;
  onChange: (markdown: string) => void;
  onSave: () => void;
  onAnchorClick?: (cardIds: string[]) => void;
  onAnnotationClick?: (ids: string[]) => void;
};

export function PaperEditor({
  seedKey,
  seedMarkdown,
  documentId = null,
  anchors = [],
  activeCardId = null,
  activeAnnotationId = null,
  onChange,
  onSave,
  onAnchorClick,
  onAnnotationClick,
}: PaperEditorProps) {
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  const onAnchorClickRef = useRef(onAnchorClick);
  const onAnnotationClickRef = useRef(onAnnotationClick);
  const anchorsRef = useRef(anchors);
  const activeCardIdRef = useRef(activeCardId);
  const activeAnnotationIdRef = useRef(activeAnnotationId);
  onChangeRef.current = onChange;
  onSaveRef.current = onSave;
  onAnchorClickRef.current = onAnchorClick;
  onAnnotationClickRef.current = onAnnotationClick;
  anchorsRef.current = anchors;
  activeCardIdRef.current = activeCardId;
  activeAnnotationIdRef.current = activeAnnotationId;
  const [, setTick] = useState(0);

  const anchorHighlight = useMemo(
    () =>
      AnchorHighlight.configure({
        getAnchors: () => anchorsRef.current,
        getActiveCardId: () => activeCardIdRef.current,
        getActiveAnnotationId: () => activeAnnotationIdRef.current,
        onAnchorClick: (ids) => onAnchorClickRef.current?.(ids),
        onAnnotationClick: (ids) => onAnnotationClickRef.current?.(ids),
      }),
    [],
  );

  const extensions = useMemo(
    () => [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
      }),
      Placeholder.configure({
        placeholder: '开始写，或者从左边扔进来…',
      }),
      Markdown.configure({
        html: false,
        transformPastedText: true,
      }),
      anchorHighlight,
    ],
    [anchorHighlight],
  );

  const editor = useEditor({
    immediatelyRender: false,
    shouldRerenderOnTransaction: false,
    extensions,
    content: seedMarkdown ?? NEW_DOC_JSON,
    editorProps: {
      attributes: {
        class: 'paper-body prose',
        spellcheck: 'false',
      },
    },
    onUpdate: ({ editor: instance }) => {
      onChangeRef.current(toMarkdown(instance));
    },
  });

  useEffect(() => {
    if (!editor) return;
    if (seedMarkdown === null) {
      editor.commands.setContent(NEW_DOC_JSON, { emitUpdate: false });
    } else {
      editor.commands.setContent(seedMarkdown, { emitUpdate: false });
    }
    editor.commands.focus('end');
  }, [editor, seedKey]);

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
  }, [editor, anchors, activeCardId, activeAnnotationId]);

  if (!editor) {
    return <div className="ws-writer" />;
  }

  const insertLink = () => {
    const { from, to } = editor.state.selection;
    const selected = editor.state.doc.textBetween(from, to, '');
    const href = window.prompt('链接地址', 'https://');
    if (!href) return;
    const label = selected || '链接';
    editor.chain().focus().insertContent(`[${label}](${href})`).run();
  };

  const pane = editor.view.dom.closest('.ws-pane');
  const scrollTarget = pane instanceof HTMLElement ? pane : window;

  return (
    <div className="ws-writer">
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
          label="标题"
          active={editor.isActive('heading', { level: 2 })}
          onAction={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        >
          <Heading2 width={TOOL_ICON} height={TOOL_ICON} strokeWidth={2} />
        </ToolButton>
        <ToolButton
          label="列表"
          active={editor.isActive('bulletList')}
          onAction={() => editor.chain().focus().toggleBulletList().run()}
        >
          <List width={TOOL_ICON} height={TOOL_ICON} strokeWidth={2} />
        </ToolButton>
        <ToolButton
          label="代码"
          active={editor.isActive('codeBlock')}
          onAction={() => editor.chain().focus().toggleCodeBlock().run()}
        >
          <Code width={TOOL_ICON} height={TOOL_ICON} strokeWidth={2} />
        </ToolButton>
        <ToolButton label="链接" onAction={insertLink}>
          <LinkIcon width={TOOL_ICON} height={TOOL_ICON} strokeWidth={2} />
        </ToolButton>
        <span className="float-tool-sep" />
        <SelectionActions
          text={editor.state.doc.textBetween(
            editor.state.selection.from,
            editor.state.selection.to,
            ' ',
          )}
          documentId={documentId}
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
      <EditorContent editor={editor} />
    </div>
  );
}
