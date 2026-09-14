import { Navigate, Route, Routes } from 'react-router';
import { AdminPage } from '@/pages/admin';
import { CardPage } from '@/pages/card';
import { DocPage } from '@/pages/doc';
import { EditorPage } from '@/pages/editor';
import { HomePage } from '@/pages/home';
import { LoginPage } from '@/pages/login';
import { ReviewPage } from '@/pages/review';
import { SettingsPage } from '@/pages/settings';
import { TopicDetailPage, TopicsPage } from '@/pages/topics';
import { PAGE_LIST, ROUTES, routeSegment } from '@/routes';
import { Layout } from '@/shell/Layout';
import { RequireAuth } from '@/shell/RequireAuth';

const REQUIRED_PATHS = [ROUTES.login, ROUTES.review, ROUTES.topics, ROUTES.settings, ROUTES.admin] as const;
for (const path of REQUIRED_PATHS) {
  if (!PAGE_LIST.some((page) => page.path === path)) {
    throw new Error(`missing page route ${path}`);
  }
}

export function App() {
  return (
    <Routes>
      <Route path={ROUTES.login} element={<LoginPage />} />
      <Route element={<RequireAuth />}>
        <Route element={<Layout />}>
          <Route index element={<HomePage />} />
          <Route path={routeSegment(ROUTES.captures)} element={<Navigate to={ROUTES.home} replace />} />
          <Route path={routeSegment(ROUTES.editor)} element={<EditorPage />} />
          <Route path={routeSegment(ROUTES.doc)} element={<DocPage />} />
          <Route path={routeSegment(ROUTES.card)} element={<CardPage />} />
          <Route path={routeSegment(ROUTES.review)} element={<ReviewPage />} />
          <Route path={routeSegment(ROUTES.topics)} element={<TopicsPage />} />
          <Route path={routeSegment(ROUTES.topic)} element={<TopicDetailPage />} />
          <Route path={routeSegment(ROUTES.settings)} element={<SettingsPage />} />
          <Route path={routeSegment(ROUTES.admin)} element={<AdminPage />} />
        </Route>
      </Route>
    </Routes>
  );
}
