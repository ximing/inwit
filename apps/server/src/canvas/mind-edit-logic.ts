import {
  CARD_OUTLINE_MAX_DEPTH,
  planOutlineDetach,
  planOutlineMove,
  planOutlinePlace,
  type CanvasNodeKind,
} from '@inwit/dto';

/** 一次对话里提交的脑图编辑上限。 */
export const MIND_EDIT_MAX = 80;

/** 文本章节标题，与画布文本节点一致。 */
export const MIND_TEXT_MAX = 4000;

/** 划线原文和说明，与批注字段上限一致。 */
export const MIND_QUOTE_MAX = 20_000;

const REF_RE = /^[A-Za-z][A-Za-z0-9_-]{0,31}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type MindEditMember = {
  id: string;
  kind: CanvasNodeKind;
  parentId: string | null;
  position: number;
};

export type MindTreeNode = MindEditMember & { label: string };

/** 父节点：已有 id、本批新建章节的 ref，或最外层。 */
export type MindEditParent =
  | { kind: 'root' }
  | { kind: 'id'; id: string }
  | { kind: 'ref'; ref: string };

export type MindEditInput = {
  op?: string;
  ref?: string;
  nodeId?: string;
  text?: string;
  /** create_highlight：read_document 里「[块 N | …]」的 N。 */
  blockIndex?: number;
  /** create_highlight：这一块里连续的原文。 */
  quote?: string;
  /** create_highlight：脑图上显示的短标题。 */
  note?: string;
  parentId?: string | null;
  parentRef?: string;
  index?: number;
};

export type MindEditStep =
  | { op: 'create_text'; ref: string; text: string; parent: MindEditParent; index?: number }
  | {
      op: 'create_highlight';
      ref: string;
      quote: string;
      note: string;
      blockIndex: number;
      parent: MindEditParent;
      index?: number;
    }
  | { op: 'rename_text'; nodeId: string; text: string }
  | { op: 'move'; nodeId: string; parent: MindEditParent; index?: number }
  | { op: 'delete_text'; nodeId: string };

export type MindEditPlan =
  | {
      ok: true;
      steps: MindEditStep[];
      /** 模拟之后的树。新建章节的 id 是 `ref:` 加临时编号，落库时会换成真正的 id。 */
      nodes: MindEditMember[];
      createdCount: number;
      highlightCount: number;
      renamedCount: number;
      movedCount: number;
      deletedCount: number;
    }
  | { ok: false; reason: string };

const KIND_LABEL: Record<CanvasNodeKind, string> = {
  text: '文本',
  card: '卡片',
  annotation: '批注',
  image: '图片',
};

function placeReason(reason: 'missing' | 'self' | 'cycle' | 'depth'): string {
  if (reason === 'self') return '不能把节点放到自己下面';
  if (reason === 'cycle') return '这样放会形成环';
  if (reason === 'depth') return `脑图不能超过 ${String(CARD_OUTLINE_MAX_DEPTH)} 级`;
  return '找不到父节点';
}

function readTitle(text: string | undefined): { ok: true; text: string } | { ok: false; reason: string } {
  const trimmed = text?.trim() ?? '';
  if (trimmed.length === 0) return { ok: false, reason: '章节标题不能为空' };
  if ([...trimmed].length > MIND_TEXT_MAX) return { ok: false, reason: '章节标题过长' };
  return { ok: true, text: trimmed };
}

function readQuote(quote: string | undefined): { ok: true; quote: string } | { ok: false; reason: string } {
  const trimmed = quote?.trim() ?? '';
  if (trimmed.length === 0) return { ok: false, reason: '划线原文不能为空' };
  if ([...trimmed].length > MIND_QUOTE_MAX) return { ok: false, reason: '划线原文过长' };
  return { ok: true, quote: trimmed };
}

function readNote(note: string | undefined): { ok: true; note: string } | { ok: false; reason: string } {
  const trimmed = note?.trim() ?? '';
  if ([...trimmed].length > MIND_QUOTE_MAX) return { ok: false, reason: '划线说明过长' };
  return { ok: true, note: trimmed };
}

function readBlockIndex(
  blockIndex: number | undefined,
): { ok: true; blockIndex: number } | { ok: false; reason: string } {
  if (blockIndex === undefined) return { ok: false, reason: '要写明原文在第几块' };
  if (!Number.isInteger(blockIndex) || blockIndex < 1) return { ok: false, reason: '块号不合法' };
  return { ok: true, blockIndex };
}

function readRef(ref: string | undefined): { ok: true; ref: string } | { ok: false; reason: string } {
  const trimmed = ref?.trim() ?? '';
  if (!REF_RE.test(trimmed)) {
    return { ok: false, reason: trimmed ? `章节编号不合法：${trimmed}` : '新建章节要有编号' };
  }
  return { ok: true, ref: trimmed };
}

function readNodeId(nodeId: string | undefined): { ok: true; nodeId: string } | { ok: false; reason: string } {
  const trimmed = nodeId?.trim() ?? '';
  if (!UUID_RE.test(trimmed)) return { ok: false, reason: '节点 id 不合法' };
  return { ok: true, nodeId: trimmed };
}

function readParent(
  edit: MindEditInput,
  mode: 'create' | 'move',
): { ok: true; parent: MindEditParent } | { ok: false; reason: string } {
  const hasId = edit.parentId !== undefined;
  const refText = edit.parentRef?.trim() ?? '';
  const hasRef = refText.length > 0;
  if (hasId && hasRef) return { ok: false, reason: '父节点只能指定一个' };
  if (!hasId && !hasRef) {
    if (mode === 'move') {
      return { ok: false, reason: '移动时要写明父节点，挂到最外层请把 parentId 设为 null' };
    }
    return { ok: true, parent: { kind: 'root' } };
  }
  if (hasRef) {
    if (!REF_RE.test(refText)) return { ok: false, reason: `章节编号不合法：${refText}` };
    return { ok: true, parent: { kind: 'ref', ref: refText } };
  }
  if (edit.parentId === null) return { ok: true, parent: { kind: 'root' } };
  if (!UUID_RE.test(edit.parentId ?? '')) return { ok: false, reason: '父节点 id 不合法' };
  return { ok: true, parent: { kind: 'id', id: edit.parentId ?? '' } };
}

function readIndex(index: number | undefined): { ok: true; index?: number } | { ok: false; reason: string } {
  if (index === undefined) return { ok: true };
  if (!Number.isInteger(index) || index < 0) return { ok: false, reason: '顺序不合法' };
  return { ok: true, index };
}

function resolveParentId(
  parent: MindEditParent,
  refs: ReadonlyMap<string, string>,
  nodes: readonly MindEditMember[],
): { ok: true; parentId: string | null } | { ok: false; reason: string } {
  if (parent.kind === 'root') return { ok: true, parentId: null };
  if (parent.kind === 'ref') {
    const id = refs.get(parent.ref);
    if (!id) return { ok: false, reason: `还没有名为 ${parent.ref} 的章节` };
    return { ok: true, parentId: id };
  }
  if (!nodes.some((node) => node.id === parent.id)) return { ok: false, reason: '找不到父节点' };
  return { ok: true, parentId: parent.id };
}

function applyShifts(
  nodes: MindEditMember[],
  moves: readonly { id: string; parentId: string | null; position: number }[],
): void {
  for (const move of moves) {
    const node = nodes.find((item) => item.id === move.id);
    if (!node) continue;
    node.parentId = move.parentId;
    node.position = move.position;
  }
}

function relocate(
  nodes: MindEditMember[],
  nodeId: string,
  parentId: string | null,
  index: number | undefined,
): { ok: true } | { ok: false; reason: string } {
  if (index === undefined) {
    const plan = planOutlineMove(nodes, nodeId, parentId);
    if (!plan.ok) return { ok: false, reason: placeReason(plan.reason) };
    const node = nodes.find((item) => item.id === nodeId);
    if (!node) return { ok: false, reason: '找不到这个节点' };
    node.parentId = plan.parentId;
    node.position = plan.position;
    return { ok: true };
  }
  const plan = planOutlinePlace(nodes, nodeId, parentId, index);
  if (!plan.ok) return { ok: false, reason: placeReason(plan.reason) };
  applyShifts(nodes, plan.moves);
  return { ok: true };
}

function appendPosition(nodes: readonly MindEditMember[]): number {
  let position = 0;
  for (const node of nodes) {
    if (node.parentId === null && node.position >= position) position = node.position + 1;
  }
  return position;
}

/** 把本批新建的节点放进模拟树。ref 要在成功之后再登记，避免自己挂到自己下面。 */
function placeCreated(
  nodes: MindEditMember[],
  refs: ReadonlyMap<string, string>,
  id: string,
  kind: CanvasNodeKind,
  parent: MindEditParent,
  index: number | undefined,
): { ok: true } | { ok: false; reason: string } {
  if (parent.kind === 'root' && index === undefined) {
    nodes.push({ id, kind, parentId: null, position: appendPosition(nodes) });
    return { ok: true };
  }
  nodes.push({ id, kind, parentId: null, position: 0 });
  const resolved = resolveParentId(parent, refs, nodes);
  if (!resolved.ok) return resolved;
  return relocate(nodes, id, resolved.parentId, index);
}

/**
 * 按顺序模拟一批脑图编辑。
 * 没被点名的节点留在原来的父节点上。新建章节要先出现，后面的操作才能用它的 ref。
 */
export function planMindEdits(
  members: readonly MindEditMember[],
  edits: readonly MindEditInput[],
): MindEditPlan {
  if (edits.length === 0) return { ok: false, reason: '这次没有修改' };
  if (edits.length > MIND_EDIT_MAX) {
    return { ok: false, reason: `一次最多调整 ${String(MIND_EDIT_MAX)} 处` };
  }

  const nodes = members.map((node) => ({ ...node }));
  const original = new Set(nodes.map((node) => node.id));
  const refs = new Map<string, string>();
  const steps: MindEditStep[] = [];

  for (const edit of edits) {
    if (edit.op === 'create_text') {
      const ref = readRef(edit.ref);
      if (!ref.ok) return ref;
      if (refs.has(ref.ref)) return { ok: false, reason: `章节编号重复：${ref.ref}` };
      const title = readTitle(edit.text);
      if (!title.ok) return title;
      const parent = readParent(edit, 'create');
      if (!parent.ok) return parent;
      const index = readIndex(edit.index);
      if (!index.ok) return index;

      const id = `ref:${ref.ref}`;
      const placed = placeCreated(nodes, refs, id, 'text', parent.parent, index.index);
      if (!placed.ok) return placed;
      refs.set(ref.ref, id);
      steps.push({
        op: 'create_text',
        ref: ref.ref,
        text: title.text,
        parent: parent.parent,
        ...(index.index !== undefined ? { index: index.index } : {}),
      });
      continue;
    }

    if (edit.op === 'create_highlight') {
      const ref = readRef(edit.ref);
      if (!ref.ok) return ref;
      if (refs.has(ref.ref)) return { ok: false, reason: `章节编号重复：${ref.ref}` };
      const quote = readQuote(edit.quote);
      if (!quote.ok) return quote;
      const note = readNote(edit.note);
      if (!note.ok) return note;
      const blockIndex = readBlockIndex(edit.blockIndex);
      if (!blockIndex.ok) return blockIndex;
      const parent = readParent(edit, 'create');
      if (!parent.ok) return parent;
      const index = readIndex(edit.index);
      if (!index.ok) return index;

      const id = `ref:${ref.ref}`;
      const placed = placeCreated(nodes, refs, id, 'annotation', parent.parent, index.index);
      if (!placed.ok) return placed;
      refs.set(ref.ref, id);
      steps.push({
        op: 'create_highlight',
        ref: ref.ref,
        quote: quote.quote,
        note: note.note,
        blockIndex: blockIndex.blockIndex,
        parent: parent.parent,
        ...(index.index !== undefined ? { index: index.index } : {}),
      });
      continue;
    }

    if (edit.op === 'rename_text') {
      const nodeId = readNodeId(edit.nodeId);
      if (!nodeId.ok) return nodeId;
      const title = readTitle(edit.text);
      if (!title.ok) return title;
      const node = nodes.find((item) => item.id === nodeId.nodeId);
      if (!node || !original.has(node.id)) return { ok: false, reason: '找不到这个节点' };
      if (node.kind !== 'text') return { ok: false, reason: '只能修改章节标题' };
      steps.push({ op: 'rename_text', nodeId: node.id, text: title.text });
      continue;
    }

    if (edit.op === 'move') {
      const nodeId = readNodeId(edit.nodeId);
      if (!nodeId.ok) return nodeId;
      const parent = readParent(edit, 'move');
      if (!parent.ok) return parent;
      const index = readIndex(edit.index);
      if (!index.ok) return index;
      const node = nodes.find((item) => item.id === nodeId.nodeId);
      if (!node || !original.has(node.id)) return { ok: false, reason: '找不到这个节点' };
      const resolved = resolveParentId(parent.parent, refs, nodes);
      if (!resolved.ok) return resolved;
      const placed = relocate(nodes, node.id, resolved.parentId, index.index);
      if (!placed.ok) return placed;
      steps.push({
        op: 'move',
        nodeId: node.id,
        parent: parent.parent,
        ...(index.index !== undefined ? { index: index.index } : {}),
      });
      continue;
    }

    if (edit.op === 'delete_text') {
      const nodeId = readNodeId(edit.nodeId);
      if (!nodeId.ok) return nodeId;
      const node = nodes.find((item) => item.id === nodeId.nodeId);
      if (!node || !original.has(node.id)) return { ok: false, reason: '找不到这个节点' };
      if (node.kind !== 'text') return { ok: false, reason: '只能删除章节文本' };
      const detached = planOutlineDetach(nodes, node.id);
      applyShifts(nodes, detached.moves);
      const removeAt = nodes.findIndex((item) => item.id === node.id);
      if (removeAt >= 0) nodes.splice(removeAt, 1);
      steps.push({ op: 'delete_text', nodeId: node.id });
      continue;
    }

    return { ok: false, reason: '不认识这个操作' };
  }

  return {
    ok: true,
    steps,
    nodes,
    createdCount: steps.filter((step) => step.op === 'create_text').length,
    highlightCount: steps.filter((step) => step.op === 'create_highlight').length,
    renamedCount: steps.filter((step) => step.op === 'rename_text').length,
    movedCount: steps.filter((step) => step.op === 'move').length,
    deletedCount: steps.filter((step) => step.op === 'delete_text').length,
  };
}

function oneLine(label: string, max = 80): string {
  const flat = label.replace(/\s+/g, ' ').trim();
  const chars = [...(flat || '（无）')];
  return chars.length <= max ? chars.join('') : chars.slice(0, max).join('');
}

/** 给模型看的整棵脑图。每行一个节点，缩进表示层级。 */
export function formatDocumentMind(input: {
  documentId: string;
  title: string;
  nodes: readonly MindTreeNode[];
  maxChars?: number;
}): { text: string; truncated: boolean } {
  const header = `《${input.title}》（${input.documentId}）`;
  const children = new Map<string | null, MindTreeNode[]>();
  for (const node of input.nodes) {
    const list = children.get(node.parentId) ?? [];
    list.push(node);
    children.set(node.parentId, list);
  }
  for (const list of children.values()) {
    list.sort((a, b) => a.position - b.position || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  const lines: string[] = [];
  const seen = new Set<string>();
  const walk = (parentId: string | null, depth: number) => {
    for (const node of children.get(parentId) ?? []) {
      if (seen.has(node.id)) continue;
      seen.add(node.id);
      const pad = '  '.repeat(Math.min(depth, CARD_OUTLINE_MAX_DEPTH));
      const parent = node.parentId ?? '-';
      lines.push(
        `${pad}${KIND_LABEL[node.kind]} ${oneLine(node.label)} id=${node.id} parent=${parent}`,
      );
      walk(node.id, depth + 1);
    }
  };
  walk(null, 0);
  for (const node of input.nodes) {
    if (seen.has(node.id)) continue;
    const parent = node.parentId ?? '-';
    lines.push(`${KIND_LABEL[node.kind]} ${oneLine(node.label)} id=${node.id} parent=${parent}`);
    seen.add(node.id);
    walk(node.id, 1);
  }

  if (lines.length === 0) return { text: `${header}\n（脑图是空的）`, truncated: false };

  const maxChars = input.maxChars ?? 12_000;
  const kept: string[] = [];
  let used = [...header].length + 1;
  for (const line of lines) {
    const next = used + [...line].length + 1;
    if (kept.length > 0 && next > maxChars) break;
    kept.push(line);
    used = next;
  }
  const hidden = lines.length - kept.length;
  if (hidden > 0) kept.push(`还有 ${String(hidden)} 个节点没有列出。`);
  return { text: [header, ...kept].join('\n'), truncated: hidden > 0 };
}
