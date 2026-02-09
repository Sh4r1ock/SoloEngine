import React from 'react';
import { Card } from 'antd';

const NodePanel: React.FC = () => {
  const nodeTypes = [
    { type: 'orchestrator', label: '协调者', color: '#1890ff', desc: '负责管理整体流程' },
    { type: 'planner', label: '规划者', color: '#52c41a', desc: '负责拆解复杂目标' },
    { type: 'executor', label: '执行者', color: '#fa8c16', desc: '负责执行具体任务' },
  ];

  const onDragStart = (event: React.DragEvent, nodeType: string) => {
    event.dataTransfer.setData('application/reactflow', nodeType);
    event.dataTransfer.effectAllowed = 'move';
  };

  return (
    <Card title="节点面板" style={{ height: '100%', overflowY: 'auto' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {nodeTypes.map((node) => (
          <div
            key={node.type}
            draggable
            onDragStart={(e) => onDragStart(e, node.type)}
            style={{
              padding: 12,
              backgroundColor: node.color,
              color: 'white',
              borderRadius: 8,
              cursor: 'grab',
              userSelect: 'none',
            }}
          >
            <div style={{ fontWeight: 'bold', marginBottom: 4 }}>{node.label}</div>
            <div style={{ fontSize: 12, opacity: 0.9 }}>{node.desc}</div>
          </div>
        ))}
      </div>
    </Card>
  );
};

export default NodePanel;
