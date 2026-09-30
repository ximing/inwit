import { lazy } from 'react';
import { ROUTES } from '@/routes';

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

export const LoginPage = lazy(() => loadLoginPage().then((mod) => ({ default: mod.LoginPage })));
export const TodayPage = lazy(() => loadTodayPage().then((mod) => ({ default: mod.TodayPage })));
export const DocsPage = lazy(() => loadDocsPage().then((mod) => ({ default: mod.DocsPage })));
export const ReviewPage = lazy(() => loadReviewPage().then((mod) => ({ default: mod.ReviewPage })));
export const TopicsPage = lazy(() => loadTopicsPage().then((mod) => ({ default: mod.TopicsPage })));
export const JobsPage = lazy(() => loadJobsPage().then((mod) => ({ default: mod.JobsPage })));
export const MemoryPage = lazy(() => loadMemoryPage().then((mod) => ({ default: mod.MemoryPage })));
export const SettingsPage = lazy(() =>
  loadSettingsPage().then((mod) => ({ default: mod.SettingsPage })),
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
