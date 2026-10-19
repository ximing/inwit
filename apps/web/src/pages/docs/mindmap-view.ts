/** 脑图镜头和搜索。只活在这次打开里，切文章时收起，回来再放出来。 */

export interface MindView {
  panX: number;
  panY: number;
  zoom: number;
}

export interface MindCanvasSession {
  view: MindView;
  searchQuery: string;
  searchOpen: boolean;
  searchIndex: number;
  todoOnly: boolean;
}

export const DEFAULT_MIND_VIEW: MindView = { panX: 28, panY: 28, zoom: 1 };

export type MindMembership = 'same' | 'added' | 'removed' | 'reordered';

/** 可见节点 id 串（`id|id`）相对上一次是增、删、重排，还是没变。 */
export function mindMembership(previousKey: string, nextKey: string): MindMembership {
  if (previousKey === nextKey) return 'same';
  const previous = previousKey ? previousKey.split('|') : [];
  const next = nextKey ? nextKey.split('|') : [];
  const prevSet = new Set(previous);
  const nextSet = new Set(next);
  const added = next.some((id) => !prevSet.has(id));
  const removed = previous.some((id) => !nextSet.has(id));
  if (added || previous.length === 0) return 'added';
  if (removed) return 'removed';
  return 'reordered';
}

/** 镜头接下来怎么走：重新适配、按留下的节点稳住画面，或完全不动。 */
export type MindCameraFollow = 'refit' | 'hold' | 'keep';

/**
 * 删除或折叠后不要重新适配，否则高树会被放回顶部。
 * 第一次铺开、出现新节点，或用户还没自己挪过镜头时，才适配整棵树。
 */
export function mindCameraFollow(
  previousKey: string,
  nextKey: string,
  userMoved: boolean,
): MindCameraFollow {
  const membership = mindMembership(previousKey, nextKey);
  if (membership === 'added' || (membership === 'same' && !userMoved)) return 'refit';
  if (membership === 'removed' && userMoved) return 'hold';
  return 'keep';
}

export interface MindCameraBox {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * 删掉节点后，树会重新往上排。把当时最靠近视口中心、并且还在的节点留在屏幕原处。
 * 没有可锚定的节点，或它自己没动，就返回 null。
 */
export function mindViewAfterNodesRemoved(input: {
  previous: readonly MindCameraBox[];
  next: readonly MindCameraBox[];
  view: MindView;
  stage: { width: number; height: number };
}): MindView | null {
  const { view, stage } = input;
  if (stage.width < 40 || stage.height < 40 || view.zoom === 0) return null;
  const nextById = new Map(input.next.map((box) => [box.id, box]));
  const survivors = input.previous.filter((box) => nextById.has(box.id));
  if (survivors.length === 0) return null;
  const onScreen = (box: MindCameraBox) => {
    const left = box.x * view.zoom + view.panX;
    const top = box.y * view.zoom + view.panY;
    const right = left + box.width * view.zoom;
    const bottom = top + box.height * view.zoom;
    return right > 0 && bottom > 0 && left < stage.width && top < stage.height;
  };
  const visible = survivors.filter(onScreen);
  const pool = visible.length > 0 ? visible : survivors;
  const centerX = (stage.width / 2 - view.panX) / view.zoom;
  const centerY = (stage.height / 2 - view.panY) / view.zoom;
  let anchor = pool[0]!;
  let best = Number.POSITIVE_INFINITY;
  for (const box of pool) {
    const dist = Math.hypot(box.x + box.width / 2 - centerX, box.y + box.height / 2 - centerY);
    if (dist < best) {
      best = dist;
      anchor = box;
    }
  }
  const moved = nextById.get(anchor.id)!;
  const panX = view.panX + (anchor.x - moved.x) * view.zoom;
  const panY = view.panY + (anchor.y - moved.y) * view.zoom;
  if (panX === view.panX && panY === view.panY) return null;
  return { panX, panY, zoom: view.zoom };
}

const sessions = new Map<string, MindCanvasSession>();

export function emptyMindSession(): MindCanvasSession {
  return {
    view: { ...DEFAULT_MIND_VIEW },
    searchQuery: '',
    searchOpen: false,
    searchIndex: 0,
    todoOnly: false,
  };
}

export function rememberMindSession(documentId: string, session: MindCanvasSession): void {
  sessions.set(documentId, {
    ...session,
    view: { ...session.view },
  });
}

export function mindSessionFor(documentId: string | null): MindCanvasSession {
  if (!documentId) return emptyMindSession();
  const saved = sessions.get(documentId);
  if (!saved) return emptyMindSession();
  return { ...saved, view: { ...saved.view } };
}

export function resetMindSessions(): void {
  sessions.clear();
}
