/**
 * @file AgentNode.tsx
 * @description 智能体节点组件 - 工作流智能体节点渲染组件
 * @author SoloEngine Team
 * @date 2026-02-19
 * 
 * 功能描述：
 * - 展示智能体节点的可视化表示
 * - 包含节点图标、名称、端口等元素
 * - 处理节点选中状态
 * - 显示连接端口
 * - 显示LLM配置信息
 * 
 * 使用场景：
 * - 在画布中渲染智能体节点
 * - 作为ReactFlow的自定义节点类型使用
 * 
 * 注意事项：
 * - 支持三种智能体类型：orchestrator、planner、executor
 * - 不同类型使用不同颜色区分
 * - 显示用户配置的模型名称
 */
import React from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { Typography, Tag, Tooltip } from 'antd';
import { StarFilled } from '@ant-design/icons';

const { Text } = Typography;

const AgentNode: React.FC<NodeProps> = ({ data, selected }) => {
  const agentTypeColors = {
    orchestrator: '#3F51B5',
    planner: '#4CAF50',
    executor: '#FF9800',
  };

  const color = agentTypeColors[data.agentType as keyof typeof agentTypeColors] || '#3F51B5';

  const getProviderColor = (provider: string) => {
    const colors: Record<string, string> = {
      openai: 'blue',
      anthropic: 'orange',
      qwen: 'green',
      ollama: 'purple',
    };
    return colors[provider] || 'default';
  };

  const renderModelInfo = () => {
    if (data.model_config?.config_name) {
      return (
        <Tooltip title={`${data.model_config.provider} - ${data.model_config.model}`}>
          <Tag 
            color={getProviderColor(data.model_config.provider)}
            style={{ 
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              marginTop: 4,
            }}
          >
            {data.model_config.config_name}
          </Tag>
        </Tooltip>
      );
    }
    
    if (data.model_config?.model) {
      const modelDisplayNames: Record<string, string> = {
        'gpt-4': 'GPT-4',
        'gpt-3.5-turbo': 'GPT-3.5 Turbo',
        'claude-3': 'Claude 3',
        'qwen-max': '通义千问 Max',
      };
      const displayName = modelDisplayNames[data.model_config.model] || data.model_config.model;
      
      return (
        <span style={{
          display: 'inline-block',
          padding: '2px 8px',
          backgroundColor: '#e3f2fd',
          color: '#1976d2',
          borderRadius: '4px',
          fontSize: '11px',
          fontWeight: 500,
          marginTop: 4,
        }}>
          {displayName}
        </span>
      );
    }
    
    return (
      <span style={{
        display: 'inline-block',
        padding: '2px 8px',
        backgroundColor: '#fff2f0',
        color: '#ff4d4f',
        borderRadius: '4px',
        fontSize: '11px',
        fontWeight: 500,
        marginTop: 4,
      }}>
        未配置模型
      </span>
    );
  };

  return (
    <div
      style={{
        width: 220,
        backgroundColor: '#FFFFFF',
        borderRadius: 8,
        border: `1px solid ${selected ? '#3F51B5' : '#cccccc'}`,
        boxShadow: selected 
          ? '0 0 0 3px rgba(63, 81, 181, 0.2), 0 4px 12px rgba(63, 81, 181, 0.15)' 
          : '0 2px 8px rgba(0, 0, 0, 0.05)',
        transition: 'all 0.2s ease-in-out',
      }}
    >
      <Handle
        type="target"
        position={Position.Top}
        style={{
          width: 10,
          height: 10,
          background: color,
          border: '2px solid #ffffff',
        }}
      />
      
      <div style={{ padding: 12, minHeight: 100 }}>
        <div style={{ marginBottom: 8 }}>
          <Text strong style={{ fontSize: 16, color: '#333333', display: 'block' }}>
            {data.name || '未命名节点'}
          </Text>
        </div>
        
        <div style={{ marginBottom: 8 }}>
          {renderModelInfo()}
        </div>
        
        <div style={{
          marginTop: 8,
          paddingTop: 8,
          borderTop: '1px solid #f0f0f0',
          minHeight: 20,
        }}>
          <Text style={{
            fontSize: 12,
            color: '#9ca3af',
            display: 'block',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            maxWidth: '196px',
            minHeight: 20,
            lineHeight: '20px',
          }}>
            {data.desc ? data.desc : '未配置简介'}
          </Text>
        </div>
      </div>
      
      <Handle
        type="source"
        position={Position.Bottom}
        style={{
          width: 10,
          height: 10,
          background: color,
          border: '2px solid #ffffff',
        }}
      />
    </div>
  );
};

export default AgentNode;
