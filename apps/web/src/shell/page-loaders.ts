import { resolve } from '@rabjs/react';
import { lazy } from 'react';
import { ROUTES } from '@/routes';
import { RouteLoadService } from './route-load.service';

export function loadLoginPage() {
  return import('@/pages/login');
}

export function loadTodayPage() {
  return import('@/pages/today');
}

export function loadDocsPage() {
  return import('@/pages/docs');
}

export function loadReviewPage() {
  return import('@/pages/review');
}

export function loadTopicsPage() {
  return import('@/pages/topics');
}

export function loadJobsPage() {
  return import('@/pages/jobs');
}

export function loadMemoryPage() {
  return import('@/pages/memory');
}

export function loadSettingsPage() {
  return import('@/pages/settings');
}

/**
 * 导航触发的 chunk 加载：上报 RouteLoadService（驱动进度条/nav pending），
 * 失败静默重试一次（弱网瞬断常见）；仍失败则抛给 RouteErrorBoundary。
 * 预取（hover/idle）不经过这里，避免预热触发加载反馈。
 */
function trackRoute<T>(load: () => Promise<T>): Promise<T> {
  const end = resolve(RouteLoadService).track();
  return load()
    .catch(() => load())
    .finally(end);
}

export const LoginPage = lazy(() =>
  trackRoute(loadLoginPage).then((mod) => ({ default: mod.LoginPage })),
);
export const TodayPage = lazy(() =>
  trackRoute(loadTodayPage).then((mod) => ({ default: mod.TodayPage })),
);
export const DocsPage = lazy(() =>
  trackRoute(loadDocsPage).then((mod) => ({ default: mod.DocsPage })),
);
export const ReviewPage = lazy(() =>
  trackRoute(loadReviewPage).then((mod) => ({ default: mod.ReviewPage })),
);
export const TopicsPage = lazy(() =>
  trackRoute(loadTopicsPage).then((mod) => ({ default: mod.TopicsPage })),
);
export const JobsPage = lazy(() =>
  trackRoute(loadJobsPage).then((mod) => ({ default: mod.JobsPage })),
);
export const MemoryPage = lazy(() =>
  trackRoute(loadMemoryPage).then((mod) => ({ default: mod.MemoryPage })),
);
export const SettingsPage = lazy(() =>
  trackRoute(loadSettingsPage).then((mod) => ({ default: mod.SettingsPage })),
);

const BY_PATH: Record<string, () => Promise<unknown>> = {
  [ROUTES.login]: loadLoginPage,
  [ROUTES.home]: loadTodayPage,
  [ROUTES.docs]: loadDocsPage,
  [ROUTES.review]: loadReviewPage,
  [ROUTES.topics]: loadTopicsPage,
  [ROUTES.jobs]: loadJobsPage,
  [ROUTES.memory]: loadMemoryPage,
  [ROUTES.settings]: loadSettingsPage,
};

export function prefetchPage(path: string): void {
  const load = BY_PATH[path];
  if (load) void load();
}

function saveDataEnabled(): boolean {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  return connection?.saveData === true;
}

/** After the shell paints, warm the two daily destinations. */
export function scheduleShellPrefetch(pathname: string): () => void {
  if (saveDataEnabled()) return () => {};
  const run = () => {
    if (pathname !== ROUTES.docs) prefetchPage(ROUTES.docs);
    if (pathname !== ROUTES.review) prefetchPage(ROUTES.review);
  };
  if (typeof window.requestIdleCallback === 'function') {
    const id = window.requestIdleCallback(run, { timeout: 2000 });
    return () => window.cancelIdleCallback(id);
  }
  const id = window.setTimeout(run, 400);
  return () => window.clearTimeout(id);
}
