import React from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { Typography } from 'antd';

const { Text } = Typography;

const AgentNode: React.FC<NodeProps> = ({ data, selected }) => {
  const agentTypeColors = {
    orchestrator: '#3F51B5',
    planner: '#4CAF50',
    executor: '#FF9800',
  };

  const color = agentTypeColors[data.agentType as keyof typeof agentTypeColors] || '#3F51B5';

  const getDisplayName = (modelName: string) => {
    const modelDisplayNames: Record<string, string> = {
      'gpt-4': 'GPT-4',
      'gpt-3.5-turbo': 'GPT-3.5 Turbo',
      'claude-3': 'Claude 3',
      'qwen-max': '通义千问 Max',
    };
    return modelDisplayNames[modelName] || modelName;
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
        <div style={{ marginBottom: 12 }}>
          <Text strong style={{ fontSize: 16, color: '#333333', display: 'block' }}>
            {data.name || '未命名节点'}
          </Text>
        </div>
        
        {data.model_config?.model && (
          <div style={{ marginBottom: 10 }}>
            <span style={{
              display: 'inline-block',
              padding: '2px 8px',
              backgroundColor: '#e3f2fd',
              color: '#1976d2',
              borderRadius: '4px',
              fontSize: '11px',
              fontWeight: 500,
            }}>
              {getDisplayName(data.model_config.model)}
            </span>
          </div>
        )}
        
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
