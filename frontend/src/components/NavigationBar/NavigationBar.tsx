import React from 'react';
import { Layout, Menu, Typography, Space, Avatar, Dropdown } from 'antd';
import {
  HomeOutlined,
  ProjectOutlined,
  ApiOutlined,
  ToolOutlined,
  SettingOutlined,
  UserOutlined,
  LogoutOutlined,
  BugOutlined,
} from '@ant-design/icons';

const { Header } = Layout;
const { Text } = Typography;

interface NavigationBarProps {
  currentView: string;
  onViewChange: (view: string) => void;
  username?: string;
  onLogout?: () => void;
}

const NavigationBar: React.FC<NavigationBarProps> = ({
  currentView,
  onViewChange,
  username,
  onLogout,
}) => {
  const menuItems = [
    {
      key: 'home',
      icon: <HomeOutlined />,
      label: '主菜单',
    },
    {
      key: 'projects',
      icon: <ProjectOutlined />,
      label: '项目管理',
    },
    {
      key: 'mcp',
      icon: <ApiOutlined />,
      label: 'MCP 管理',
    },
    {
      key: 'skills',
      icon: <ToolOutlined />,
      label: 'Skills 管理',
    },
    {
      key: 'debug',
      icon: <BugOutlined />,
      label: '调试面板',
    },
    {
      key: 'settings',
      icon: <SettingOutlined />,
      label: '设置',
    },
  ];

  const userMenuItems = [
    {
      key: 'profile',
      icon: <UserOutlined />,
      label: '个人资料',
    },
    {
      key: 'logout',
      icon: <LogoutOutlined />,
      label: '退出登录',
      danger: true,
    },
  ];

  const handleUserMenuClick = ({ key }: { key: string }) => {
    if (key === 'logout') {
      onLogout?.();
    }
  };

  return (
    <Header
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        background: '#001529',
        padding: '0 24px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <Text strong style={{ color: '#fff', fontSize: 18, marginRight: 32 }}>
          SoloEngine
        </Text>
        <Menu
          theme="dark"
          mode="horizontal"
          selectedKeys={[currentView]}
          items={menuItems}
          onClick={({ key }) => onViewChange(key)}
          style={{ flex: 1, minWidth: 400 }}
        />
      </div>

      <div>
        <Dropdown
          menu={{
            items: userMenuItems,
            onClick: handleUserMenuClick,
          }}
          placement="bottomRight"
        >
          <Space style={{ cursor: 'pointer', color: '#fff' }}>
            <Avatar icon={<UserOutlined />} />
            <Text style={{ color: '#fff' }}>{username || '用户'}</Text>
          </Space>
        </Dropdown>
      </div>
    </Header>
  );
};

export default NavigationBar;
