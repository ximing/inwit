/** Canonical paths. App.tsx, Layout, and guards must use these. */
export const ROUTES = {
  home: '/',
  login: '/login',
  docs: '/docs',
  review: '/review',
  topics: '/topics',
  topic: '/topics/:id',
  jobs: '/jobs',
  settings: '/settings',
} as const;

export function docsPath(
  docId?: string,
  opts?: { edit?: boolean; anchor?: string; annotation?: string },
): string {
  if (!docId && !opts?.edit && !opts?.anchor && !opts?.annotation) return ROUTES.docs;
  const params = new URLSearchParams();
  if (docId) params.set('doc', docId);
  if (opts?.edit) params.set('edit', '1');
  if (opts?.anchor) params.set('anchor', opts.anchor);
  if (opts?.annotation) params.set('annotation', opts.annotation);
  const qs = params.toString();
  return qs ? `${ROUTES.docs}?${qs}` : ROUTES.docs;
}

export function editorPath(id: string): string {
  return docsPath(id, { edit: true });
}

export function editorNewPath(topicId?: string | null): string {
  const params = new URLSearchParams({ edit: '1' });
  if (topicId) params.set('topicId', topicId);
  return `${ROUTES.docs}?${params.toString()}`;
}

export function topicPath(id?: string): string {
  if (!id) return ROUTES.topics;
  const params = new URLSearchParams();
  params.set('topic', id);
  return `${ROUTES.topics}?${params.toString()}`;
}

export function docPath(id: string): string {
  return docsPath(id);
}

export function cardPath(cardId: string, documentId?: string | null): string {
  if (documentId) return docAnchorPath(documentId, cardId);
  return ROUTES.review;
}

export function docAnchorPath(docId: string, cardId: string): string {
  return docsPath(docId, { anchor: cardId });
}

export function docAnnotationPath(docId: string, annotationId: string): string {
  return docsPath(docId, { annotation: annotationId });
}

export type AppRoute = (typeof ROUTES)[keyof typeof ROUTES];

export const PAGE_LIST: ReadonlyArray<{ path: AppRoute; title: string; auth: boolean }> = [
  { path: ROUTES.login, title: '登录 / 注册', auth: false },
  { path: ROUTES.home, title: '首页', auth: true },
  { path: ROUTES.docs, title: '文档', auth: true },
  { path: ROUTES.review, title: '复习', auth: true },
  { path: ROUTES.topics, title: '主题', auth: true },
  { path: ROUTES.jobs, title: '任务', auth: true },
  { path: ROUTES.settings, title: '设置', auth: true },
];

/** Nested <Route path> under Layout (no leading slash). */
export function routeSegment(path: AppRoute): string {
  return path.replace(/^\//, '');
}

export function weeklyReportsPath(id?: string): string {
  const params = new URLSearchParams({ tab: 'reports' });
  if (id) params.set('report', id);
  return `${ROUTES.review}?${params.toString()}`;
}
