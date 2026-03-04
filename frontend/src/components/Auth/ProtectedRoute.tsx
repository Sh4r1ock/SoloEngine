/**
 * @file ProtectedRoute.tsx
 * @description 路由守卫组件 - 保护需要认证的路由
 * @author SoloEngine Team
 * @date 2026-02-23
 * 
 * 功能描述：
 * - 检查用户登录状态
 * - 未登录时重定向到登录页面
 * - 支持加载状态显示
 */
import React, { useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { Spin } from 'antd';
import { useAuthStore } from '../../store/authStore';

interface ProtectedRouteProps {
  children: React.ReactNode;
}

const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children }) => {
  const { isAuthenticated, loadUser, token } = useAuthStore();
  const [loading, setLoading] = useState(true);
  const location = useLocation();

  useEffect(() => {
    const initAuth = async () => {
      const accessToken = localStorage.getItem('access_token');
      if (accessToken && !isAuthenticated) {
        await loadUser();
      }
      setLoading(false);
    };
    initAuth();
  }, []);

  if (loading) {
    return (
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        height: '100vh',
        background: '#f5f5f5',
      }}>
        <Spin size="large" tip="加载中...">
          <div style={{ padding: 50 }} />
        </Spin>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <>{children}</>;
};

export default ProtectedRoute;
