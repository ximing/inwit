import { MAP_MAX_DEPTH } from '@inwit/dto';

export class OutlineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OutlineError';
  }
}

export interface OutlineNodeInput {
  id?: string;
  title: string;
  note?: string | null;
  uncovered?: boolean;
  cardIds?: string[];
  documentIds?: string[];
  children?: OutlineNodeInput[];
}

export interface FlatOutlineNode {
  key: string;
  id: string | null;
  title: string;
  note: string | null;
  uncovered: boolean;
  cardIds: string[];
  documentIds: string[];
  parentKey: string | null;
  depth: number;
  position: number;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function blankToNull(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function uniqueIds(label: string, ids: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of ids) {
    const id = raw.trim();
    if (!UUID_RE.test(id)) {
      throw new OutlineError(`${label} 不是合法 id：${id}`);
    }
    if (seen.has(id)) {
      throw new OutlineError(`${label} 重复：${id}（一张卡/一份资料只能挂在一个节点）`);
    }
    seen.add(id);
    out.push(id);
  }
  return out;
}

function walk(
  nodes: OutlineNodeInput[],
  parentKey: string | null,
  depth: number,
): FlatOutlineNode[] {
  if (depth > MAP_MAX_DEPTH) {
    throw new OutlineError(`知识地图不能超过 ${String(MAP_MAX_DEPTH)} 级`);
  }
  const out: FlatOutlineNode[] = [];
  nodes.forEach((node, position) => {
    const title = node.title.trim();
    if (title.length === 0) {
      throw new OutlineError('节点标题不能为空');
    }
    const key = parentKey === null ? `r${String(position)}` : `${parentKey}.${String(position)}`;
    const id = blankToNull(node.id);
    if (id && !UUID_RE.test(id)) {
      throw new OutlineError(`节点 id 不合法：${id}；新建节点请省略 id`);
    }
    const cardIds = uniqueIds('cardId', node.cardIds ?? []);
    const documentIds = uniqueIds('documentId', node.documentIds ?? []);
    const uncovered = node.uncovered === true;
    if (uncovered && cardIds.length > 0) {
      throw new OutlineError(`空白节点「${title}」不能挂卡片；先不要标 uncovered，或把卡移走`);
    }
    out.push({
      key,
      id,
      title,
      note: blankToNull(node.note),
      uncovered,
      cardIds,
      documentIds,
      parentKey,
      depth,
      position,
    });
    if (node.children && node.children.length > 0) {
      out.push(...walk(node.children, key, depth + 1));
    }
  });
  return out;
}

export function flattenOutline(roots: OutlineNodeInput[]): FlatOutlineNode[] {
  const flat = walk(roots, null, 1);
  const usedIds = new Set<string>();
  const usedCards = new Set<string>();
  const usedDocs = new Set<string>();
  for (const node of flat) {
    if (node.id) {
      if (usedIds.has(node.id)) {
        throw new OutlineError(`节点 id 重复：${node.id}`);
      }
      usedIds.add(node.id);
    }
    for (const cardId of node.cardIds) {
      if (usedCards.has(cardId)) {
        throw new OutlineError(`卡片 ${cardId} 被挂到了多个节点`);
      }
      usedCards.add(cardId);
    }
    for (const documentId of node.documentIds) {
      if (usedDocs.has(documentId)) {
        throw new OutlineError(`资料 ${documentId} 被挂到了多个节点`);
      }
      usedDocs.add(documentId);
    }
  }
  return flat;
}

export function collectOutlineAttachments(flat: FlatOutlineNode[]): {
  cardIds: Set<string>;
  documentIds: Set<string>;
} {
  const cardIds = new Set<string>();
  const documentIds = new Set<string>();
  for (const node of flat) {
    for (const id of node.cardIds) cardIds.add(id);
    for (const id of node.documentIds) documentIds.add(id);
  }
  return { cardIds, documentIds };
}

export function droppedAttachments(opts: {
  previouslyAttachedCardIds: readonly string[];
  previouslyAttachedDocumentIds: readonly string[];
  nextCardIds: ReadonlySet<string>;
  nextDocumentIds: ReadonlySet<string>;
}): { cards: string[]; documents: string[] } {
  const cards = opts.previouslyAttachedCardIds.filter((id) => !opts.nextCardIds.has(id));
  const documents = opts.previouslyAttachedDocumentIds.filter((id) => !opts.nextDocumentIds.has(id));
  return { cards, documents };
}

export type PlaceTarget =
  | { kind: 'existing'; nodeId: string }
  | { kind: 'new'; title: string; parentId: string | null };

export function parsePlaceOnMapTarget(input: {
  nodeId?: string;
  newNode?: { title: string; parentId?: string };
}): PlaceTarget {
  const nodeId = blankToNull(input.nodeId);
  const newNode = input.newNode;
  if (nodeId && newNode) {
    throw new OutlineError('place_on_map 只能传 nodeId 或 newNode，不要两个都传');
  }
  if (nodeId) {
    if (!UUID_RE.test(nodeId)) throw new OutlineError('nodeId 不合法');
    return { kind: 'existing', nodeId };
  }
  if (!newNode) {
    throw new OutlineError('place_on_map 需要 nodeId 或 newNode');
  }
  const title = newNode.title.trim();
  if (title.length === 0) throw new OutlineError('新节点标题不能为空');
  const parentId = blankToNull(newNode.parentId);
  if (parentId && !UUID_RE.test(parentId)) throw new OutlineError('newNode.parentId 不合法');
  return { kind: 'new', title, parentId };
}
