import React, { useState } from 'react';
import { Button, Tooltip } from 'antd';
import { PlusOutlined, ZoomInOutlined, ZoomOutOutlined, SettingOutlined } from '@ant-design/icons';
import { useCanvasStore } from '../../store/canvasStore';

interface ToolbarProps {
  reactFlowInstance: any;
}

const Toolbar: React.FC<ToolbarProps> = ({ reactFlowInstance }) => {
  const { addNode, setSettingsOpen } = useCanvasStore();
  const [pendingAdd, setPendingAdd] = useState(false);

  const handleDragStart = (event: React.DragEvent) => {
    event.dataTransfer.setData('application/reactflow', 'agent');
    event.dataTransfer.effectAllowed = 'move';
  };

  const handleAddClick = () => {
    setPendingAdd(true);
  };

  const handleCanvasClick = (event: React.MouseEvent) => {
    if (pendingAdd && reactFlowInstance) {
      const position = reactFlowInstance.project({
        x: event.clientX,
        y: event.clientY,
      });

      if (!position) return;

      const newNode = {
        id: `node_${Date.now()}`,
        type: 'agent' as const,
        position,
        data: {
          name: '新节点',
          desc: '',
          agentType: 'executor' as "orchestrator" | "planner" | "executor",
          system_prompt: '',
          user_prompt: '',
          assistant_prompt: '',
          model_config: {
            provider: 'openai',
            model: 'gpt-4',
          },
          skills: [],
        },
      };

      addNode(newNode as any);
      setPendingAdd(false);
    }
  };

  const handleZoomIn = () => {
    if (reactFlowInstance) {
      reactFlowInstance.zoomIn();
    }
  };

  const handleZoomOut = () => {
    if (reactFlowInstance) {
      reactFlowInstance.zoomOut();
    }
  };

  const handleSettingsClick = () => {
    setSettingsOpen(true);
  };

  return (
    <>
      <div
        style={{
          position: 'fixed',
          bottom: 24,
          left: '50%',
          transform: 'translateX(-50%)',
          display: 'flex',
          gap: 8,
          padding: 8,
          backgroundColor: '#FFFFFF',
          borderRadius: 8,
          boxShadow: '0 4px 12px rgba(0, 0, 0, 0.12)',
          border: '1px solid #cccccc',
          zIndex: 1000,
        }}
      >
        <Tooltip title="添加 Agent">
          <Button
            type="default"
            size="small"
            icon={<PlusOutlined />}
            draggable
            onDragStart={handleDragStart}
            onClick={handleAddClick}
          >
            Agent
          </Button>
        </Tooltip>

        <div style={{ width: 1, backgroundColor: '#cccccc', margin: '0 4px' }} />

        <Tooltip title="放大">
          <Button type="default" size="small" icon={<ZoomInOutlined />} onClick={handleZoomIn} />
        </Tooltip>

        <Tooltip title="缩小">
          <Button type="default" size="small" icon={<ZoomOutOutlined />} onClick={handleZoomOut} />
        </Tooltip>

        <div style={{ width: 1, backgroundColor: '#cccccc', margin: '0 4px' }} />

        <Tooltip title="设置">
          <Button type="default" size="small" icon={<SettingOutlined />} onClick={handleSettingsClick} />
        </Tooltip>
      </div>

      {pendingAdd && (
        <div
          onClick={handleCanvasClick}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.1)',
            cursor: 'crosshair',
            zIndex: 999,
          }}
        >
          <div
            style={{
              position: 'fixed',
              pointerEvents: 'none',
              padding: '8px 16px',
              backgroundColor: '#3F51B5',
            color: '#ffffff',
              borderRadius: 8,
              fontSize: 14,
              fontWeight: 500,
              opacity: 0.8,
            }}
          >
            点击画布添加 Agent
          </div>
        </div>
      )}
    </>
  );
};

export default Toolbar;
