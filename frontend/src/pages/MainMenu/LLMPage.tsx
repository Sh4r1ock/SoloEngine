/**
 * @file LLMPage.tsx
 * @description LLM配置页面 - 大模型配置管理独立页面
 * @author SoloEngine Team
 * @date 2026-02-23
 */
import React from 'react';
import { Typography, Card, Tabs, Divider } from 'antd';
import { CloudServerOutlined, ApiOutlined, BarChartOutlined } from '@ant-design/icons';
import ModelManager from '../../components/Settings/ModelManager';
import LLMConfig from '../../components/Settings/LLMConfig';

const { Title, Text } = Typography;

const LLMPage: React.FC = () => {
  const items = [
    {
      key: 'models',
      label: (
        <span>
          <ApiOutlined />
          模型配置
        </span>
      ),
      children: <ModelManager />,
    },
    {
      key: 'usage',
      label: (
        <span>
          <BarChartOutlined />
          使用统计
        </span>
      ),
      children: <LLMConfig />,
    },
  ];

  return (
    <div style={{ 
      padding: '24px', 
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        marginBottom: 24,
      }}>
        <CloudServerOutlined style={{ fontSize: 24, color: 'var(--primary-100)' }} />
        <div>
          <Title level={3} style={{ margin: 0 }}>
            LLM 大模型配置
          </Title>
          <Text type="secondary" style={{ fontSize: 13 }}>
            配置和管理大语言模型，支持OpenAI、Anthropic、通义千问等主流模型
          </Text>
        </div>
      </div>

      <Divider style={{ margin: '0 0 24px 0' }} />

      <div style={{ flex: 1, minHeight: 0 }}>
        <Tabs 
          defaultActiveKey="models" 
          items={items}
          style={{ height: '100%' }}
        />
      </div>
    </div>
  );
};

export default LLMPage;
