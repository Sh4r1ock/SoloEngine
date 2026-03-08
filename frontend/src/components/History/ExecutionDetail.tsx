import React from 'react';
import { Card, Descriptions, Typography, Tag, Divider, Timeline, Empty, Space, Button } from 'antd';
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  LoadingOutlined,
  DownloadOutlined,
} from '@ant-design/icons';
import { formatDateTime } from '../../utils/timezone';

const { Text, Title, Paragraph } = Typography;

interface ExecutionStep {
  step_id: string;
  step_type: string;
  node_id: string;
  node_name: string;
  timestamp: string;
  thought?: string;
  action?: string;
  observation?: string;
  error?: string;
  duration_ms?: number;
}

interface ExecutionDetailProps {
  record: {
    execution_id: string;
    project_name: string;
    status: string;
    start_time: string;
    end_time?: string;
    duration_ms?: number;
    input_message?: string;
    output_message?: string;
    error?: string;
    steps?: ExecutionStep[];
    token_usage?: {
      input_tokens?: number;
      output_tokens?: number;
      total_tokens?: number;
    };
  };
  onClose?: () => void;
}

const ExecutionDetail: React.FC<ExecutionDetailProps> = ({ record, onClose }) => {
  const handleExport = async () => {
    try {
      const response = await fetch(
        `/api/v1/history/${record.execution_id}/export?format=json`
      );
      const data = await response.json();
      const blob = new Blob([JSON.stringify(data.data, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `execution_${record.execution_id}.json`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Export failed:', error);
    }
  };

  return (
    <div style={{ padding: 16 }}>
      <Card>
        <Descriptions title="执行详情" bordered column={2}>
          <Descriptions.Item label="项目名称">{record.project_name}</Descriptions.Item>
          <Descriptions.Item label="状态">
            <Tag color={record.status === 'completed' ? 'success' : record.status === 'failed' ? 'error' : 'processing'}>
              {record.status}
            </Tag>
          </Descriptions.Item>
          <Descriptions.Item label="开始时间">
            {formatDateTime(record.start_time)}
          </Descriptions.Item>
          <Descriptions.Item label="结束时间">
            {record.end_time ? formatDateTime(record.end_time) : '-'}
          </Descriptions.Item>
          <Descriptions.Item label="耗时">
            {record.duration_ms ? `${(record.duration_ms / 1000).toFixed(2)}s` : '-'}
          </Descriptions.Item>
          <Descriptions.Item label="Token 使用">
            {record.token_usage?.total_tokens || '-'}
          </Descriptions.Item>
        </Descriptions>

        <Divider />

        <Title level={5}>输入</Title>
        <Paragraph>{record.input_message || '-'}</Paragraph>

        <Title level={5}>输出</Title>
        <Paragraph>{record.output_message || '-'}</Paragraph>

        {record.error && (
          <>
            <Title level={5} type="danger">错误</Title>
            <Paragraph type="danger">{record.error}</Paragraph>
          </>
        )}
      </Card>

      <Card style={{ marginTop: 16 }} title="执行步骤">
        {record.steps && record.steps.length > 0 ? (
          <Timeline
            items={record.steps.map((step, index) => ({
              color: step.error ? 'red' : 'green',
              dot: step.error ? <CloseCircleOutlined /> : <CheckCircleOutlined />,
              children: (
                <div>
                  <Text strong>步骤 {index + 1}: {step.node_name}</Text>
                  <br />
                  <Text type="secondary">
                    {formatDateTime(step.timestamp)}
                    {step.duration_ms && ` (${step.duration_ms}ms)`}
                  </Text>
                  {step.thought && (
                    <Paragraph style={{ marginTop: 8 }}>
                      <Text type="secondary">思考: </Text>
                      {step.thought}
                    </Paragraph>
                  )}
                  {step.action && (
                    <Paragraph>
                      <Text type="secondary">动作: </Text>
                      {step.action}
                    </Paragraph>
                  )}
                  {step.observation && (
                    <Paragraph>
                      <Text type="secondary">观察: </Text>
                      {step.observation}
                    </Paragraph>
                  )}
                </div>
              ),
            }))}
          />
        ) : (
          <Empty description="无执行步骤" />
        )}
      </Card>

      <Space style={{ marginTop: 16 }}>
        <Button onClick={onClose}>关闭</Button>
        <Button icon={<DownloadOutlined />} onClick={handleExport}>
          导出
        </Button>
      </Space>
    </div>
  );
};

export default ExecutionDetail;
