import type { CanvasSnapshot, CanvasSnapshotAnnotation, CanvasSnapshotNode } from '@inwit/dto';

/** 一篇文档保留的脑图版本数，含「开始记录之前」。 */
export const CANVAS_HISTORY_LIMIT = 40;

export const CANVAS_HISTORY_BASELINE = '开始记录之前';

export type CanvasRestorePlan = {
  /** 目标版本里应存在的行。父节点不在这批里时已改成根。 */
  final: CanvasSnapshotNode[];
  deleteIds: string[];
  insert: CanvasSnapshotNode[];
  /** 已在库里、但父级、顺序或文字和目标不同的行。 */
  update: CanvasSnapshotNode[];
};

type LiveMembers = {
  cardIds: ReadonlySet<string>;
  annotationIds: ReadonlySet<string>;
};

function byId(a: CanvasSnapshotNode, b: CanvasSnapshotNode): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function sameNode(a: CanvasSnapshotNode, b: CanvasSnapshotNode): boolean {
  return (
    a.id === b.id &&
    a.kind === b.kind &&
    a.cardId === b.cardId &&
    a.annotationId === b.annotationId &&
    a.text === b.text &&
    a.imageKey === b.imageKey &&
    a.parentId === b.parentId &&
    a.position === b.position
  );
}

export function canvasSnapshotsEqual(
  before: readonly CanvasSnapshotNode[],
  after: readonly CanvasSnapshotNode[],
): boolean {
  if (before.length !== after.length) return false;
  const left = [...before].sort(byId);
  const right = [...after].sort(byId);
  return left.every((node, index) => sameNode(node, right[index]!));
}

function placementChanged(before: CanvasSnapshotNode, after: CanvasSnapshotNode): boolean {
  return (
    before.parentId !== after.parentId ||
    before.position !== after.position ||
    before.imageKey !== after.imageKey
  );
}

/**
 * 两版画布行的差异。没有变化时返回 null。
 * 新出现或消失的卡片、批注行算作移动（落位或回到根），不算新建章节。
 */
export function describeCanvasChange(
  before: readonly CanvasSnapshotNode[],
  after: readonly CanvasSnapshotNode[],
): string | null {
  const beforeById = new Map(before.map((node) => [node.id, node]));
  const afterById = new Map(after.map((node) => [node.id, node]));
  let createdText = 0;
  let createdImage = 0;
  let renamed = 0;
  let moved = 0;
  let deletedText = 0;
  let deletedImage = 0;

  for (const node of after) {
    const prev = beforeById.get(node.id);
    if (!prev) {
      if (node.kind === 'text') createdText += 1;
      else if (node.kind === 'image') createdImage += 1;
      else moved += 1;
      continue;
    }
    if (node.kind === 'text' && node.text !== prev.text) renamed += 1;
    if (placementChanged(prev, node)) moved += 1;
  }
  for (const node of before) {
    if (afterById.has(node.id)) continue;
    if (node.kind === 'text') deletedText += 1;
    else if (node.kind === 'image') deletedImage += 1;
    else moved += 1;
  }

  const summary = [
    createdText > 0 ? `新建 ${createdText} 个章节` : null,
    createdImage > 0 ? `加了 ${createdImage} 张图片` : null,
    renamed > 0 ? `改了 ${renamed} 个章节标题` : null,
    moved > 0 ? `移动 ${moved} 个节点` : null,
    deletedText > 0 ? `删除 ${deletedText} 个章节` : null,
    deletedImage > 0 ? `去掉 ${deletedImage} 张图片` : null,
  ].filter((item): item is string => item !== null);
  return summary.length > 0 ? summary.join('，') : null;
}

function keepNode(node: CanvasSnapshotNode, live: LiveMembers): boolean {
  if (node.kind === 'card') return live.cardIds.has(node.id);
  if (node.kind === 'annotation') return live.annotationIds.has(node.id);
  if (node.kind === 'text') return Boolean(node.text && node.text.trim());
  return Boolean(node.imageKey && node.imageKey.trim());
}

/** 把当前画布行恢复成目标快照。已经不在的卡片和批注不会被重新造出来。 */
export function planCanvasRestore(
  current: readonly CanvasSnapshotNode[],
  target: readonly CanvasSnapshotNode[],
  live: LiveMembers,
): CanvasRestorePlan {
  const currentById = new Map(current.map((node) => [node.id, node]));
  const kept = target.filter((node) => keepNode(node, live));
  const ids = new Set(kept.map((node) => node.id));
  const final = kept.map((node) => ({
    ...node,
    parentId: node.parentId && ids.has(node.parentId) && node.parentId !== node.id ? node.parentId : null,
  }));
  const finalById = new Map(final.map((node) => [node.id, node]));
  return {
    final,
    deleteIds: current.filter((node) => !finalById.has(node.id)).map((node) => node.id),
    insert: final.filter((node) => !currentById.has(node.id)),
    update: final.filter((node) => {
      const prev = currentById.get(node.id);
      return prev !== undefined && !sameNode(prev, node);
    }),
  };
}

/** 恢复之后，卡片脉络要跟画布父级对齐。父级不是卡片时，脉络父级为空。 */
export function cardOutlinesAfterRestore(
  current: readonly CanvasSnapshotNode[],
  final: readonly CanvasSnapshotNode[],
): Array<{ id: string; parentId: string | null; position: number }> {
  const finalById = new Map(final.map((node) => [node.id, node]));
  const outlines: Array<{ id: string; parentId: string | null; position: number }> = [];
  for (const node of final) {
    if (node.kind !== 'card') continue;
    const parent = node.parentId ? finalById.get(node.parentId) : null;
    outlines.push({
      id: node.id,
      parentId: parent?.kind === 'card' ? parent.id : null,
      position: node.position,
    });
  }
  for (const node of current) {
    if (node.kind !== 'card' || finalById.has(node.id)) continue;
    outlines.push({ id: node.id, parentId: null, position: 0 });
  }
  return outlines;
}

export type CanvasHistoryState = {
  nodes: readonly CanvasSnapshotNode[];
  annotations: readonly CanvasSnapshotAnnotation[];
};

export type NormalizedCanvasSnapshot = {
  nodes: readonly CanvasSnapshotNode[];
  /** null：旧版快照没记批注，恢复时不动批注。 */
  annotations: readonly CanvasSnapshotAnnotation[] | null;
};

export function normalizeCanvasSnapshot(value: CanvasSnapshot): NormalizedCanvasSnapshot {
  if (Array.isArray(value)) return { nodes: value, annotations: null };
  return value;
}

/** 画布行一致，且快照里的每条批注都还在、文字也没变。多出来的批注不妨碍标成当前。 */
export function canvasRevisionMatches(
  stored: NormalizedCanvasSnapshot,
  live: CanvasHistoryState,
): boolean {
  if (!canvasSnapshotsEqual(stored.nodes, live.nodes)) return false;
  if (!stored.annotations) return true;
  const liveById = new Map(live.annotations.map((note) => [note.id, note]));
  return stored.annotations.every((note) => {
    const current = liveById.get(note.id);
    if (!current || current.note !== note.note || current.imageKey !== note.imageKey) return false;
    if (note.quote !== undefined && current.quote !== note.quote) return false;
    if (
      note.anchorBlockIndex !== undefined &&
      (current.anchorBlockIndex ?? null) !== note.anchorBlockIndex
    ) {
      return false;
    }
    return true;
  });
}

function annotationRowIds(nodes: readonly CanvasSnapshotNode[]): Set<string> {
  const ids = new Set<string>();
  for (const node of nodes) {
    if (node.kind === 'annotation') ids.add(node.id);
  }
  return ids;
}

function withExtraMoves(summary: string | null, extra: number): string | null {
  if (extra === 0) return summary;
  if (!summary) return `移动 ${extra} 个节点`;
  const matched = /移动 (\d+) 个节点/.exec(summary);
  if (!matched) return `${summary}，移动 ${extra} 个节点`;
  const total = Number(matched[1]) + extra;
  return summary.replace(/移动 \d+ 个节点/, `移动 ${total} 个节点`);
}

/**
 * 画布行和批注放在一起看。
 * 同一次里既多了批注、又多了它的画布行，只算一次移动。
 */
export function describeHistoryChange(
  before: CanvasHistoryState,
  after: CanvasHistoryState,
): string | null {
  const beforeNotes = new Map(before.annotations.map((note) => [note.id, note]));
  const afterNotes = new Map(after.annotations.map((note) => [note.id, note]));
  const beforeRows = annotationRowIds(before.nodes);
  const afterRows = annotationRowIds(after.nodes);
  let edited = 0;
  let extraMoves = 0;
  for (const [id, note] of afterNotes) {
    const prev = beforeNotes.get(id);
    if (!prev) {
      if (!(afterRows.has(id) && !beforeRows.has(id))) extraMoves += 1;
      continue;
    }
    if (
      prev.note !== note.note ||
      prev.imageKey !== note.imageKey ||
      prev.quote !== note.quote ||
      (prev.anchorBlockIndex ?? null) !== (note.anchorBlockIndex ?? null)
    ) {
      edited += 1;
    }
  }
  for (const id of beforeNotes.keys()) {
    if (afterNotes.has(id)) continue;
    if (!(beforeRows.has(id) && !afterRows.has(id))) extraMoves += 1;
  }
  const summary = withExtraMoves(describeCanvasChange(before.nodes, after.nodes), extraMoves);
  if (edited === 0) return summary;
  const editedLabel = `改了 ${edited} 条批注`;
  return summary ? `${summary}，${editedLabel}` : editedLabel;
}

/**
 * 目标版本记了批注名单时，名单外还在的批注要进回收站。
 * 这样恢复后不会留下这一版之后才出现的想法或高亮。旧名单为空时不动批注。
 */
export function planAnnotationRestore(
  liveIds: readonly string[],
  target: readonly { id: string }[] | null,
): string[] {
  if (!target) return [];
  const keep = new Set(target.map((note) => note.id));
  return liveIds.filter((id) => !keep.has(id)).sort();
}

export function restoreCanvasSummary(summary: string, createdAt: Date): string {
  if (summary === CANVAS_HISTORY_BASELINE) return '恢复到开始记录之前';
  const label = new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(createdAt);
  return `恢复到 ${label} 的脑图`;
}
