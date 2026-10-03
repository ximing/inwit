import type { DocumentCard } from '@inwit/dto';

export type CanvasAt = { parentId: string | null; index: number };

export type CanvasOp =
  | { type: 'place'; id: string; at: CanvasAt }
  | { type: 'edit'; id: string; text: string }
  | {
      type: 'create';
      id: string;
      kind: 'text' | 'image';
      text: string | null;
      imageKey: string | null;
      at: CanvasAt;
    }
  | { type: 'delete'; id: string }
  | {
      type: 'restore';
      id: string;
      kind: 'text' | 'image';
      text: string | null;
      imageKey: string | null;
      at: CanvasAt;
      children: Array<{ id: string; index: number }>;
    }
  | { type: 'archive'; id: string }
  | {
      type: 'unarchive';
      id: string;
      card: DocumentCard;
      children: Array<{ id: string; index: number }>;
    };

type Entry = { undo: CanvasOp; redo: CanvasOp };

const LIMIT = 50;

function mapId(id: string, alias: Map<string, string>): string {
  let current = id;
  const seen = new Set<string>();
  while (alias.has(current) && !seen.has(current)) {
    seen.add(current);
    current = alias.get(current) ?? current;
  }
  return current;
}

function mapAt(at: CanvasAt, alias: Map<string, string>): CanvasAt {
  return { parentId: at.parentId ? mapId(at.parentId, alias) : null, index: at.index };
}

function mapChildren(
  children: Array<{ id: string; index: number }>,
  alias: Map<string, string>,
): Array<{ id: string; index: number }> {
  return children.map((child) => ({ id: mapId(child.id, alias), index: child.index }));
}

function resolveOp(op: CanvasOp, alias: Map<string, string>): CanvasOp {
  switch (op.type) {
    case 'place':
      return { type: 'place', id: mapId(op.id, alias), at: mapAt(op.at, alias) };
    case 'edit':
      return { type: 'edit', id: mapId(op.id, alias), text: op.text };
    case 'delete':
      return { type: 'delete', id: mapId(op.id, alias) };
    case 'archive':
      return { type: 'archive', id: mapId(op.id, alias) };
    case 'create':
      return {
        ...op,
        id: mapId(op.id, alias),
        at: mapAt(op.at, alias),
      };
    case 'restore':
      return {
        ...op,
        id: mapId(op.id, alias),
        at: mapAt(op.at, alias),
        children: mapChildren(op.children, alias),
      };
    case 'unarchive':
      return { ...op, id: mapId(op.id, alias), children: mapChildren(op.children, alias) };
  }
}

/** 一篇文档打开期间的脑图撤销栈。折叠不进栈。新建被撤销后再重做时，用 remap 把旧 id 指到新 id。 */
export class CanvasHistory {
  private undoStack: Entry[] = [];
  private redoStack: Entry[] = [];
  private alias = new Map<string, string>();

  get undoCount(): number {
    return this.undoStack.length;
  }

  get redoCount(): number {
    return this.redoStack.length;
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.alias = new Map();
  }

  push(undo: CanvasOp, redo: CanvasOp): void {
    this.undoStack.push({ undo, redo });
    if (this.undoStack.length > LIMIT) this.undoStack.shift();
    this.redoStack = [];
  }

  peekUndo(): CanvasOp | null {
    const entry = this.undoStack.at(-1);
    return entry ? resolveOp(entry.undo, this.alias) : null;
  }

  peekRedo(): CanvasOp | null {
    const entry = this.redoStack.at(-1);
    return entry ? resolveOp(entry.redo, this.alias) : null;
  }

  commitUndo(): void {
    const entry = this.undoStack.pop();
    if (entry) this.redoStack.push(entry);
  }

  commitRedo(): void {
    const entry = this.redoStack.pop();
    if (entry) this.undoStack.push(entry);
  }

  /** 撤销删除或重做新建之后，同一个节点换了 id。 */
  remap(from: string, to: string): void {
    if (from === to) return;
    this.alias.set(from, to);
    for (const [key, value] of this.alias) {
      if (key !== from && value === from) this.alias.set(key, to);
    }
  }
}
