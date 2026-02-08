import React from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { Typography } from 'antd';

const { Text } = Typography;

const AgentNode: React.FC<NodeProps> = ({ data, selected }) => {
  const agentTypeColors = {
    orchestrator: '#1677ff',
    planner: '#52c41a',
    executor: '#fa8c16',
  };

  const color = agentTypeColors[data.agentType as keyof typeof agentTypeColors] || '#1677ff';

  return (
    <div
      style={{
        width: 220,
        backgroundColor: '#ffffff',
        borderRadius: 8,
        border: selected ? '2px solid #1677ff' : '1px solid #e2e8f0',
        boxShadow: selected ? '0 4px 12px rgba(22, 119, 255, 0.15)' : '0 2px 8px rgba(0, 0, 0, 0.08)',
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
      
      <div style={{ padding: 12 }}>
        <div style={{ marginBottom: 8 }}>
          <Text strong style={{ fontSize: 14, color: '#1f2937' }}>
            {data.name || '未命名节点'}
          </Text>
        </div>
        
        {data.model_config?.model && (
          <div style={{ marginBottom: 6 }}>
            <Text style={{ fontSize: 12, color: '#64748b' }}>
              {data.model_config.model}
            </Text>
          </div>
        )}
        
        {data.desc && (
          <div>
            <Text style={{ fontSize: 12, color: '#94a3b8' }}>
              {data.desc}
            </Text>
          </div>
        )}
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
