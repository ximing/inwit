import { Suspense } from 'react';
import { Navigate, Route, Routes, useParams, useSearchParams } from 'react-router';
import { AppDialog } from '@/components/app-dialog';
import { PAGE_LIST, ROUTES, docPath, editorNewPath, editorPath, routeSegment, topicPath } from '@/routes';
import { Layout } from '@/shell/Layout';
import {
  DocsPage,
  JobsPage,
  LoginPage,
  MemoryPage,
  ReviewPage,
  SettingsPage,
  TodayPage,
  TopicsPage,
} from '@/shell/page-loaders';
import { RequireAuth } from '@/shell/RequireAuth';

const REQUIRED_PATHS = [
  ROUTES.login,
  ROUTES.home,
  ROUTES.docs,
  ROUTES.review,
  ROUTES.topics,
  ROUTES.jobs,
  ROUTES.memory,
  ROUTES.settings,
] as const;
for (const path of REQUIRED_PATHS) {
  if (!PAGE_LIST.some((page) => page.path === path)) {
    throw new Error(`missing page route ${path}`);
  }
}

function LegacyDocRedirect() {
  const { id } = useParams();
  return <Navigate to={id ? docPath(id) : ROUTES.docs} replace />;
}

function LegacyEditorRedirect() {
  const { id } = useParams();
  const [params] = useSearchParams();
  if (!id) return <Navigate to={ROUTES.docs} replace />;
  if (id === 'new') return <Navigate to={editorNewPath(params.get('topicId'))} replace />;
  return <Navigate to={editorPath(id)} replace />;
}

function LegacyTopicRedirect() {
  const { id } = useParams();
  return <Navigate to={id ? topicPath(id) : ROUTES.topics} replace />;
}

export function App() {
  return (
    <>
      <Routes>
        <Route
          path={ROUTES.login}
          element={
            <Suspense
              fallback={
                <div className="splash">
                  <p className="brand-mark">Inwit</p>
                </div>
              }
            >
              <LoginPage />
            </Suspense>
          }
        />
        <Route element={<RequireAuth />}>
          <Route path="/doc/:id" element={<LegacyDocRedirect />} />
          <Route path="/editor/:id" element={<LegacyEditorRedirect />} />
          <Route path="/card/:id" element={<Navigate to={ROUTES.review} replace />} />
          <Route path="/cards/:id" element={<Navigate to={ROUTES.review} replace />} />
          <Route path="/captures" element={<Navigate to={ROUTES.jobs} replace />} />
          <Route path="/admin" element={<Navigate to={ROUTES.jobs} replace />} />
          <Route element={<Layout />}>
            <Route index element={<TodayPage />} />
            <Route path={routeSegment(ROUTES.docs)} element={<DocsPage />} />
            <Route path={routeSegment(ROUTES.review)} element={<ReviewPage />} />
            <Route path={routeSegment(ROUTES.topics)} element={<TopicsPage />} />
            <Route path={routeSegment(ROUTES.topic)} element={<LegacyTopicRedirect />} />
            <Route path={routeSegment(ROUTES.jobs)} element={<JobsPage />} />
            <Route path={routeSegment(ROUTES.memory)} element={<MemoryPage />} />
            <Route path={`${routeSegment(ROUTES.settings)}/:section?`} element={<SettingsPage />} />
          </Route>
        </Route>
      </Routes>
      <AppDialog />
    </>
  );
}
