/**
 * SoloEngine : 路由配置模块
 *
 * @file router.tsx
 * @description React Router路由配置
 * @author Sh4rlock
 * @date 2026-04-09
 *
 * 功能描述：
 * 本模块配置前端路由，包括：
 *     - 页面路由定义
 *     - 懒加载配置
 *     - 受保护路由
 *     - 加载状态 fallback
 *
 * 依赖:
 *     - react: React核心库
 *     - react-router-dom: 路由管理
 *     - antd: Ant Design组件
 *
 * 使用示例:
 *     - import router from './router'
 *     - <RouterProvider router={router} />
 */

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
    element: <Navigate to="/main" replace />,
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
    path: '/main',
    element: (
      <ProtectedRoute>
        <Suspense fallback={<LoadingFallback />}>
          <MainMenu />
        </Suspense>
      </ProtectedRoute>
    ),
  },
  {
    path: '/main/:tab',
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
    path: '/run/:agenticFlowId',
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
