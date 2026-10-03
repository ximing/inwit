import type { CanvasNodeKind } from '@inwit/dto';

export type MindNodeKind = CanvasNodeKind;

/** 脑图指针和键盘落到同一套结果上。布局、拖放落点和撤销不在这里。 */
export type MindGesture =
  | { action: 'click'; kind: MindNodeKind; repeat: boolean }
  | { action: 'double-click'; kind: MindNodeKind }
  | { action: 'empty' }
  | { action: 'drag' }
  | { action: 'enter'; kind: MindNodeKind }
  | { action: 'escape'; editing: boolean }
  | { action: 'arrow'; kind: MindNodeKind };

export type MindEditMode = 'inline-text' | 'card-dialog' | 'inline-note' | 'none';

export type MindIntent =
  | { type: 'select'; reveal: boolean }
  | { type: 'edit'; editor: MindEditMode }
  | { type: 'clear' }
  | { type: 'ignore' }
  | { type: 'cancel-draft' };

export type MindCardAction = 'confirm' | 'problem' | 'suspend' | 'archive' | 'links';

function revealsDocument(kind: MindNodeKind): boolean {
  return kind === 'card' || kind === 'annotation';
}

function editorFor(kind: MindNodeKind): MindEditMode {
  if (kind === 'text') return 'inline-text';
  if (kind === 'card') return 'card-dialog';
  if (kind === 'annotation') return 'inline-note';
  return 'none';
}

/**
 * 单击和方向键只选中。卡片和批注还会请求正文定位；文本和图片不会。
 * 再点一次不取消选中，也不开始编辑。双击和 Enter 才编辑。拖动不是选中。
 */
export function decideMindGesture(gesture: MindGesture): MindIntent {
  switch (gesture.action) {
    case 'drag':
      return { type: 'ignore' };
    case 'empty':
      return { type: 'clear' };
    case 'escape':
      return gesture.editing ? { type: 'cancel-draft' } : { type: 'clear' };
    case 'click':
      if (gesture.repeat) return { type: 'select', reveal: revealsDocument(gesture.kind) };
      return { type: 'select', reveal: revealsDocument(gesture.kind) };
    case 'arrow':
      return { type: 'select', reveal: revealsDocument(gesture.kind) };
    case 'double-click':
    case 'enter':
      return { type: 'edit', editor: editorFor(gesture.kind) };
    default:
      return { type: 'ignore' };
  }
}

/** Escape 放弃草稿。Ctrl/Cmd+Enter 提交。其余按键留给输入框。 */
export function mindDraftKeyCommand(key: string, mod: boolean): 'cancel' | 'commit' | null {
  if (key === 'Escape') return 'cancel';
  if (key === 'Enter' && mod) return 'commit';
  return null;
}

/** 取消回到保存过的文本。提交时，去掉两端空白后没变就不写。 */
export function mindDraftAfter(
  saved: string,
  draft: string,
  command: 'cancel' | 'commit',
): { text: string; save: boolean } {
  if (command === 'cancel') return { text: saved, save: false };
  return { text: draft, save: draft.trim() !== saved };
}

/**
 * 脑图里选中一张未展开的卡，也要能确认、标问题、暂停或恢复、归档、看关联。
 * 列表里仍只看展开。两者都没有时这些操作不出现。
 */
export function mindCardActions(input: {
  expanded: boolean;
  canvasSelected: boolean;
}): Record<MindCardAction, boolean> {
  const show = input.expanded || input.canvasSelected;
  return {
    confirm: show,
    problem: show,
    suspend: show,
    archive: show,
    links: show,
  };
}
