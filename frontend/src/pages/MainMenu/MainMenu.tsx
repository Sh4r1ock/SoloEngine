/**
 * SoloEngine : 主菜单页面组件
 *
 * @file MainMenu.tsx
 * @description 主菜单页面 - 系统主菜单导航页面
 * @author Sh4rlock
 * @date 2026-04-09
 *
 * 功能描述：
 * 本组件提供以下核心功能：
 *     - 系统主菜单导航
 *     - AgenticFlow列表管理
 *     - Skills管理
 *     - MCP服务器管理
 *     - 市场浏览
 *     - 系统设置
 *     - LLM配置
 *     - 用户登出
 *
 * 依赖:
 *     - react: React核心库
 *     - react-router-dom: 路由管理
 *     - antd: Ant Design组件
 *     - @ant-design/icons: Ant Design图标
 *     - ../../store/authStore: 认证状态管理
 *
 * 使用示例:
 *     - <Route path="/main/:tab" element={<MainMenu />} />
 */
import React, { Suspense, lazy } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Layout, Menu, Typography, Dropdown, Avatar, Button, Space, Spin } from 'antd';
import {
  AppstoreOutlined,
  ApiOutlined,
  FolderOpenOutlined,
  ShopOutlined,
  SettingOutlined,
  UserOutlined,
  LogoutOutlined,
  CloudServerOutlined,
} from '@ant-design/icons';
import { useAuthStore } from '../../store/authStore';

const AgenticFlowList = lazy(() => import('./AgenticFlowList'));
const SkillsManager = lazy(() => import('../../components/SkillsManager/SkillsManager'));
const MCPManager = lazy(() => import('../../components/MCPManager/MCPManager'));
const MarketplacePage = lazy(() => import('../Marketplace/MarketplacePage'));
const SettingsPage = lazy(() => import('./SettingsPage'));
const LLMPage = lazy(() => import('./LLMPage'));

const { Content, Header } = Layout;
const { Text } = Typography;

const LoadingFallback = () => (
  <div style={{
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    height: '100%',
    minHeight: 400,
  }}>
    <Spin size="large" />
  </div>
);

const MainMenu: React.FC = () => {
  const { tab } = useParams<{ tab: string }>();
  const navigate = useNavigate();
  const { user, logout } = useAuthStore();

  const menuItems = [
    { key: 'agenticflow', icon: <AppstoreOutlined />, label: 'AgenticFlow' },
    { key: 'skills', icon: <FolderOpenOutlined />, label: 'Skills' },
    { key: 'mcp', icon: <ApiOutlined />, label: 'MCP' },
    { key: 'llm', icon: <CloudServerOutlined />, label: 'LLM' },
    { key: 'marketplace', icon: <ShopOutlined />, label: '市场' },
    { key: 'settings', icon: <SettingOutlined />, label: '设置' },
  ];

  const handleMenuClick = (key: string) => {
    navigate(`/main/${key}`);
  };

  const handleLogout = () => {
    logout();
    navigate('/login', { replace: true });
  };

  const userMenuItems = [
    {
      key: 'profile',
      icon: <UserOutlined />,
      label: (
        <Space direction="vertical" size={0}>
          <Text strong>{user?.username || '用户'}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>{user?.email || ''}</Text>
        </Space>
      ),
      disabled: true,
    },
    { type: 'divider' as const },
    {
      key: 'logout',
      icon: <LogoutOutlined />,
      label: '退出登录',
      onClick: handleLogout,
    },
  ];

  const currentTab = tab || 'agenticflow';

  const renderContent = () => {
    let content;
    switch (currentTab) {
      case 'agenticflow':
        content = <AgenticFlowList />;
        break;
      case 'skills':
        content = <SkillsManager />;
        break;
      case 'mcp':
        content = <MCPManager />;
        break;
      case 'llm':
        content = <LLMPage />;
        break;
      case 'marketplace':
        content = <MarketplacePage />;
        break;
      case 'settings':
        content = <SettingsPage />;
        break;
      default:
        content = <AgenticFlowList />;
    }
    return (
      <Suspense fallback={<LoadingFallback />}>
        {content}
      </Suspense>
    );
  };

  return (
    <Layout style={{ height: '100vh', background: 'var(--bg-secondary)' }}>
      <Header
        style={{
          background: 'var(--sidebar-bg)',
          padding: '0 24px',
          display: 'flex',
          alignItems: 'center',
          height: 56,
          position: 'sticky',
          top: 0,
          zIndex: 100,
        }}
      >
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          minWidth: 180,
        }}>
          <img
            src="/logo.png"
            alt="SoloEngine"
            style={{
              width: 32,
              height: 32,
              backgroundColor: 'white',
              borderRadius: 8,
              padding: 2,
              objectFit: 'contain',
            }}
          />
          <Text style={{ color: '#fff', fontSize: 16, fontWeight: 600 }}>
            SoloEngine
          </Text>
        </div>

        <div style={{ 
          flex: 1, 
          display: 'flex', 
          justifyContent: 'center',
        }}>
          <Menu
            mode="horizontal"
            selectedKeys={[currentTab]}
            style={{
              background: 'transparent',
              border: 'none',
              minWidth: 500,
            }}
            items={menuItems.map(item => ({
              key: item.key,
              icon: item.icon,
              label: item.label,
              style: {
                color: 'rgba(255, 255, 255, 0.7)',
                marginLeft: 4,
                marginRight: 4,
              },
            }))}
            onClick={({ key }) => handleMenuClick(key)}
          />
        </div>

        <div style={{ minWidth: 180, display: 'flex', justifyContent: 'flex-end' }}>
          <Dropdown
            menu={{ items: userMenuItems }}
            placement="bottomRight"
            trigger={['click']}
          >
            <Button
              type="text"
              style={{
                height: 40,
                padding: '4px 12px',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                color: 'rgba(255, 255, 255, 0.85)',
                background: 'rgba(255, 255, 255, 0.1)',
                borderRadius: 8,
              }}
            >
              <Avatar
                size={28}
                icon={<UserOutlined />}
                style={{ background: 'linear-gradient(135deg, var(--primary-100), var(--primary-200))' }}
              />
              <span style={{ maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {user?.username || '用户'}
              </span>
            </Button>
          </Dropdown>
        </div>
      </Header>

      <Content style={{
        background: 'var(--bg-secondary)',
        overflow: 'auto',
        height: 'calc(100vh - 56px)',
      }}>
        {renderContent()}
      </Content>
    </Layout>
  );
};

export default MainMenu;
