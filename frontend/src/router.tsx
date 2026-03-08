import { lazy, Suspense } from 'react';
import { createBrowserRouter, Navigate } from 'react-router-dom';
import { Spin } from 'antd';
import ProtectedRoute from './components/Auth/ProtectedRoute';

const EditorPage = lazy(() => import('./pages/Editor/EditorPage'));
const MainMenu = lazy(() => import('./pages/MainMenu/MainMenu'));
const RunPage = lazy(() => import('./pages/Run/RunPage'));
const MarketplacePage = lazy(() => import('./pages/Marketplace/MarketplacePage'));
const LoginPage = lazy(() => import('./pages/Auth/LoginPage'));
const RegisterPage = lazy(() => import('./pages/Auth/RegisterPage'));
const SkillsEditorPage = lazy(() => import('./pages/SkillsEditor/SkillsEditorPage'));

const LoadingFallback = () => (
  <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
    <Spin size="large" />
  </div>
);

const router = createBrowserRouter([
  {
    path: '/',
    element: <Navigate to="/mainmenu" replace />,
  },
  {
    path: '/login',
    element: (
      <Suspense fallback={<LoadingFallback />}>
        <LoginPage />
      </Suspense>
    ),
  },
  {
    path: '/register',
    element: (
      <Suspense fallback={<LoadingFallback />}>
        <RegisterPage />
      </Suspense>
    ),
  },
  {
    path: '/mainmenu',
    element: (
      <ProtectedRoute>
        <Suspense fallback={<LoadingFallback />}>
          <MainMenu />
        </Suspense>
      </ProtectedRoute>
    ),
  },
  {
    path: '/mainmenu/:tab',
    element: (
      <ProtectedRoute>
        <Suspense fallback={<LoadingFallback />}>
          <MainMenu />
        </Suspense>
      </ProtectedRoute>
    ),
  },
  {
    path: '/editor/:projectId',
    element: (
      <ProtectedRoute>
        <Suspense fallback={<LoadingFallback />}>
          <EditorPage />
        </Suspense>
      </ProtectedRoute>
    ),
  },
  {
    path: '/editor',
    element: (
      <ProtectedRoute>
        <Suspense fallback={<LoadingFallback />}>
          <EditorPage />
        </Suspense>
      </ProtectedRoute>
    ),
  },
  {
    path: '/run/:projectId',
    element: (
      <ProtectedRoute>
        <Suspense fallback={<LoadingFallback />}>
          <RunPage />
        </Suspense>
      </ProtectedRoute>
    ),
  },
  {
    path: '/run',
    element: (
      <ProtectedRoute>
        <Suspense fallback={<LoadingFallback />}>
          <RunPage />
        </Suspense>
      </ProtectedRoute>
    ),
  },
  {
    path: '/marketplace',
    element: (
      <ProtectedRoute>
        <Suspense fallback={<LoadingFallback />}>
          <MarketplacePage />
        </Suspense>
      </ProtectedRoute>
    ),
  },
  {
    path: '/marketplace/:tab',
    element: (
      <ProtectedRoute>
        <Suspense fallback={<LoadingFallback />}>
          <MarketplacePage />
        </Suspense>
      </ProtectedRoute>
    ),
  },
  {
    path: '/skills-editor/:packageId',
    element: (
      <ProtectedRoute>
        <Suspense fallback={<LoadingFallback />}>
          <SkillsEditorPage />
        </Suspense>
      </ProtectedRoute>
    ),
  },
]);

export default router;
