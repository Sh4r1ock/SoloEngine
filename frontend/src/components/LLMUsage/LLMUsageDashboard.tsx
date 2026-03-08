import React from 'react';
import { Card, Row, Col, Statistic, Typography, Divider, Empty } from 'antd';
import {
  ThunderboltOutlined,
  ClockCircleOutlined,
  NumberOutlined,
  ApiOutlined,
} from '@ant-design/icons';
import { formatDateTime } from '../../utils/timezone';

const { Title, Text } = Typography;

interface UsageStats {
  timeRangeHours: number;
  totalRequests: number;
  totalTokens: number;
  avgTokensPerRequest: number;
  avgTimePerRequest: number;
}

interface UsageRecord {
  id: string;
  provider: string;
  model_name: string;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  duration_ms: number;
  timestamp: string;
}

interface LLMUsageDashboardProps {
  stats?: UsageStats | null;
  recentRecords?: UsageRecord[];
  loading?: boolean;
}

const LLMUsageDashboard: React.FC<LLMUsageDashboardProps> = ({
  stats,
  recentRecords = [],
  loading = false,
}) => {
  return (
    <div style={{ padding: '24px' }}>
      <Title level={4}>
        <ApiOutlined style={{ marginRight: 8 }} />
        LLM 使用统计
      </Title>
      <Divider />

      {stats ? (
        <>
          <Row gutter={[16, 16]}>
            <Col span={6}>
              <Card>
                <Statistic
                  title="总请求数"
                  value={stats.totalRequests}
                  prefix={<NumberOutlined />}
                  valueStyle={{ color: '#3f8600' }}
                />
              </Card>
            </Col>
            <Col span={6}>
              <Card>
                <Statistic
                  title="总 Token 数"
                  value={stats.totalTokens}
                  prefix={<ThunderboltOutlined />}
                  valueStyle={{ color: '#1890ff' }}
                />
              </Card>
            </Col>
            <Col span={6}>
              <Card>
                <Statistic
                  title="平均 Token/请求"
                  value={stats.avgTokensPerRequest}
                  precision={2}
                  valueStyle={{ color: '#722ed1' }}
                />
              </Card>
            </Col>
            <Col span={6}>
              <Card>
                <Statistic
                  title="平均耗时 (秒)"
                  value={stats.avgTimePerRequest}
                  precision={2}
                  prefix={<ClockCircleOutlined />}
                  valueStyle={{ color: '#fa8c16' }}
                />
              </Card>
            </Col>
          </Row>

          <Divider orientation="left">最近调用记录</Divider>

          {recentRecords.length > 0 ? (
            <Row gutter={[16, 16]}>
              {recentRecords.slice(0, 10).map((record) => (
                <Col span={12} key={record.id}>
                  <Card size="small">
                    <Row justify="space-between">
                      <Col>
                        <Text strong>{record.provider}</Text>
                        <Text type="secondary" style={{ marginLeft: 8 }}>
                          {record.model_name}
                        </Text>
                      </Col>
                      <Col>
                        <Text type="secondary">
                          {formatDateTime(record.timestamp)}
                        </Text>
                      </Col>
                    </Row>
                    <Row style={{ marginTop: 8 }}>
                      <Col span={8}>
                        <Text type="secondary">输入: </Text>
                        <Text>{record.input_tokens}</Text>
                      </Col>
                      <Col span={8}>
                        <Text type="secondary">输出: </Text>
                        <Text>{record.output_tokens}</Text>
                      </Col>
                      <Col span={8}>
                        <Text type="secondary">耗时: </Text>
                        <Text>{record.duration_ms}ms</Text>
                      </Col>
                    </Row>
                  </Card>
                </Col>
              ))}
            </Row>
          ) : (
            <Empty description="暂无调用记录" />
          )}
        </>
      ) : (
        <Empty description="暂无使用统计数据" />
      )}
    </div>
  );
};

export default LLMUsageDashboard;
