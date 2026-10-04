/** Canonical paths. App.tsx, Layout, and guards must use these. */
export const ROUTES = {
  home: '/',
  login: '/login',
  docs: '/docs',
  review: '/review',
  topics: '/topics',
  topic: '/topics/:id',
  jobs: '/jobs',
  memory: '/memory',
  settings: '/settings',
} as const;

export const SETTINGS_SECTIONS = [
  'profile',
  'appearance',
  'models',
  'ocr',
  'token',
  'archive',
  'files',
] as const;

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

export function isSettingsSection(value: string | undefined): value is SettingsSection {
  return SETTINGS_SECTIONS.some((section) => section === value);
}

/** One settings screen. `pane=logs` opens 接口令牌 → 调用日志. */
export function settingsPath(section: SettingsSection = 'profile', opts?: { pane?: 'logs' }): string {
  const path = `${ROUTES.settings}/${section}`;
  if (section === 'token' && opts?.pane === 'logs') return `${path}?pane=logs`;
  return path;
}

export function docsPath(
  docId?: string,
  opts?: { edit?: boolean; anchor?: string; annotation?: string; fromTopic?: string | null },
): string {
  const fromTopic = opts?.fromTopic || undefined;
  if (!docId && !opts?.edit && !opts?.anchor && !opts?.annotation && !fromTopic) return ROUTES.docs;
  const params = new URLSearchParams();
  if (docId) params.set('doc', docId);
  if (opts?.edit) params.set('edit', '1');
  if (opts?.anchor) params.set('anchor', opts.anchor);
  if (opts?.annotation) params.set('annotation', opts.annotation);
  if (fromTopic) params.set('fromTopic', fromTopic);
  const qs = params.toString();
  return qs ? `${ROUTES.docs}?${qs}` : ROUTES.docs;
}

/** Entrance that should close back to a topic. Empty values are not an entrance. */
export function fromTopicOf(params: URLSearchParams): string | null {
  const value = params.get('fromTopic');
  return value && value.length > 0 ? value : null;
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

/** Open a document without leaving the topic page. */
export function topicDocPath(
  topicId: string,
  docId: string,
  opts?: { anchor?: string; annotation?: string },
): string {
  const params = new URLSearchParams();
  params.set('topic', topicId);
  params.set('doc', docId);
  if (opts?.anchor) params.set('anchor', opts.anchor);
  if (opts?.annotation) params.set('annotation', opts.annotation);
  return `${ROUTES.topics}?${params.toString()}`;
}

/** Topic page currently showing a document. Empty when the document lives on /docs. */
export function topicHostId(pathname: string, params: URLSearchParams): string | null {
  if (pathname !== ROUTES.topics) return null;
  const topic = params.get('topic');
  const doc = params.get('doc');
  if (!topic || !doc) return null;
  return topic;
}

/** Where the open document's close control should land. Hosted documents replace the current entry. */
export function documentReturnTarget(
  pathname: string,
  params: URLSearchParams,
): { path: string; replace: boolean } {
  const host = topicHostId(pathname, params);
  if (host) return { path: topicPath(host), replace: true };
  const fromTopic = fromTopicOf(params);
  if (fromTopic) return { path: topicPath(fromTopic), replace: false };
  return { path: ROUTES.docs, replace: false };
}

export function docPath(id: string): string {
  return docsPath(id);
}

export function cardPath(cardId: string, documentId?: string | null): string {
  if (documentId) return docAnchorPath(documentId, cardId);
  return ROUTES.review;
}

export function docAnchorPath(docId: string, cardId: string, fromTopic?: string | null): string {
  return docsPath(docId, { anchor: cardId, fromTopic });
}

export function docAnnotationPath(
  docId: string,
  annotationId: string,
  fromTopic?: string | null,
): string {
  return docsPath(docId, { annotation: annotationId, fromTopic });
}

export type AppRoute = (typeof ROUTES)[keyof typeof ROUTES];

export const PAGE_LIST: ReadonlyArray<{ path: AppRoute; title: string; auth: boolean }> = [
  { path: ROUTES.login, title: '登录 / 注册', auth: false },
  { path: ROUTES.home, title: '首页', auth: true },
  { path: ROUTES.docs, title: '文档', auth: true },
  { path: ROUTES.review, title: '复习', auth: true },
  { path: ROUTES.topics, title: '主题', auth: true },
  { path: ROUTES.jobs, title: '任务', auth: true },
  { path: ROUTES.memory, title: '记忆', auth: true },
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

export function jobsPath(opts?: {
  tab?: 'history';
  status?: string;
  type?: string;
  job?: string;
}): string {
  const params = new URLSearchParams();
  const history =
    opts?.tab === 'history' || Boolean(opts?.status) || Boolean(opts?.type) || Boolean(opts?.job);
  if (history) params.set('tab', 'history');
  if (opts?.status) params.set('status', opts.status);
  if (opts?.type) params.set('type', opts.type);
  if (opts?.job) params.set('job', opts.job);
  const qs = params.toString();
  return qs ? `${ROUTES.jobs}?${qs}` : ROUTES.jobs;
}
