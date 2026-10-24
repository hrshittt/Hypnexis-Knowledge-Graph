import { Suspense, lazy } from 'react';
import { Route, Routes } from 'react-router-dom';
import PublicLayout from './layouts/PublicLayout';
import AppShell from './layouts/AppShell';
import { PublicOnly, RequireAuth } from './routes/guards';
import { PageLoader } from './components/ui/Feedback';
import Landing from './pages/landing/Landing';
import Login from './pages/Login';
import Register from './pages/Register';
import { Demo, ForgotPassword, NotFound, Terms } from './pages/PublicPages';

// App pages load on demand (the graph engine, charts and workspace modules stay out of the landing bundle);
// the shell itself is eager so navigation and the frame appear immediately while a page loads.
const Overview = lazy(() => import('./pages/app/Overview'));
const WorkspaceTypeEntry = lazy(() => import('./pages/app/WorkspaceTypeEntry'));
const WorkspacePage = lazy(() => import('./pages/app/WorkspacePage'));
const KnowledgeGraphPage = lazy(() => import('./pages/app/KnowledgeGraphPage'));
const DocumentsPage = lazy(() => import('./pages/app/DocumentsPage'));
const SearchPage = lazy(() => import('./pages/app/SearchPage'));
const ActivityPage = lazy(() => import('./pages/app/ActivityPage'));
const SavedAnalysisPage = lazy(() => import('./pages/app/SavedAnalysisPage'));
const SettingsPage = lazy(() => import('./pages/app/SettingsPage'));
const HelpPage = lazy(() => import('./pages/app/HelpPage'));

export default function App() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Routes>
        <Route element={<PublicLayout />}>
          <Route index element={<Landing />} />
          <Route path="terms" element={<Terms />} />
          <Route path="demo" element={<Demo />} />
        </Route>
        <Route path="login" element={<PublicOnly><Login /></PublicOnly>} />
        <Route path="register" element={<PublicOnly><Register /></PublicOnly>} />
        <Route path="forgot-password" element={<ForgotPassword />} />
        <Route path="app" element={<RequireAuth><AppShell /></RequireAuth>}>
          <Route index element={<Overview />} />
          <Route path="graph" element={<KnowledgeGraphPage />} />
          <Route path="documents" element={<DocumentsPage />} />
          <Route path="search" element={<SearchPage />} />
          <Route path="activity" element={<ActivityPage />} />
          <Route path="saved/:analysisId" element={<SavedAnalysisPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="help" element={<HelpPage />} />
          <Route path="w/:workspaceId" element={<WorkspacePage />} />
          <Route path=":type" element={<WorkspaceTypeEntry />} />
          <Route path="*" element={<NotFound />} />
        </Route>
        <Route element={<PublicLayout />}>
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
