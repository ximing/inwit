import type { CanvasMember } from '@inwit/dto';
import type { MindBox } from './mindmap-layout';

/** 画布的平移缩放。 */
export type ViewTransform = { panX: number; panY: number; zoom: number };
export type Size = { width: number; height: number };

/**
 * 选中节点的祖先链、自己和整棵子树。
 * 聚焦弱化时这些节点和它们之间的连线保持清晰，其余降透明度。
 */
export function mindRelated(members: readonly CanvasMember[], id: string): Set<string> {
  const parentOf = new Map(members.map((member) => [member.id, member.parentId]));
  const related = new Set<string>([id]);
  let cursor = parentOf.get(id) ?? null;
  while (cursor && !related.has(cursor)) {
    related.add(cursor);
    cursor = parentOf.get(cursor) ?? null;
  }
  const kids = new Map<string, string[]>();
  for (const member of members) {
    if (!member.parentId) continue;
    const list = kids.get(member.parentId) ?? [];
    list.push(member.id);
    kids.set(member.parentId, list);
  }
  const stack = [...(kids.get(id) ?? [])];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    if (related.has(current)) continue;
    related.add(current);
    stack.push(...(kids.get(current) ?? []));
  }
  return related;
}

export type LinksPanelAnchor = {
  left: number;
  top: number;
  side: 'right' | 'left' | 'bottom' | 'top';
  /** 连接线起点：节点朝向面板那一边的中点（屏幕坐标）。 */
  fromX: number;
  fromY: number;
  /** 连接线终点：面板朝向节点那一边的中点（屏幕坐标）。 */
  toX: number;
  toY: number;
};

/**
 * 脉络浮层的屏幕坐标落点。优先放节点右侧，右边不如左边宽敞就放左边；
 * 两边都放不下时放下方（下方不如上方宽敞就放上方），并整体夹进舞台。
 * 尺寸是估算值，实际高度由内容决定。
 */
export function linksPanelAnchor(
  box: MindBox,
  view: ViewTransform,
  stage: Size,
  panel: Size,
  gap = 14,
): LinksPanelAnchor {
  const nodeRight = (box.x + box.width) * view.zoom + view.panX;
  const nodeLeft = box.x * view.zoom + view.panX;
  const nodeMidY = (box.y + box.height / 2) * view.zoom + view.panY;
  const nodeMidX = (box.x + box.width / 2) * view.zoom + view.panX;
  const nodeBottom = (box.y + box.height) * view.zoom + view.panY;
  const nodeTop = box.y * view.zoom + view.panY;
  const clampLeft = (left: number) =>
    Math.min(Math.max(left, 8), Math.max(8, stage.width - 8 - panel.width));
  const clampTop = (top: number) =>
    Math.min(Math.max(top, 8), Math.max(8, stage.height - 8 - panel.height));

  const roomRight = stage.width - 8 - (nodeRight + gap);
  const roomLeft = nodeLeft - gap - 8;
  if (roomRight >= panel.width || roomLeft >= panel.width) {
    const side = roomRight >= panel.width || roomRight >= roomLeft ? 'right' : 'left';
    const left = clampLeft(side === 'right' ? nodeRight + gap : nodeLeft - gap - panel.width);
    const top = clampTop(nodeMidY - panel.height / 2);
    const fromX = side === 'right' ? nodeRight : nodeLeft;
    const toX = side === 'right' ? left : left + panel.width;
    return { left, top, side, fromX, fromY: nodeMidY, toX, toY: top + panel.height / 2 };
  }

  const roomBelow = stage.height - 8 - (nodeBottom + gap);
  const roomAbove = nodeTop - gap - 8;
  const side = roomBelow >= panel.height || roomBelow >= roomAbove ? 'bottom' : 'top';
  const left = clampLeft(nodeMidX - panel.width / 2);
  const top = clampTop(side === 'bottom' ? nodeBottom + gap : nodeTop - gap - panel.height);
  const fromY = side === 'bottom' ? nodeBottom : nodeTop;
  const toY = side === 'bottom' ? top : top + panel.height;
  const toX = Math.min(Math.max(nodeMidX, left), left + panel.width);
  return { left, top, side, fromX: nodeMidX, fromY, toX, toY };
}

/** 世界坐标到小地图的缩放与偏移。 */
export type MinimapFrame = { scale: number; offsetX: number; offsetY: number };

export function minimapFrame(world: Size, map: Size, pad = 8): MinimapFrame {
  const w = Math.max(world.width, 1);
  const h = Math.max(world.height, 1);
  const scale = Math.min((map.width - pad * 2) / w, (map.height - pad * 2) / h);
  return {
    scale,
    offsetX: (map.width - w * scale) / 2,
    offsetY: (map.height - h * scale) / 2,
  };
}

/** 当前视口在小地图上的矩形。 */
export function minimapViewport(
  view: ViewTransform,
  stage: Size,
  frame: MinimapFrame,
): { x: number; y: number; width: number; height: number } {
  return {
    x: (-view.panX / view.zoom) * frame.scale + frame.offsetX,
    y: (-view.panY / view.zoom) * frame.scale + frame.offsetY,
    width: (stage.width / view.zoom) * frame.scale,
    height: (stage.height / view.zoom) * frame.scale,
  };
}

/** 点小地图某处，返回把该处对应的世界点移到视口中央所需的平移。 */
export function minimapCenter(
  mapX: number,
  mapY: number,
  frame: MinimapFrame,
  view: ViewTransform,
  stage: Size,
): { panX: number; panY: number } {
  const worldX = (mapX - frame.offsetX) / frame.scale;
  const worldY = (mapY - frame.offsetY) / frame.scale;
  return {
    panX: stage.width / 2 - worldX * view.zoom,
    panY: stage.height / 2 - worldY * view.zoom,
  };
}

/** 卡片待办：待确认优先，其次到期复习。已熟悉（suspended）不算待办。 */
export type MindCardTodo = 'confirm' | 'review';

export function mindCardTodo(
  card: { acceptance: string; review: { dueAt: string; suspendedAt: string | null } | null },
  now: number,
): MindCardTodo | null {
  if (card.acceptance === 'proposed') return 'confirm';
  if (!card.review || card.review.suspendedAt) return null;
  const due = Date.parse(card.review.dueAt);
  return Number.isFinite(due) && due <= now ? 'review' : null;
}

/** 每个节点的子树（含自己）里有多少张待办卡片；没有待办的节点不在结果里。 */
export function mindTodoCounts(
  members: readonly CanvasMember[],
  todos: ReadonlyMap<string, MindCardTodo>,
): Map<string, number> {
  const parentOf = new Map(members.map((member) => [member.id, member.parentId]));
  const counts = new Map<string, number>();
  for (const id of todos.keys()) {
    let cursor: string | null = id;
    const seen = new Set<string>();
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor);
      counts.set(cursor, (counts.get(cursor) ?? 0) + 1);
      cursor = parentOf.get(cursor) ?? null;
    }
  }
  return counts;
}

/** 框选：中心落在矩形里的节点，按传入顺序返回。 */
export function mindMarqueeHits(
  boxes: readonly MindBox[],
  a: { x: number; y: number },
  b: { x: number; y: number },
): string[] {
  const left = Math.min(a.x, b.x);
  const right = Math.max(a.x, b.x);
  const top = Math.min(a.y, b.y);
  const bottom = Math.max(a.y, b.y);
  return boxes
    .filter((box) => {
      const cx = box.x + box.width / 2;
      const cy = box.y + box.height / 2;
      return cx >= left && cx <= right && cy >= top && cy <= bottom;
    })
    .map((box) => box.id);
}

/** 画布内搜索：大小写不敏感的包含匹配，保持传入顺序。 */
export function mindSearchIds(
  entries: readonly (readonly [string, string])[],
  query: string,
): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return entries.filter(([, text]) => text.toLowerCase().includes(q)).map(([id]) => id);
}

/**
 * 拖拽接近视口边缘时的单步平移量，越靠边越快。
 * 指针在舞台左边沿时返回正的 dx（世界右移，露出左侧内容）。
 */
export function edgeAutoPan(
  point: { x: number; y: number },
  stage: Size,
  margin = 28,
  maxSpeed = 16,
): { dx: number; dy: number } | null {
  const ramp = (overflow: number) => Math.ceil(Math.min(1, overflow / margin) * maxSpeed);
  let dx = 0;
  let dy = 0;
  if (point.x < margin) dx = ramp(margin - point.x);
  else if (point.x > stage.width - margin) dx = -ramp(point.x - (stage.width - margin));
  if (point.y < margin) dy = ramp(margin - point.y);
  else if (point.y > stage.height - margin) dy = -ramp(point.y - (stage.height - margin));
  return dx !== 0 || dy !== 0 ? { dx, dy } : null;
}
