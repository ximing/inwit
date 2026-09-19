import type { Editor } from '@tiptap/react';
import { useEditorState } from '@tiptap/react';
import '@tiptap/extension-text-align';
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
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
import { type MouseEvent, type ReactNode } from 'react';
import { selectionAnchorFromEditor } from '@/lib/entity-marks';
import { SelectionActions } from './selection-toolbar';

const TOOL_ICON = 15;

export function EditorToolButton({
  variant,
  label,
  active,
  disabled,
  onAction,
  children,
}: {
  variant: 'paper' | 'float';
  label: string;
  active?: boolean;
  disabled?: boolean;
  onAction: () => void;
  children: ReactNode;
}) {
  const className = variant === 'paper' ? 'paper-tool' : 'float-tool';
  return (
    <button
      type="button"
      className={`${className}${active ? ' is-on' : ''}`}
      aria-label={label}
      title={label}
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

type TextAlign = 'left' | 'center' | 'right';

type PaperMarks = {
  bold: boolean;
  italic: boolean;
  strike: boolean;
  heading1: boolean;
  heading2: boolean;
  blockquote: boolean;
  bulletList: boolean;
  orderedList: boolean;
  taskList: boolean;
  codeBlock: boolean;
  link: boolean;
  table: boolean;
  textAlign: TextAlign;
};

function currentTextAlign(editor: Editor): TextAlign {
  if (editor.isActive({ textAlign: 'center' })) return 'center';
  if (editor.isActive({ textAlign: 'right' })) return 'right';
  return 'left';
}

function setTextAlign(editor: Editor, align: TextAlign): void {
  if (align === 'left') {
    editor.chain().focus().unsetTextAlign().run();
    return;
  }
  editor.chain().focus().setTextAlign(align).run();
}

function paperMarksOf(editor: Editor): PaperMarks {
  return {
    bold: editor.isActive('bold'),
    italic: editor.isActive('italic'),
    strike: editor.isActive('strike'),
    heading1: editor.isActive('heading', { level: 1 }),
    heading2: editor.isActive('heading', { level: 2 }),
    blockquote: editor.isActive('blockquote'),
    bulletList: editor.isActive('bulletList'),
    orderedList: editor.isActive('orderedList'),
    taskList: editor.isActive('taskList'),
    codeBlock: editor.isActive('codeBlock'),
    link: editor.isActive('link'),
    table: editor.isActive('table'),
    textAlign: currentTextAlign(editor),
  };
}

export function PaperToolbar({
  editor,
  uploading,
  canInsertMedia,
  onInsertLink,
  onPickImage,
  onPickVideo,
  onToggleTable,
}: {
  editor: Editor;
  uploading: boolean;
  canInsertMedia: boolean;
  onInsertLink: () => void;
  onPickImage: () => void;
  onPickVideo: () => void;
  onToggleTable: () => void;
}) {
  const active = useEditorState({
    editor,
    selector: ({ editor: instance }) => paperMarksOf(instance),
  });

  return (
    <div className="paper-toolbar">
      <div className="paper-toolbar-inner" role="toolbar" aria-label="编辑工具">
        <EditorToolButton
          variant="paper"
          label="粗体"
          active={active.bold}
          onAction={() => editor.chain().focus().toggleBold().run()}
        >
          <Bold width={TOOL_ICON} height={TOOL_ICON} strokeWidth={2} />
        </EditorToolButton>
        <EditorToolButton
          variant="paper"
          label="斜体"
          active={active.italic}
          onAction={() => editor.chain().focus().toggleItalic().run()}
        >
          <Italic width={TOOL_ICON} height={TOOL_ICON} strokeWidth={2} />
        </EditorToolButton>
        <EditorToolButton
          variant="paper"
          label="划线"
          active={active.strike}
          onAction={() => editor.chain().focus().toggleStrike().run()}
        >
          <Strikethrough width={TOOL_ICON} height={TOOL_ICON} strokeWidth={2} />
        </EditorToolButton>
        <span className="paper-tool-sep" />
        <EditorToolButton
          variant="paper"
          label="居左"
          active={active.textAlign === 'left'}
          onAction={() => setTextAlign(editor, 'left')}
        >
          <AlignLeft width={TOOL_ICON} height={TOOL_ICON} strokeWidth={2} />
        </EditorToolButton>
        <EditorToolButton
          variant="paper"
          label="居中"
          active={active.textAlign === 'center'}
          onAction={() => setTextAlign(editor, 'center')}
        >
          <AlignCenter width={TOOL_ICON} height={TOOL_ICON} strokeWidth={2} />
        </EditorToolButton>
        <EditorToolButton
          variant="paper"
          label="居右"
          active={active.textAlign === 'right'}
          onAction={() => setTextAlign(editor, 'right')}
        >
          <AlignRight width={TOOL_ICON} height={TOOL_ICON} strokeWidth={2} />
        </EditorToolButton>
        <span className="paper-tool-sep" />
        <EditorToolButton
          variant="paper"
          label="一级标题"
          active={active.heading1}
          onAction={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
        >
          <Heading1 width={TOOL_ICON} height={TOOL_ICON} strokeWidth={2} />
        </EditorToolButton>
        <EditorToolButton
          variant="paper"
          label="二级标题"
          active={active.heading2}
          onAction={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        >
          <Heading2 width={TOOL_ICON} height={TOOL_ICON} strokeWidth={2} />
        </EditorToolButton>
        <EditorToolButton
          variant="paper"
          label="引用"
          active={active.blockquote}
          onAction={() => editor.chain().focus().toggleBlockquote().run()}
        >
          <Quote width={TOOL_ICON} height={TOOL_ICON} strokeWidth={2} />
        </EditorToolButton>
        <span className="paper-tool-sep" />
        <EditorToolButton
          variant="paper"
          label="无序列表"
          active={active.bulletList}
          onAction={() => editor.chain().focus().toggleBulletList().run()}
        >
          <List width={TOOL_ICON} height={TOOL_ICON} strokeWidth={2} />
        </EditorToolButton>
        <EditorToolButton
          variant="paper"
          label="有序列表"
          active={active.orderedList}
          onAction={() => editor.chain().focus().toggleOrderedList().run()}
        >
          <ListOrdered width={TOOL_ICON} height={TOOL_ICON} strokeWidth={2} />
        </EditorToolButton>
        <EditorToolButton
          variant="paper"
          label="任务列表"
          active={active.taskList}
          onAction={() => editor.chain().focus().toggleTaskList().run()}
        >
          <ListChecks width={TOOL_ICON} height={TOOL_ICON} strokeWidth={2} />
        </EditorToolButton>
        <EditorToolButton
          variant="paper"
          label="代码块"
          active={active.codeBlock}
          onAction={() => editor.chain().focus().toggleCodeBlock().run()}
        >
          <Code width={TOOL_ICON} height={TOOL_ICON} strokeWidth={2} />
        </EditorToolButton>
        <span className="paper-tool-sep" />
        <EditorToolButton
          variant="paper"
          label="链接"
          active={active.link}
          onAction={onInsertLink}
        >
          <LinkIcon width={TOOL_ICON} height={TOOL_ICON} strokeWidth={2} />
        </EditorToolButton>
        <EditorToolButton
          variant="paper"
          label="图片"
          disabled={!canInsertMedia}
          onAction={onPickImage}
        >
          <ImageIcon width={TOOL_ICON} height={TOOL_ICON} strokeWidth={2} />
        </EditorToolButton>
        <EditorToolButton
          variant="paper"
          label="视频"
          disabled={!canInsertMedia}
          onAction={onPickVideo}
        >
          <Film width={TOOL_ICON} height={TOOL_ICON} strokeWidth={2} />
        </EditorToolButton>
        <EditorToolButton
          variant="paper"
          label="表格"
          active={active.table}
          onAction={onToggleTable}
        >
          <TableIcon width={TOOL_ICON} height={TOOL_ICON} strokeWidth={2} />
        </EditorToolButton>
        <EditorToolButton
          variant="paper"
          label="分割线"
          onAction={() => editor.chain().focus().setHorizontalRule().run()}
        >
          <Minus width={TOOL_ICON} height={TOOL_ICON} strokeWidth={2} />
        </EditorToolButton>
        {uploading ? (
          <span className="paper-tool is-wide" aria-live="polite">
            上传中…
          </span>
        ) : null}
      </div>
    </div>
  );
}

type SelectionFormatState = {
  bold: boolean;
  italic: boolean;
  strike: boolean;
  link: boolean;
  text: string;
};

function selectionFormatOf(editor: Editor): SelectionFormatState {
  const { from, to } = editor.state.selection;
  return {
    bold: editor.isActive('bold'),
    italic: editor.isActive('italic'),
    strike: editor.isActive('strike'),
    link: editor.isActive('link'),
    text: editor.state.doc.textBetween(from, to, ' '),
  };
}

export function SelectionFormatBar({
  editor,
  documentId,
  onInsertLink,
}: {
  editor: Editor;
  documentId: string | null;
  onInsertLink: () => void;
}) {
  const state = useEditorState({
    editor,
    selector: ({ editor: instance }) => selectionFormatOf(instance),
  });

  return (
    <>
      <EditorToolButton
        variant="float"
        label="粗体"
        active={state.bold}
        onAction={() => editor.chain().focus().toggleBold().run()}
      >
        <Bold width={TOOL_ICON} height={TOOL_ICON} strokeWidth={2} />
      </EditorToolButton>
      <EditorToolButton
        variant="float"
        label="斜体"
        active={state.italic}
        onAction={() => editor.chain().focus().toggleItalic().run()}
      >
        <Italic width={TOOL_ICON} height={TOOL_ICON} strokeWidth={2} />
      </EditorToolButton>
      <EditorToolButton
        variant="float"
        label="划线"
        active={state.strike}
        onAction={() => editor.chain().focus().toggleStrike().run()}
      >
        <Strikethrough width={TOOL_ICON} height={TOOL_ICON} strokeWidth={2} />
      </EditorToolButton>
      <EditorToolButton
        variant="float"
        label="链接"
        active={state.link}
        onAction={onInsertLink}
      >
        <LinkIcon width={TOOL_ICON} height={TOOL_ICON} strokeWidth={2} />
      </EditorToolButton>
      <span className="float-tool-sep" />
      <SelectionActions
        text={state.text}
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
    </>
  );
}
