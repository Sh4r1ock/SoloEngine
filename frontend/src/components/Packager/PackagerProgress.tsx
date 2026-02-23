import React from 'react';
import { Progress, Typography, Space, Card } from 'antd';
import {
  CheckCircleOutlined,
  SyncOutlined,
  CloseCircleOutlined,
} from '@ant-design/icons';

const { Text } = Typography;

interface PackagerProgressProps {
  status: 'pending' | 'processing' | 'completed' | 'error';
  progress: number;
  message?: string;
  currentStep?: string;
}

const PackagerProgress: React.FC<PackagerProgressProps> = ({
  status,
  progress,
  message,
  currentStep,
}) => {
  const getStatusIcon = () => {
    switch (status) {
      case 'completed':
        return <CheckCircleOutlined style={{ color: '#52c41a', fontSize: 24 }} />;
      case 'error':
        return <CloseCircleOutlined style={{ color: '#ff4d4f', fontSize: 24 }} />;
      case 'processing':
        return <SyncOutlined spin style={{ color: '#1890ff', fontSize: 24 }} />;
      default:
        return null;
    }
  };

  const getProgressStatus = () => {
    switch (status) {
      case 'completed':
        return 'success';
      case 'error':
        return 'exception';
      case 'processing':
        return 'active';
      default:
        return 'normal';
    }
  };

  return (
    <Card>
      <Space direction="vertical" style={{ width: '100%' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {getStatusIcon()}
          <Text strong>
            {status === 'processing' && '正在打包...'}
            {status === 'completed' && '打包完成'}
            {status === 'error' && '打包失败'}
            {status === 'pending' && '等待打包'}
          </Text>
        </div>

        <Progress
          percent={progress}
          status={getProgressStatus()}
          strokeColor={{
            '0%': '#108ee9',
            '100%': '#87d068',
          }}
        />

        {currentStep && (
          <Text type="secondary">当前步骤: {currentStep}</Text>
        )}

        {message && (
          <Text type={status === 'error' ? 'danger' : 'secondary'}>
            {message}
          </Text>
        )}
      </Space>
    </Card>
  );
};

export default PackagerProgress;
