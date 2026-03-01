/**
 * @file DebugPage.tsx
 * @description 调试页面 - 工作流调试功能独立页面
 * @author SoloEngine Team
 * @date 2026-02-19
 * 
 * 功能描述：
 * - 独立页面展示调试界面
 * - 提供工作流执行调试功能
 * - 支持日志查看和变量监控
 * 
 * 使用场景：
 * - 从主菜单或编辑器跳转进入
 * - 需要调试工作流执行过程时使用
 */
import React from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Button } from 'antd';
import { HomeOutlined, ArrowLeftOutlined } from '@ant-design/icons';
import DebugPanel from '../../components/DebugPanel/DebugPanel';

/**
 * 调试页面组件
 * 
 * @description 工作流调试独立页面，提供工作流执行调试、日志查看、变量监控功能
 * @returns {JSX.Element} 调试页面组件
 */
const DebugPage: React.FC = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();

  const handleGoHome = () => {
    navigate('/mainmenu');
  };

  const handleGoBack = () => {
    if (projectId) {
      navigate(`/editor/${projectId}`);
    } else {
      navigate(-1);
    }
  };

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        padding: '8px 16px',
        background: 'var(--sidebar-bg)',
        borderBottom: '1px solid var(--sidebar-hover)',
        height: '56px',
      }}>
        <Button
          icon={<HomeOutlined />}
          onClick={handleGoHome}
          style={{
            borderColor: 'rgba(255, 255, 255, 0.3)',
            color: 'rgba(255, 255, 255, 0.85)',
            background: 'rgba(255, 255, 255, 0.1)',
          }}
        >
          主菜单
        </Button>
        <Button
          icon={<ArrowLeftOutlined />}
          onClick={handleGoBack}
          style={{
            borderColor: 'rgba(255, 255, 255, 0.3)',
            color: 'rgba(255, 255, 255, 0.85)',
            background: 'rgba(255, 255, 255, 0.1)',
          }}
        >
          返回编辑器
        </Button>
        {projectId && (
          <span style={{ color: 'rgba(255, 255, 255, 0.7)', fontSize: 14 }}>
            当前项目: {projectId}
          </span>
        )}
      </div>
      <div style={{ flex: 1, overflow: 'hidden' }}>
        <DebugPanel />
      </div>
    </div>
  );
};

export default DebugPage;
