import React, { useState, useEffect } from 'react';
import { Modal, List, Tag, Typography, Progress, Space } from 'antd';
import { CheckCircleOutlined, SyncOutlined, ClockCircleOutlined } from '@ant-design/icons';
import { WebSocketEvent } from '../../types/canvas';

const { Text } = Typography;

interface ExecutionStep {
  id: string;
  nodeType: string;
  status: 'pending' | 'running' | 'completed' | 'error';
  message: string;
  timestamp: string;
}

interface MonitorProps {
  visible: boolean;
  onClose: () => void;
}

const Monitor: React.FC<MonitorProps> = ({ visible, onClose }) => {
  const [steps, setSteps] = useState<ExecutionStep[]>([]);
  const [overallProgress, setOverallProgress] = useState(0);

  const addStep = (event: WebSocketEvent) => {
    const newStep: ExecutionStep = {
      id: event.node_id || 'unknown',
      nodeType: event.node_id?.split('_')[0] || 'unknown',
      status: event.status === 'completed' ? 'completed' : 'running',
      message: event.message || '',
      timestamp: new Date().toLocaleTimeString(),
    };

    setSteps((prev) => {
      const existingIndex = prev.findIndex((s) => s.id === newStep.id);
      if (existingIndex >= 0) {
        const updated = [...prev];
        updated[existingIndex] = newStep;
        return updated;
      }
      return [...prev, newStep];
    });

    if (event.status === 'completed') {
      setOverallProgress((prev) => Math.min(prev + 25, 100));
    }
  };

  const reset = () => {
    setSteps([]);
    setOverallProgress(0);
  };

  useEffect(() => {
    window.addEventListener('ws-message', ((event: CustomEvent) => {
      addStep(event.detail);
    }) as EventListener);

    return () => {
      window.removeEventListener('ws-message', ((event: CustomEvent) => {
        addStep(event.detail);
      }) as EventListener);
    };
  }, []);

  const getStatusIcon = (status: ExecutionStep['status']) => {
    switch (status) {
      case 'completed':
        return <CheckCircleOutlined style={{ color: '#52c41a' }} />;
      case 'running':
        return <SyncOutlined spin style={{ color: '#1677ff' }} />;
      case 'error':
        return <SyncOutlined style={{ color: '#ff4d4f' }} />;
      default:
        return <ClockCircleOutlined style={{ color: '#8c8c8c' }} />;
    }
  };

  const getStatusTag = (status: ExecutionStep['status']) => {
    switch (status) {
      case 'completed':
        return <Tag color="success">已完成</Tag>;
      case 'running':
        return <Tag color="processing">执行中</Tag>;
      case 'error':
        return <Tag color="error">错误</Tag>;
      default:
        return <Tag color="default">待执行</Tag>;
    }
  };

  const getNodeTypeLabel = (nodeType: string) => {
    switch (nodeType) {
      case 'orchestrator':
        return '协调者';
      case 'planner':
        return '规划者';
      case 'executor':
        return '执行者';
      default:
        return '未知';
    }
  };

  return (
    <Modal
      title="运行状态监控"
      open={visible}
      onCancel={onClose}
      width={600}
      footer={null}
    >
      <Space style={{ width: '100%', marginBottom: 16 }}>
        <Text type="secondary">进度:</Text>
        <Progress percent={overallProgress} size="small" style={{ flex: 1 }} />
      </Space>
      
      <List
        style={{ maxHeight: 400, overflowY: 'auto' }}
        dataSource={steps}
        renderItem={(step) => (
          <List.Item>
            <List.Item.Meta
              avatar={getStatusIcon(step.status)}
              title={
                <Space>
                  <Text strong>{step.id}</Text>
                  <Text type="secondary">{getNodeTypeLabel(step.nodeType)}</Text>
                  {getStatusTag(step.status)}
                </Space>
              }
              description={
                <div>
                  <Text>{step.message}</Text>
                  <br />
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {step.timestamp}
                  </Text>
                </div>
              }
            />
          </List.Item>
        )}
      />
    </Modal>
  );
};

export default Monitor;
