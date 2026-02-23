import React from 'react';
import { Card, Typography, Row, Col, Statistic, Progress, Tag, Space, Divider, Empty } from 'antd';
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  LoadingOutlined,
  ThunderboltOutlined,
  ClockCircleOutlined,
} from '@ant-design/icons';

const { Title, Text } = Typography;

interface ToolCall {
  id: string;
  tool_name: string;
  arguments: Record<string, any>;
  result?: any;
  error?: string;
  timestamp: string;
  duration_ms?: number;
}

interface FunctionCallVisualizationProps {
  toolCalls: ToolCall[];
  loading?: boolean;
}

const FunctionCallVisualization: React.FC<FunctionCallVisualizationProps> = ({
  toolCalls,
  loading = false,
}) => {
  const getStatusIcon = (call: ToolCall) => {
    if (call.error) {
      return <CloseCircleOutlined style={{ color: '#ff4d4f' }} />;
    }
    if (call.result !== undefined) {
      return <CheckCircleOutlined style={{ color: '#52c41a' }} />;
    }
    return <LoadingOutlined style={{ color: '#1890ff' }} />;
  };

  const getStatusTag = (call: ToolCall) => {
    if (call.error) {
      return <Tag color="error">失败</Tag>;
    }
    if (call.result !== undefined) {
      return <Tag color="success">成功</Tag>;
    }
    return <Tag color="processing">执行中</Tag>;
  };

  if (loading) {
    return (
      <Card>
        <div style={{ textAlign: 'center', padding: 24 }}>
          <LoadingOutlined style={{ fontSize: 32, color: '#1890ff' }} />
          <Text type="secondary" style={{ display: 'block', marginTop: 8 }}>
            正在执行工具调用...
          </Text>
        </div>
      </Card>
    );
  }

  if (toolCalls.length === 0) {
    return (
      <Card title="工具调用记录">
        <Empty description="暂无工具调用记录" />
      </Card>
    );
  }

  const successCount = toolCalls.filter((c) => !c.error && c.result !== undefined).length;
  const failCount = toolCalls.filter((c) => c.error).length;
  const totalDuration = toolCalls.reduce((sum, c) => sum + (c.duration_ms || 0), 0);

  return (
    <div>
      <Card style={{ marginBottom: 16 }}>
        <Row gutter={16}>
          <Col span={6}>
            <Statistic
              title="总调用次数"
              value={toolCalls.length}
              prefix={<ThunderboltOutlined />}
            />
          </Col>
          <Col span={6}>
            <Statistic
              title="成功"
              value={successCount}
              valueStyle={{ color: '#52c41a' }}
              prefix={<CheckCircleOutlined />}
            />
          </Col>
          <Col span={6}>
            <Statistic
              title="失败"
              value={failCount}
              valueStyle={{ color: '#ff4d4f' }}
              prefix={<CloseCircleOutlined />}
            />
          </Col>
          <Col span={6}>
            <Statistic
              title="总耗时"
              value={totalDuration}
              suffix="ms"
              prefix={<ClockCircleOutlined />}
            />
          </Col>
        </Row>
      </Card>

      <Card title="调用详情">
        {toolCalls.map((call, index) => (
          <Card
            key={call.id}
            size="small"
            style={{ marginBottom: 8 }}
            title={
              <Space>
                {getStatusIcon(call)}
                <Text strong>{call.tool_name}</Text>
                {getStatusTag(call)}
              </Space>
            }
            extra={
              <Space>
                {call.duration_ms && <Text type="secondary">{call.duration_ms}ms</Text>}
                <Text type="secondary">{new Date(call.timestamp).toLocaleTimeString()}</Text>
              </Space>
            }
          >
            <div style={{ marginBottom: 8 }}>
              <Text type="secondary">参数:</Text>
              <pre style={{ margin: 0, padding: 8, background: '#f5f5f5', borderRadius: 4, overflow: 'auto' }}>
                {JSON.stringify(call.arguments, null, 2)}
              </pre>
            </div>

            {call.result !== undefined && (
              <div>
                <Text type="secondary">结果:</Text>
                <pre style={{ margin: 0, padding: 8, background: '#f6ffed', borderRadius: 4, overflow: 'auto' }}>
                  {typeof call.result === 'string' ? call.result : JSON.stringify(call.result, null, 2)}
                </pre>
              </div>
            )}

            {call.error && (
              <div>
                <Text type="danger">错误:</Text>
                <pre style={{ margin: 0, padding: 8, background: '#fff2f0', borderRadius: 4 }}>
                  {call.error}
                </pre>
              </div>
            )}
          </Card>
        ))}
      </Card>
    </div>
  );
};

export default FunctionCallVisualization;
