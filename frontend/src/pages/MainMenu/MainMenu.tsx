/**
 * @file MainMenu.tsx
 * @description 主菜单页面 - 系统主菜单导航页面
 * @author SoloEngine Team
 * @date 2026-02-19
 */
import React from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Layout, Menu, Typography, Dropdown, Avatar, Button, Space } from 'antd';
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
import AgenticFlowList from './AgenticFlowList';
import SkillsManager from '../../components/SkillsManager/SkillsManager';
import MCPManager from '../../components/MCPManager/MCPManager';
import MarketplacePage from '../Marketplace/MarketplacePage';
import SettingsPage from './SettingsPage';
import LLMPage from './LLMPage';
import { useAuthStore } from '../../store/authStore';

const { Content, Header } = Layout;
const { Text } = Typography;

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
    navigate(`/mainmenu/${key}`);
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
    switch (currentTab) {
      case 'agenticflow':
        return <AgenticFlowList />;
      case 'skills':
        return <SkillsManager />;
      case 'mcp':
        return <MCPManager />;
      case 'llm':
        return <LLMPage />;
      case 'marketplace':
        return <MarketplacePage />;
      case 'settings':
        return <SettingsPage />;
      default:
        return <AgenticFlowList />;
    }
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
          <div style={{
            width: 32,
            height: 32,
            background: 'linear-gradient(135deg, var(--primary-100), var(--primary-200))',
            borderRadius: 8,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'white',
            fontSize: 14,
            fontWeight: 'bold',
          }}>
            SE
          </div>
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
      }}>
        {renderContent()}
      </Content>
    </Layout>
  );
};

export default MainMenu;
