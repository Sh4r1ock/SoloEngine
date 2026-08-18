/**
 * @file LLMConfigSelector.tsx
 * @description LLM配置选择器组件 - 用于在画布中选择用户配置的模型
 * @author SoloEngine Team
 * @date 2026-02-22
 *
 * 功能描述：
 * - 从 configMap（store）读取所有 LLM 配置
 * - 支持按提供商筛选
 * - 显示配置详情（模型名称、提供商、是否默认）
 * - 刷新按钮触发 store.loadLLMConfigs 重新获取
 * - 支持快速跳转到设置页面添加新配置
 *
 * 使用场景：
 * - PropertyEditor中的模型选择
 * - 节点配置中的模型选择
 */
import React, { useEffect, useState, useMemo } from 'react';
import { Select, Button, Empty, Spin, Typography, Tooltip, Divider, Tag } from 'antd';
import { ReloadOutlined, PlusOutlined, StarFilled } from '@ant-design/icons';
import { LLMConfig, ProviderConfig } from '../../services/llmApi';
import { llmApi } from '../../services/llmApi';
import { useCanvasStore } from '../../store/canvasStore';

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
  const configMap = useCanvasStore((s) => s.configMap);
  const loadLLMConfigs = useCanvasStore((s) => s.loadLLMConfigs);
  const [providers, setProviders] = useState<ProviderConfig[]>([]);
  const [loading, setLoading] = useState(false);

  const configs = useMemo(() => {
    let list = Array.from(configMap.values()).filter(c => c.is_active);
    if (value && configMap.has(value)) {
      const selected = configMap.get(value)!;
      if (!selected.is_active && !list.some(c => c.id === value)) {
        list.unshift(selected);
      }
    }
    if (filterByProvider) {
      list = list.filter(c => c.provider === filterByProvider);
    }
    return list;
  }, [configMap, filterByProvider, value]);

  useEffect(() => {
    llmApi.getProviders().then(setProviders).catch(() => {});
  }, []);

  const handleRefresh = async () => {
    setLoading(true);
    try {
      await loadLLMConfigs();
    } finally {
      setLoading(false);
    }
  };

  const getProviderDisplayName = (providerName: string) => {
    const provider = providers.find(p => p.name === providerName);
    return provider?.display_name || providerName;
  };

  const getProviderColor = (providerName: string) => {
    const provider = providers.find(p => p.name === providerName);
    return provider?.color || 'default';
  };

  const handleChange = (configId: string) => {
    const selectedConfig = configMap.get(configId) || null;
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
        style={{ width: '100%' }}
        optionLabelProp="label"
        virtual={false}
        popupRender={(menu) => (
          <div className="llm-config-dropdown-inner">
            {menu}
            <Divider className="llm-config-dropdown-divider" />
            <div className="llm-config-dropdown-footer">
              <Tooltip title="刷新配置列表">
                <Button
                  type="text"
                  size="small"
                  icon={<ReloadOutlined />}
                  onClick={handleRefresh}
                  className="llm-config-dropdown-footer-btn"
                >
                  刷新
                </Button>
              </Tooltip>
              {showAddButton && (
                <Tooltip title="前往设置页面添加新模型配置">
                  <Button
                    type="text"
                    size="small"
                    icon={<PlusOutlined />}
                    onClick={handleOpenSettings}
                    className="llm-config-dropdown-footer-btn"
                  >
                    添加配置
                  </Button>
                </Tooltip>
              )}
            </div>
          </div>
        )}
      >
        {Object.entries(groupedConfigs).map(([provider, providerConfigs]) => (
          <Select.OptGroup
            key={provider}
            label={
              <div className="llm-config-group-header">
                <Tag
                  color={getProviderColor(provider)}
                  style={{ width: 10, height: 10, padding: 0, borderRadius: '50%', minWidth: 10, lineHeight: '10px', borderWidth: 2 }}
                >
                  &nbsp;
                </Tag>
                <span className="llm-config-group-name">
                  {getProviderDisplayName(provider)}
                </span>
                <span className="llm-config-group-count">
                  {providerConfigs.length}
                </span>
              </div>
            }
          >
            {providerConfigs.map((config) => (
              <Select.Option
                key={config.id}
                value={config.id}
                label={
                  <span className="llm-config-option-label">
                    {config.is_default && (
                      <StarFilled className="llm-config-option-star-label" />
                    )}
                    <span>{config.name}</span>
                  </span>
                }
              >
                <div className="llm-config-option">
                  <div className="llm-config-option-main">
                    {config.is_default && (
                      <Tooltip title="默认配置">
                        <StarFilled className="llm-config-option-star" />
                      </Tooltip>
                    )}
                    <span className="llm-config-option-name">
                      {config.name}
                    </span>
                  </div>
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
