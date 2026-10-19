/**
 * 工作区状态协议（T8a）：布局用 localStorage（本机偏好）。
 * 结构 / 概念 / 对照、排列和分隔比例按用户全局保留。
 * 视口仍按 用户+文章+主题。未提交表单用 sessionStorage。
 * 存储不可用时退回内存并标记。
 */

export interface ViewportState {
  x: number;
  y: number;
  zoom: number;
}

export type StudyMode = 'outline' | 'concepts' | 'compare';
export type StudyArrangement = 'stacked' | 'columns';

export interface WorkspaceLayoutState {
  preferredMode: StudyMode;
  arrangement: StudyArrangement;
  /** 正文占学习区外的比例（0.2–0.6）。 */
  mainRatio: number;
  /** 对照时脑图占学习区高度的比例（0.2–0.8）。 */
  dockRatio: number;
  /** 临时放大：哪个面板被放大；null = 正常布局。 */
  zoomedPane: 'outline' | 'concepts' | null;
}

export const DEFAULT_LAYOUT: WorkspaceLayoutState = {
  preferredMode: 'outline',
  arrangement: 'stacked',
  mainRatio: 0.62,
  dockRatio: 0.5,
  zoomedPane: null,
};

const LAYOUT_KEY_PREFIX = 'inwit-study-layout-v1:';
const VIEWPORT_KEY_PREFIX = 'inwit-study-viewport-v1:';
const DRAFT_KEY_PREFIX = 'inwit-study-draft-v1:';
const LRU_INDEX_KEY = 'inwit-study-lru-v1';
const LRU_LIMIT = 50;

export function layoutStorageKey(userId: string): string {
  return `${LAYOUT_KEY_PREFIX}${userId}`;
}

/** 视口按 用户+文章+主题 隔离（viewKey 区分 outline/concepts/candidate）。 */
export function viewportStorageKey(userId: string, scopeId: string, viewKey: string): string {
  return `${VIEWPORT_KEY_PREFIX}${userId}:${scopeId}:${viewKey}`;
}

export function draftStorageKey(userId: string, scopeId: string, draftKey: string): string {
  return `${DRAFT_KEY_PREFIX}${userId}:${scopeId}:${draftKey}`;
}

interface StorageLike {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function safeStorage(kind: 'local' | 'session'): StorageLike | null {
  try {
    const storage = kind === 'local' ? window.localStorage : window.sessionStorage;
    const probe = `inwit-probe-${Math.random()}`;
    storage.setItem(probe, '1');
    storage.removeItem(probe);
    return storage;
  } catch {
    return null;
  }
}

export function loadJson<T>(storage: StorageLike | null, key: string): T | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function saveJson(storage: StorageLike | null, key: string, value: unknown): boolean {
  if (!storage) return false;
  try {
    storage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export interface StoredWorkspaceState {
  /** 旧数据：按文章存的布局。只用来在没有全局布局时迁移一次。 */
  layouts: Record<string, WorkspaceLayoutState>;
  /** 结构 / 概念 / 对照、排列和分隔比例。全账号一份，不随文章变。 */
  layout?: WorkspaceLayoutState;
  viewports: Record<string, ViewportState>;
}

export function loadWorkspaceState(
  userId: string,
  storage: StorageLike | null = safeStorage('local'),
): StoredWorkspaceState {
  const fallback = { layouts: {}, viewports: {} };
  const loaded = loadJson<StoredWorkspaceState>(storage, layoutStorageKey(userId));
  if (!loaded || typeof loaded !== 'object') return fallback;
  const layout = loaded.layout;
  return {
    layouts: loaded.layouts && typeof loaded.layouts === 'object' ? loaded.layouts : {},
    ...(layout && typeof layout === 'object' ? { layout } : {}),
    viewports: loaded.viewports && typeof loaded.viewports === 'object' ? loaded.viewports : {},
  };
}

export function saveWorkspaceState(
  userId: string,
  state: StoredWorkspaceState,
  storage: StorageLike | null = safeStorage('local'),
): boolean {
  if (!saveJson(storage, layoutStorageKey(userId), state)) return false;
  touchLru(userId, storage);
  return true;
}

/** 最近使用的用户 key（LRU 50）。 */
function touchLru(userId: string, storage: StorageLike | null): void {
  if (!storage) return;
  const lru = loadJson<string[]>(storage, LRU_INDEX_KEY) ?? [];
  const next = [userId, ...lru.filter((id) => id !== userId)].slice(0, LRU_LIMIT);
  saveJson(storage, LRU_INDEX_KEY, next);
  for (const stale of lru.slice(LRU_LIMIT)) {
    if (!next.includes(stale)) storage.removeItem(layoutStorageKey(stale));
  }
}

export function clearWorkspaceStateForUser(
  userId: string,
  storage: StorageLike | null = safeStorage('local'),
): void {
  storage?.removeItem(layoutStorageKey(userId));
}

/** sessionStorage 草稿（当前标签；退出登录由调用方按用户清）。 */
export function loadDraft<T>(
  userId: string,
  scopeId: string,
  draftKey: string,
  storage: StorageLike | null = safeStorage('session'),
): T | null {
  return loadJson<T>(storage, draftStorageKey(userId, scopeId, draftKey));
}

export function saveDraft(
  userId: string,
  scopeId: string,
  draftKey: string,
  value: unknown,
  storage: StorageLike | null = safeStorage('session'),
): boolean {
  return saveJson(storage, draftStorageKey(userId, scopeId, draftKey), value);
}

export function clearDraftsForUser(
  userId: string,
  storage: StorageLike | null = safeStorage('session'),
): void {
  if (!storage) return;
  // sessionStorage 无按前缀枚举的安全 API 之外的途径；直接遍历删除。
  const prefix = `${DRAFT_KEY_PREFIX}${userId}:`;
  const doomed: string[] = [];
  for (let i = 0; i < storage.length; i += 1) {
    const key = storage.key(i);
    if (key?.startsWith(prefix)) doomed.push(key);
  }
  for (const key of doomed) storage.removeItem(key);
}
