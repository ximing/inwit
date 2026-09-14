/** Canonical paths. App.tsx, Layout, and guards must use these. */
export const ROUTES = {
  home: '/',
  login: '/login',
  review: '/review',
  topics: '/topics',
  topic: '/topics/:id',
  settings: '/settings',
  admin: '/admin',
  editorNew: '/editor/new',
  editor: '/editor/:id',
  doc: '/doc/:id',
  card: '/cards/:id',
  captures: '/captures',
} as const;

export function editorPath(id: string): string {
  return `/editor/${id}`;
}

export function topicPath(id: string): string {
  return `/topics/${id}`;
}

export function docPath(id: string): string {
  return `/doc/${id}`;
}

export function cardPath(id: string): string {
  return `/cards/${id}`;
}

export function docAnchorPath(docId: string, cardId: string): string {
  return `${docPath(docId)}?anchor=${encodeURIComponent(cardId)}`;
}

export type AppRoute = (typeof ROUTES)[keyof typeof ROUTES];

export const PAGE_LIST: ReadonlyArray<{ path: AppRoute; title: string; auth: boolean }> = [
  { path: ROUTES.login, title: '登录 / 注册', auth: false },
  { path: ROUTES.home, title: '文档', auth: true },
  { path: ROUTES.review, title: '复习', auth: true },
  { path: ROUTES.topics, title: '主题', auth: true },
  { path: ROUTES.settings, title: '设置', auth: true },
  { path: ROUTES.admin, title: '任务与用量', auth: true },
];

/** Nested <Route path> under Layout (no leading slash). */
export function routeSegment(path: AppRoute): string {
  return path.replace(/^\//, '');
}
