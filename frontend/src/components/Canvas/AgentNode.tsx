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

  return (
    <div
      style={{
        width: 220,
        backgroundColor: '#FFFFFF',
        borderRadius: 8,
        border: selected ? '2px solid #3F51B5' : '1px solid #cccccc',
        boxShadow: selected ? '0 4px 12px rgba(63, 81, 181, 0.15)' : '0 2px 8px rgba(0, 0, 0, 0.05)',
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
          <Text strong style={{ fontSize: 14, color: '#333333' }}>
            {data.name || '未命名节点'}
          </Text>
        </div>
        
        {data.model_config?.model && (
          <div style={{ marginBottom: 6 }}>
            <Text style={{ fontSize: 12, color: '#5c5c5c' }}>
              {data.model_config.model}
            </Text>
          </div>
        )}
        
        {data.desc && (
          <div>
            <Text style={{ fontSize: 12, color: '#9ca3af' }}>
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
