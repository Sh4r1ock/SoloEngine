/**
 * @file SettingsPage.tsx
 * @description 设置页面 - 系统设置配置页面
 * @author SoloEngine Team
 * @date 2026-02-19
 */
import React from 'react';
import { Typography, Card, Tabs, Divider } from 'antd';
import { SettingOutlined, ToolOutlined, SafetyOutlined, BellOutlined } from '@ant-design/icons';

const { Title, Text } = Typography;

const SettingsPage: React.FC = () => {
  const items = [
    {
      key: 'general',
      label: (
        <span>
          <SettingOutlined />
          常规设置
        </span>
      ),
      children: (
        <Card>
          <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-tertiary)' }}>
            常规设置功能开发中...
          </div>
        </Card>
      ),
    },
    {
      key: 'tools',
      label: (
        <span>
          <ToolOutlined />
          工具设置
        </span>
      ),
      children: (
        <Card>
          <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-tertiary)' }}>
            工具设置功能开发中...
          </div>
        </Card>
      ),
    },
    {
      key: 'security',
      label: (
        <span>
          <SafetyOutlined />
          安全设置
        </span>
      ),
      children: (
        <Card>
          <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-tertiary)' }}>
            安全设置功能开发中...
          </div>
        </Card>
      ),
    },
    {
      key: 'notifications',
      label: (
        <span>
          <BellOutlined />
          通知设置
        </span>
      ),
      children: (
        <Card>
          <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-tertiary)' }}>
            通知设置功能开发中...
          </div>
        </Card>
      ),
    },
  ];

  return (
    <div style={{ padding: '24px' }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        marginBottom: 24,
      }}>
        <SettingOutlined style={{ fontSize: 24, color: 'var(--primary-100)' }} />
        <div>
          <Title level={3} style={{ margin: 0 }}>
            设置
          </Title>
          <Text type="secondary" style={{ fontSize: 13 }}>
            管理系统设置和偏好配置
          </Text>
        </div>
      </div>

      <Divider style={{ margin: '0 0 24px 0' }} />

      <Tabs defaultActiveKey="general" items={items} />
    </div>
  );
};

export default SettingsPage;
