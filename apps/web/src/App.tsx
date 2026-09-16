import { Navigate, Route, Routes, useParams, useSearchParams } from 'react-router';
import { DocsPage } from '@/pages/docs';
import { JobsPage } from '@/pages/jobs';
import { LoginPage } from '@/pages/login';
import { ReviewPage } from '@/pages/review';
import { SettingsPage } from '@/pages/settings';
import { TodayPage } from '@/pages/today';
import { TopicsPage } from '@/pages/topics';
import { PAGE_LIST, ROUTES, docPath, editorNewPath, editorPath, routeSegment, topicPath } from '@/routes';
import { Layout } from '@/shell/Layout';
import { RequireAuth } from '@/shell/RequireAuth';

const REQUIRED_PATHS = [
  ROUTES.login,
  ROUTES.home,
  ROUTES.docs,
  ROUTES.review,
  ROUTES.topics,
  ROUTES.jobs,
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
    <Routes>
      <Route path={ROUTES.login} element={<LoginPage />} />
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
          <Route path={routeSegment(ROUTES.settings)} element={<SettingsPage />} />
        </Route>
      </Route>
    </Routes>
  );
}
