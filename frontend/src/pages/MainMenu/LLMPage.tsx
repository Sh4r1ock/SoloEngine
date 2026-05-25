/**
 * @file LLMPage.tsx
 * @description LLM配置页面 - 大模型配置管理独立页面
 * @author SoloEngine Team
 * @date 2026-02-23
 */
import React, { useEffect, useRef } from 'react';
import { Typography, Card, Tabs, Divider } from 'antd';
import { CloudServerOutlined, ApiOutlined, BarChartOutlined } from '@ant-design/icons';
import ModelManager from '../../components/Settings/ModelManager';
import LLMConfig from '../../components/Settings/LLMConfig';

const { Title, Text } = Typography;

const LLMPage: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const styleId = 'llm-tabs-height-fix';
    if (!document.getElementById(styleId)) {
      const style = document.createElement('style');
      style.id = styleId;
      style.textContent = `
        .llm-tabs-container.ant-tabs { height: 100%; display: flex; flex-direction: column; }
        .llm-tabs-container .ant-tabs-content-holder { flex: 1; min-height: 0; }
        .llm-tabs-container .ant-tabs-content { height: 100%; }
        .llm-tabs-container .ant-tabs-tabpane { height: 100%; }
        .llm-tabs-container .ant-tabs-tabpane > div { height: 100%; }
      `;
      document.head.appendChild(style);
    }
  }, []);

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
            LLM 配置
          </Title>
          <Text type="secondary" style={{ fontSize: 13 }}>
            配置和管理大语言模型，支持OpenAI、Anthropic、通义千问等主流模型
          </Text>
        </div>
      </div>

      <Divider style={{ margin: '0 0 24px 0' }} />

      <div ref={containerRef} style={{ flex: 1, minHeight: 0 }}>
        <Tabs 
          className="llm-tabs-container"
          defaultActiveKey="models" 
          items={items}
        />
      </div>
    </div>
  );
};

export default LLMPage;
