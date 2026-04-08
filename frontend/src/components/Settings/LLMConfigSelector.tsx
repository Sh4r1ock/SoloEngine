/**
 * @file LLMConfigSelector.tsx
 * @description LLM配置选择器组件 - 用于在画布中选择用户配置的模型
 * @author SoloEngine Team
 * @date 2026-02-22
 * 
 * 功能描述：
 * - 展示用户已配置的所有LLM配置
 * - 支持按提供商筛选
 * - 显示配置详情（模型名称、提供商、是否默认）
 * - 支持快速跳转到设置页面添加新配置
 * 
 * 使用场景：
 * - PropertyEditor中的模型选择
 * - 节点配置中的模型选择
 */
import React, { useEffect, useState } from 'react';
import { Select, Tag, Button, Empty, Spin, Space, Typography, Tooltip, Divider } from 'antd';
import { SettingOutlined, ReloadOutlined, PlusOutlined, StarFilled } from '@ant-design/icons';
import { llmApi, LLMConfig, ProviderConfig } from '../../services/llmApi';

const { Text } = Typography;

interface LLMConfigSelectorProps {
  value?: string;
  onChange?: (configId: string, config: LLMConfig | null) => void;
  placeholder?: string;
  disabled?: boolean;
  style?: React.CSSProperties;
  showAddButton?: boolean;
  filterByProvider?: string;
}

const LLMConfigSelector: React.FC<LLMConfigSelectorProps> = ({
  value,
  onChange,
  placeholder = '选择模型配置',
  disabled = false,
  style,
  showAddButton = true,
  filterByProvider,
}) => {
  const [configs, setConfigs] = useState<LLMConfig[]>([]);
  const [providers, setProviders] = useState<ProviderConfig[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadConfigs = async () => {
    setLoading(true);
    setError(null);
    try {
      const [configsData, providersData] = await Promise.all([
        llmApi.getActiveConfigs(),
        llmApi.getProviders(),
      ]);
      
      let filteredConfigs = configsData;
      if (filterByProvider) {
        filteredConfigs = configsData.filter(c => c.provider === filterByProvider);
      }
      
      setConfigs(filteredConfigs);
      setProviders(providersData);
    } catch (err) {
      setError('加载配置失败');
      console.error('Failed to load LLM configs:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadConfigs();
  }, [filterByProvider]);

  const getProviderDisplayName = (providerName: string) => {
    const provider = providers.find(p => p.name === providerName);
    return provider?.display_name || providerName;
  };

  const getProviderColor = (provider: string) => {
    const colors: Record<string, string> = {
      openai: 'blue',
      anthropic: 'orange',
      qwen: 'green',
      ollama: 'purple',
    };
    return colors[provider] || 'default';
  };

  const handleChange = (configId: string) => {
    const selectedConfig = configs.find(c => c.id === configId) || null;
    onChange?.(configId, selectedConfig);
  };

  const handleOpenSettings = () => {
    window.open('/main/llm', '_blank');
  };

  const groupedConfigs = configs.reduce((acc, config) => {
    if (!acc[config.provider]) {
      acc[config.provider] = [];
    }
    acc[config.provider].push(config);
    return acc;
  }, {} as Record<string, LLMConfig[]>);

  if (loading) {
    return (
      <Spin size="small" style={{ display: 'flex', justifyContent: 'center', padding: '20px' }} />
    );
  }

  if (error) {
    return (
      <div style={{ color: '#ff4d4f', padding: '8px' }}>
        <Text type="danger">{error}</Text>
        <Button size="small" icon={<ReloadOutlined />} onClick={loadConfigs} style={{ marginLeft: 8 }}>
          重试
        </Button>
      </div>
    );
  }

  if (configs.length === 0) {
    return (
      <div style={{ padding: '8px 0' }}>
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={
            <span>
              暂无模型配置
              {showAddButton && (
                <Button 
                  type="link" 
                  size="small" 
                  icon={<PlusOutlined />}
                  onClick={handleOpenSettings}
                >
                  去添加
                </Button>
              )}
            </span>
          }
        />
      </div>
    );
  }

  return (
    <div style={style}>
      <Select
        value={value}
        onChange={handleChange}
        placeholder={placeholder}
        disabled={disabled}
        loading={loading}
        style={{ width: '100%' }}
        optionLabelProp="label"
        dropdownRender={(menu) => (
          <>
            {menu}
            <Divider style={{ margin: '8px 0' }} />
            <Space style={{ padding: '8px' }}>
              <Button 
                type="link" 
                size="small" 
                icon={<ReloadOutlined />} 
                onClick={loadConfigs}
              >
                刷新
              </Button>
              {showAddButton && (
                <Button 
                  type="link" 
                  size="small" 
                  icon={<PlusOutlined />} 
                  onClick={handleOpenSettings}
                >
                  添加配置
                </Button>
              )}
            </Space>
          </>
        )}
      >
        {Object.entries(groupedConfigs).map(([provider, providerConfigs]) => (
          <Select.OptGroup 
            key={provider}
            label={
              <Space>
                <Tag color={getProviderColor(provider)}>
                  {getProviderDisplayName(provider)}
                </Tag>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {providerConfigs.length} 个配置
                </Text>
              </Space>
            }
          >
            {providerConfigs.map((config) => (
              <Select.Option 
                key={config.id} 
                value={config.id}
                label={
                  <Space>
                    {config.is_default && <StarFilled style={{ color: '#faad14' }} />}
                    <span>{config.name}</span>
                    <Tag style={{ fontSize: 10, marginLeft: 4 }}>
                      {config.model_name}
                    </Tag>
                  </Space>
                }
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Space>
                    {config.is_default && (
                      <Tooltip title="默认配置">
                        <StarFilled style={{ color: '#faad14' }} />
                      </Tooltip>
                    )}
                    <span>{config.name}</span>
                  </Space>
                  <Space>
                    <Tag color={getProviderColor(provider)} style={{ fontSize: 10 }}>
                      {config.model_name}
                    </Tag>
                    {config.temperature !== 0.7 && (
                      <Tooltip title={`温度: ${config.temperature}`}>
                        <Tag style={{ fontSize: 10 }}>T:{config.temperature}</Tag>
                      </Tooltip>
                    )}
                  </Space>
                </div>
              </Select.Option>
            ))}
          </Select.OptGroup>
        ))}
      </Select>
    </div>
  );
};

export default LLMConfigSelector;
