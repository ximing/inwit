import type { Editor } from '@tiptap/react';
import { useEditorState } from '@tiptap/react';
import { NodeSelection } from '@tiptap/pm/state';
import {
  applyCellBackground,
  runTableCommand,
  TABLE_CELL_COLORS,
  tableActionState,
  tableShortcutLabel,
  type TableCommand,
  type TableShortcut,
} from './table-actions';
import '@tiptap/extension-text-align';
import '@tiptap/extension-text-style';
import {
  Baseline,
  Bold,
  Code,
  Film,
  Highlighter,
  ImageIcon,
  Italic,
  Link as LinkIcon,
  List,
  ListChecks,
  ListOrdered,
  Minus,
  PaintBucket,
  Quote,
  Redo2,
  RemoveFormatting,
  Search,
  Sigma,
  Strikethrough,
  Table as TableIcon,
  Undo2,
  Workflow,
} from 'lucide-react';
import {
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { Select } from '@/components/select';
import { Tip } from '@/components/tip';
import { selectionAnchorFromEditor } from '@/lib/entity-marks';
import { SelectionActions } from './selection-toolbar';
import { OverflowToolbar, type OverflowSlot } from './toolbar-overflow';

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
    <Tip content={label}>
      <button
        type="button"
        className={`${className}${active ? ' is-on' : ''}`}
        aria-label={label}
        aria-pressed={active}
        disabled={disabled}
        onMouseDown={(event: ReactMouseEvent<HTMLButtonElement>) => {
          event.preventDefault();
          if (disabled) return;
          onAction();
        }}
      >
        {children}
      </button>
    </Tip>
  );
}

type TextAlign = 'left' | 'center' | 'right';
type HeadingValue = 'p' | '1' | '2' | '3' | '4' | '5' | '6';

type PaperMarks = {
  bold: boolean;
  italic: boolean;
  strike: boolean;
  heading: HeadingValue;
  blockquote: boolean;
  bulletList: boolean;
  orderedList: boolean;
  taskList: boolean;
  codeBlock: boolean;
  link: boolean;
  table: boolean;
  textAlign: TextAlign;
  fontSize: string;
  color: string;
  backgroundColor: string;
  canUndo: boolean;
  canRedo: boolean;
};

/** Formatting marks. Card anchors and annotations stay. */
const FORMAT_MARKS = [
  'bold',
  'italic',
  'strike',
  'code',
  'link',
  'underline',
  'subscript',
  'superscript',
  'textStyle',
] as const;

const HEADING_OPTIONS: { value: HeadingValue; label: string }[] = [
  { value: 'p', label: '正文' },
  { value: '1', label: 'H1' },
  { value: '2', label: 'H2' },
  { value: '3', label: 'H3' },
  { value: '4', label: 'H4' },
  { value: '5', label: 'H5' },
  { value: '6', label: 'H6' },
];

const ALIGN_OPTIONS: { value: TextAlign; label: string }[] = [
  { value: 'left', label: '居左' },
  { value: 'center', label: '居中' },
  { value: 'right', label: '居右' },
];

const FONT_SIZE_OPTIONS = [
  { value: '', label: '默认' },
  { value: '12px', label: '12' },
  { value: '13px', label: '13' },
  { value: '14px', label: '14' },
  { value: '15px', label: '15' },
  { value: '16px', label: '16' },
  { value: '18px', label: '18' },
  { value: '20px', label: '20' },
  { value: '22px', label: '22' },
  { value: '24px', label: '24' },
  { value: '28px', label: '28' },
  { value: '32px', label: '32' },
  { value: '36px', label: '36' },
];

const TEXT_COLORS = [
  { label: '赤', value: '#b3402a' },
  { label: '赭', value: '#9a6232' },
  { label: '绿', value: '#2f7d4a' },
  { label: '蓝', value: '#2a5f9e' },
  { label: '紫', value: '#6a4c93' },
  { label: '墨', value: '#221d16' },
  { label: '灰', value: '#6f675c' },
] as const;

const BACKGROUND_COLORS = [
  { label: '黄', value: '#f6e7a8' },
  { label: '绿', value: '#d7efd4' },
  { label: '蓝', value: '#d6e6f7' },
  { label: '粉', value: '#f8d6d0' },
  { label: '紫', value: '#e7dff6' },
  { label: '灰', value: '#ece7df' },
] as const;

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

const BLOCK_FORMATS = new Set([
  'heading',
  'blockquote',
  'bulletList',
  'orderedList',
  'taskList',
  'listItem',
  'taskItem',
  'codeBlock',
  'mermaid',
]);

const MERMAID_SOURCE = 'flowchart TD\n  A[开始] --> B[结束]';

function currentTextAlign(editor: Editor): TextAlign {
  if (editor.isActive({ textAlign: 'center' })) return 'center';
  if (editor.isActive({ textAlign: 'right' })) return 'right';
  return 'left';
}

function currentHeading(editor: Editor): HeadingValue {
  for (const level of [1, 2, 3, 4, 5, 6] as const) {
    if (editor.isActive('heading', { level })) return String(level) as HeadingValue;
  }
  return 'p';
}

function styleAttr(editor: Editor, key: 'color' | 'fontSize' | 'backgroundColor'): string {
  const value = editor.getAttributes('textStyle')[key];
  return typeof value === 'string' ? value : '';
}

function fontSizeOptions(current: string): { value: string; label: string }[] {
  if (!current || FONT_SIZE_OPTIONS.some((item) => item.value === current)) return FONT_SIZE_OPTIONS;
  const label = current.endsWith('px') ? current.slice(0, -2) : current;
  return [{ value: current, label }, ...FONT_SIZE_OPTIONS];
}

function applyHeading(editor: Editor, value: string): void {
  const chain = editor.chain().focus();
  if (value === 'p') {
    chain.setParagraph().run();
    return;
  }
  const level = Number(value);
  if (level < 1 || level > 6) return;
  chain.setHeading({ level: level as 1 | 2 | 3 | 4 | 5 | 6 }).run();
}

function applyFontSize(editor: Editor, value: string): void {
  const chain = editor.chain().focus();
  if (!value) {
    chain.unsetFontSize().run();
    return;
  }
  chain.setFontSize(value).run();
}

function applyColor(editor: Editor, value: string | null): void {
  const chain = editor.chain().focus();
  if (!value) {
    chain.unsetColor().run();
    return;
  }
  chain.setColor(value).run();
}

function applyBackground(editor: Editor, value: string | null): void {
  const chain = editor.chain().focus();
  if (!value) {
    chain.unsetBackgroundColor().run();
    return;
  }
  chain.setBackgroundColor(value).run();
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
    heading: currentHeading(editor),
    blockquote: editor.isActive('blockquote'),
    bulletList: editor.isActive('bulletList'),
    orderedList: editor.isActive('orderedList'),
    taskList: editor.isActive('taskList'),
    codeBlock: editor.isActive('codeBlock'),
    link: editor.isActive('link'),
    table: editor.isActive('table'),
    textAlign: currentTextAlign(editor),
    fontSize: styleAttr(editor, 'fontSize'),
    color: styleAttr(editor, 'color'),
    backgroundColor: styleAttr(editor, 'backgroundColor'),
    canUndo: editor.can().undo(),
    canRedo: editor.can().redo(),
  };
}

function ancestorHasBlockFormat(pos: Editor['state']['selection']['$from']): boolean {
  for (let depth = pos.depth; depth > 0; depth -= 1) {
    if (BLOCK_FORMATS.has(pos.node(depth).type.name)) return true;
  }
  return false;
}

function blockStructureActive(editor: Editor): boolean {
  const { selection } = editor.state;
  if (ancestorHasBlockFormat(selection.$from) || ancestorHasBlockFormat(selection.$to)) return true;
  if (selection.empty) return false;
  let found = false;
  editor.state.doc.nodesBetween(selection.from, selection.to, (node) => {
    if (BLOCK_FORMATS.has(node.type.name)) found = true;
  });
  return found;
}

function clearFormatting(editor: Editor): void {
  const chain = editor.chain().focus();
  chain.command(({ tr, state }) => {
    const { selection } = state;
    const ranges = selection.empty
      ? [{ from: selection.$from.start(), to: selection.$from.end() }]
      : selection.ranges.map((range) => ({ from: range.$from.pos, to: range.$to.pos }));
    for (const name of FORMAT_MARKS) {
      const type = state.schema.marks[name];
      if (!type) continue;
      for (const range of ranges) {
        if (range.from < range.to) tr.removeMark(range.from, range.to, type);
      }
      tr.removeStoredMark(type);
    }
    return true;
  });
  if (editor.isActive({ textAlign: 'center' }) || editor.isActive({ textAlign: 'right' })) {
    chain.unsetTextAlign();
  }
  if (blockStructureActive(editor)) chain.clearNodes();
  chain.run();
}

function hostBlockDepth(editor: Editor): number | null {
  const { $from } = editor.state.selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const name = $from.node(depth).type.name;
    if (name === 'codeBlock' || name === 'mermaid') return depth;
  }
  return null;
}

function insertMermaid(editor: Editor): void {
  const block = {
    type: 'mermaid',
    attrs: { view: 'split' },
    content: [{ type: 'text', text: MERMAID_SOURCE }],
  };
  const { selection } = editor.state;
  if (
    selection instanceof NodeSelection &&
    (selection.node.type.name === 'codeBlock' || selection.node.type.name === 'mermaid')
  ) {
    editor.chain().focus().insertContentAt(selection.to, block).run();
    return;
  }
  const { $from } = selection;
  const host = hostBlockDepth(editor);
  // A code or mermaid block cannot contain another block. A list item must keep its paragraph.
  if (host !== null) {
    editor.chain().focus().insertContentAt($from.after(host), block).run();
    return;
  }
  if (editor.isActive('listItem') || editor.isActive('taskItem')) {
    editor.chain().focus().insertContentAt($from.after($from.depth), block).run();
    return;
  }
  editor.chain().focus().insertContent(block).run();
}

function PaperToolSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <Tip content={label}>
      <Select
        className="paper-tool-select"
        ariaLabel={label}
        value={value}
        options={options}
        onChange={onChange}
      />
    </Tip>
  );
}

function colorInputValue(value: string, fallback: string): string {
  return HEX_COLOR.test(value) ? value : fallback;
}

function PaperColorControl({
  label,
  clearLabel,
  icon,
  value,
  fallback,
  colors,
  open,
  onOpenChange,
  onPick,
}: {
  label: string;
  clearLabel: string;
  icon: ReactNode;
  value: string;
  fallback: string;
  colors: readonly { label: string; value: string }[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (value: string | null) => void;
}) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const place = () => {
      const anchor = buttonRef.current;
      const pop = popRef.current;
      if (!anchor || !pop) return;
      const rect = anchor.getBoundingClientRect();
      const width = pop.offsetWidth;
      const height = pop.offsetHeight;
      let left = rect.left;
      let top = rect.bottom + 6;
      const maxLeft = window.innerWidth - width - 8;
      if (left > maxLeft) left = Math.max(8, maxLeft);
      if (top + height > window.innerHeight - 8) top = Math.max(8, rect.top - height - 6);
      setPos((current) =>
        current && current.top === top && current.left === left ? current : { top, left },
      );
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: globalThis.MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (popRef.current?.contains(target) || buttonRef.current?.contains(target)) return;
      if (target instanceof Element && target.closest('.paper-color-tool')) return;
      onOpenChange(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      onOpenChange(false);
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [onOpenChange, open]);

  return (
    <>
      <Tip content={label}>
        <button
          ref={buttonRef}
          type="button"
          className={`paper-tool paper-color-tool${open ? ' is-on' : ''}`}
          aria-label={label}
          aria-expanded={open}
          aria-haspopup="dialog"
          onMouseDown={(event) => {
            event.preventDefault();
            onOpenChange(!open);
          }}
        >
          {icon}
          <span
            className={`paper-color-bar${value ? '' : ' is-empty'}`}
            style={value ? { background: value } : undefined}
          />
        </button>
      </Tip>
      {open
        ? createPortal(
            <div
              ref={popRef}
              className="paper-color-pop"
              role="dialog"
              aria-label={label}
              style={{
                top: pos?.top ?? 0,
                left: pos?.left ?? 0,
                visibility: pos ? 'visible' : 'hidden',
              }}
              onMouseDown={(event) => {
                if (event.target instanceof HTMLInputElement) return;
                event.preventDefault();
              }}
            >
              <div className="paper-color-swatches">
                {colors.map((color) => (
                  <button
                    key={color.value}
                    type="button"
                    className={`paper-color-swatch${
                      value.toLowerCase() === color.value.toLowerCase() ? ' is-on' : ''
                    }`}
                    style={{ background: color.value }}
                    aria-label={color.label}
                    aria-pressed={value.toLowerCase() === color.value.toLowerCase()}
                    onClick={() => {
                      onPick(color.value);
                      onOpenChange(false);
                    }}
                  />
                ))}
              </div>
              <label className="paper-color-custom">
                自定义
                <input
                  className="paper-color-input"
                  type="color"
                  aria-label={`${label}自定义`}
                  value={colorInputValue(value, fallback)}
                  onChange={(event) => onPick(event.target.value)}
                />
              </label>
              <button
                type="button"
                className={`paper-color-clear${value ? '' : ' is-on'}`}
                onClick={() => {
                  onPick(null);
                  onOpenChange(false);
                }}
              >
                {clearLabel}
              </button>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

function TableActionButton({
  label,
  hint,
  pressed,
  disabled = false,
  onAction,
}: {
  label: string;
  hint?: string;
  pressed?: boolean;
  disabled?: boolean;
  onAction: () => void;
}) {
  return (
    <button
      type="button"
      className={`paper-tool is-wide${pressed ? ' is-on' : ''}`}
      aria-label={label}
      title={hint ? `${label}（${hint}）` : label}
      aria-pressed={pressed}
      disabled={disabled}
      onMouseDown={(event: ReactMouseEvent<HTMLButtonElement>) => {
        event.preventDefault();
        if (disabled) return;
        onAction();
      }}
    >
      {label}
    </button>
  );
}

function iconSlot(id: string, node: ReactNode, active = false): OverflowSlot {
  return { id, node, active };
}

function sepSlot(id: string): OverflowSlot {
  return { id, separator: true, node: <span className="paper-tool-sep" /> };
}

function selectSlot(id: string, label: string, node: ReactNode): OverflowSlot {
  return {
    id,
    measure: 'select',
    node: (
      <span className="paper-more-select" data-label={label}>
        {node}
      </span>
    ),
  };
}

function textSlot(
  id: string,
  className: string,
  text: string,
  node: ReactNode,
  active = false,
): OverflowSlot {
  return { id, measure: { className, text }, node, active };
}

function TableActionBar({
  editor,
  colorOpen,
  onColorOpenChange,
}: {
  editor: Editor;
  colorOpen: boolean;
  onColorOpenChange: (open: boolean) => void;
}) {
  const state = useEditorState({
    editor,
    selector: ({ editor: instance }) => tableActionState(instance),
  });

  const action = (
    label: string,
    command: TableCommand,
    extra?: { disabled?: boolean; pressed?: boolean },
  ) => {
    const shortcut: TableShortcut | null =
      command === 'addRowBefore' ||
      command === 'addRowAfter' ||
      command === 'addColumnBefore' ||
      command === 'addColumnAfter' ||
      command === 'deleteRow' ||
      command === 'deleteColumn'
        ? command
        : null;
    return textSlot(
      command,
      'paper-tool is-wide',
      label,
      <TableActionButton
        label={label}
        hint={shortcut ? tableShortcutLabel(shortcut) : undefined}
        disabled={extra?.disabled}
        pressed={extra?.pressed}
        onAction={() => runTableCommand(editor, command)}
      />,
      extra?.pressed,
    );
  };

  return (
    <OverflowToolbar
      label="表格操作"
      className="paper-table-bar"
      onClose={() => onColorOpenChange(false)}
      slots={[
        textSlot('label', 'paper-table-label', '表格', <span className="paper-table-label">表格</span>),
        action('上方加行', 'addRowBefore'),
        action('下方加行', 'addRowAfter'),
        action('删除行', 'deleteRow', { disabled: !state.canDeleteRow }),
        sepSlot('sep-row'),
        action('左侧加列', 'addColumnBefore'),
        action('右侧加列', 'addColumnAfter'),
        action('删除列', 'deleteColumn', { disabled: !state.canDeleteColumn }),
        sepSlot('sep-col'),
        action('合并单元格', 'mergeCells', { disabled: !state.canMerge }),
        action('拆分单元格', 'splitCell', { disabled: !state.canSplit }),
        sepSlot('sep-cell'),
        action('表头行', 'toggleHeaderRow', { pressed: state.headerRow }),
        action('表头列', 'toggleHeaderColumn', { pressed: state.headerColumn }),
        iconSlot(
          'cell-color',
          <PaperColorControl
            label="单元格背景"
            clearLabel="无"
            icon={<PaintBucket width={TOOL_ICON} height={TOOL_ICON} strokeWidth={2} />}
            value={state.background}
            fallback="#ece7df"
            colors={TABLE_CELL_COLORS}
            open={colorOpen}
            onOpenChange={onColorOpenChange}
            onPick={(value) => applyCellBackground(editor, value)}
          />,
          state.background !== '',
        ),
        sepSlot('sep-delete'),
        action('删除表格', 'deleteTable'),
      ]}
    />
  );
}

export function PaperToolbar({
  editor,
  uploading,
  canInsertMedia,
  onInsertLink,
  onPickImage,
  onPickVideo,
  onToggleTable,
  onInsertMath,
  onFind,
  findOpen,
}: {
  editor: Editor;
  uploading: boolean;
  canInsertMedia: boolean;
  onInsertLink: () => void;
  onPickImage: () => void;
  onPickVideo: () => void;
  onToggleTable: () => void;
  onInsertMath: () => void;
  onFind: () => void;
  findOpen: boolean;
}) {
  const active = useEditorState({
    editor,
    selector: ({ editor: instance }) => paperMarksOf(instance),
  });
  const [styleMenu, setStyleMenu] = useState<null | 'color' | 'background' | 'cell'>(null);
  useEffect(() => {
    if (!active.table) setStyleMenu((current) => (current === 'cell' ? null : current));
  }, [active.table]);

  const tool = (
    id: string,
    label: string,
    icon: ReactNode,
    onAction: () => void,
    extra?: { active?: boolean; disabled?: boolean },
  ) =>
    iconSlot(
      id,
      <EditorToolButton
        variant="paper"
        label={label}
        active={extra?.active}
        disabled={extra?.disabled}
        onAction={onAction}
      >
        {icon}
      </EditorToolButton>,
      extra?.active,
    );
  return (
    <div className="paper-toolbar">
      <OverflowToolbar
        label="编辑工具"
        onClose={() => setStyleMenu((current) => (current === 'cell' ? current : null))}
        slots={[
          tool('undo', '撤销', <Undo2 width={TOOL_ICON} height={TOOL_ICON} strokeWidth={2} />, () =>
            editor.chain().focus().undo().run(), { disabled: !active.canUndo }),
          tool('redo', '重做', <Redo2 width={TOOL_ICON} height={TOOL_ICON} strokeWidth={2} />, () =>
            editor.chain().focus().redo().run(), { disabled: !active.canRedo }),
          sepSlot('sep-history'),
          tool('bold', '粗体', <Bold width={TOOL_ICON} height={TOOL_ICON} strokeWidth={2} />, () =>
            editor.chain().focus().toggleBold().run(), { active: active.bold }),
          tool('italic', '斜体', <Italic width={TOOL_ICON} height={TOOL_ICON} strokeWidth={2} />, () =>
            editor.chain().focus().toggleItalic().run(), { active: active.italic }),
          tool('strike', '划线', <Strikethrough width={TOOL_ICON} height={TOOL_ICON} strokeWidth={2} />, () =>
            editor.chain().focus().toggleStrike().run(), { active: active.strike }),
          selectSlot(
            'font-size',
            '字号',
            <PaperToolSelect
              label="字号"
              value={active.fontSize}
              options={fontSizeOptions(active.fontSize)}
              onChange={(value) => applyFontSize(editor, value)}
            />,
          ),
          iconSlot(
            'color',
            <PaperColorControl
              label="字体颜色"
              clearLabel="默认"
              icon={<Baseline width={TOOL_ICON} height={TOOL_ICON} strokeWidth={2} />}
              value={active.color}
              fallback="#221d16"
              colors={TEXT_COLORS}
              open={styleMenu === 'color'}
              onOpenChange={(open) => setStyleMenu(open ? 'color' : null)}
              onPick={(value) => applyColor(editor, value)}
            />,
            active.color !== '',
          ),
          iconSlot(
            'background',
            <PaperColorControl
              label="字体背景色"
              clearLabel="无"
              icon={<Highlighter width={TOOL_ICON} height={TOOL_ICON} strokeWidth={2} />}
              value={active.backgroundColor}
              fallback="#f6e7a8"
              colors={BACKGROUND_COLORS}
              open={styleMenu === 'background'}
              onOpenChange={(open) => setStyleMenu(open ? 'background' : null)}
              onPick={(value) => applyBackground(editor, value)}
            />,
            active.backgroundColor !== '',
          ),
          tool('clear', '清除格式', <RemoveFormatting width={TOOL_ICON} height={TOOL_ICON} strokeWidth={2} />, () =>
            clearFormatting(editor)),
          sepSlot('sep-style'),
          selectSlot(
            'align',
            '对齐',
            <PaperToolSelect
              label="对齐"
              value={active.textAlign}
              options={ALIGN_OPTIONS}
              onChange={(value) => setTextAlign(editor, value as TextAlign)}
            />,
          ),
          selectSlot(
            'heading',
            '标题',
            <PaperToolSelect
              label="标题"
              value={active.heading}
              options={HEADING_OPTIONS}
              onChange={(value) => applyHeading(editor, value)}
            />,
          ),
          tool('quote', '引用', <Quote width={TOOL_ICON} height={TOOL_ICON} strokeWidth={2} />, () =>
            editor.chain().focus().toggleBlockquote().run(), { active: active.blockquote }),
          sepSlot('sep-block'),
          tool('bullet', '无序列表', <List width={TOOL_ICON} height={TOOL_ICON} strokeWidth={2} />, () =>
            editor.chain().focus().toggleBulletList().run(), { active: active.bulletList }),
          tool('ordered', '有序列表', <ListOrdered width={TOOL_ICON} height={TOOL_ICON} strokeWidth={2} />, () =>
            editor.chain().focus().toggleOrderedList().run(), { active: active.orderedList }),
          tool('task', '任务列表', <ListChecks width={TOOL_ICON} height={TOOL_ICON} strokeWidth={2} />, () =>
            editor.chain().focus().toggleTaskList().run(), { active: active.taskList }),
          tool('code', '代码块', <Code width={TOOL_ICON} height={TOOL_ICON} strokeWidth={2} />, () =>
            editor.chain().focus().toggleCodeBlock().run(), { active: active.codeBlock }),
          sepSlot('sep-insert'),
          tool('link', '链接', <LinkIcon width={TOOL_ICON} height={TOOL_ICON} strokeWidth={2} />, onInsertLink, {
            active: active.link,
          }),
          tool('image', '图片', <ImageIcon width={TOOL_ICON} height={TOOL_ICON} strokeWidth={2} />, onPickImage, {
            disabled: !canInsertMedia,
          }),
          tool('video', '视频', <Film width={TOOL_ICON} height={TOOL_ICON} strokeWidth={2} />, onPickVideo, {
            disabled: !canInsertMedia,
          }),
          tool('table', '表格', <TableIcon width={TOOL_ICON} height={TOOL_ICON} strokeWidth={2} />, onToggleTable, {
            active: active.table,
          }),
          tool('rule', '分割线', <Minus width={TOOL_ICON} height={TOOL_ICON} strokeWidth={2} />, () =>
            editor.chain().focus().setHorizontalRule().run()),
          tool('math', '公式', <Sigma width={TOOL_ICON} height={TOOL_ICON} strokeWidth={2} />, onInsertMath),
          tool('mermaid', 'Mermaid', <Workflow width={TOOL_ICON} height={TOOL_ICON} strokeWidth={2} />, () =>
            insertMermaid(editor)),
          sepSlot('sep-find'),
          tool('find', '查找', <Search width={TOOL_ICON} height={TOOL_ICON} strokeWidth={2} />, onFind, {
            active: findOpen,
          }),
          ...(uploading
            ? [
                textSlot(
                  'uploading',
                  'paper-tool is-wide',
                  '上传中…',
                  <span className="paper-tool is-wide" aria-live="polite">
                    上传中…
                  </span>,
                ),
              ]
            : []),
        ]}
      />
      {active.table ? (
        <TableActionBar
          editor={editor}
          colorOpen={styleMenu === 'cell'}
          onColorOpenChange={(open) => setStyleMenu(open ? 'cell' : null)}
        />
      ) : null}
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
