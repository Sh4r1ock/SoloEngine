import React from 'react';
import { List, Typography, Tag, Space, Button, Card, Row, Col, Statistic, Progress, Empty } from 'antd';
import {
  ApiOutlined,
  DisconnectOutlined,
  EditOutlined,
  DeleteOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  LoadingOutlined,
} from '@ant-design/icons';
import { MCPServer } from '../../store/mcpStore';

const { Text } = Typography;

interface MCPServerListProps {
  servers: MCPServer[];
  onEdit: (server: MCPServer) => void;
  onDelete: (serverId: string) => void;
  onRefresh: () => void;
}

const MCPServerList: React.FC<MCPServerListProps> = ({
  servers,
  onEdit,
  onDelete,
  onRefresh,
}) => {
  // 获取状态图标和颜色
  const getStatusIcon = (status: MCPServer['status']) => {
    switch (status) {
      case 'connected': return <CheckCircleOutlined />;
      case 'disconnected': return <DisconnectOutlined />;
      case 'connecting': return <LoadingOutlined />;
      case 'error': return <CloseCircleOutlined />;
      default: return null;
    }
  };

  const getStatusColor = (status: MCPServer['status']) => {
    switch (status) {
      case 'connected': return 'green';
      case 'disconnected': return 'default';
      case 'connecting': return 'blue';
      case 'error': return 'red';
      default: return 'default';
    }
  };

  const getStatusText = (status: MCPServer['status']) => {
    switch (status) {
      case 'connected': return '已连接';
      case 'disconnected': return '未连接';
      case 'connecting': return '连接中...';
      case 'error': return '错误';
      default: return status;
    }
  };

  const getTransportColor = (transport: string) => {
    switch (transport) {
      case 'python_function': return 'purple';
      case 'stdio': return 'blue';
      case 'http': return 'green';
      case 'sse': return 'orange';
      case 'websocket': return 'purple';
      default: return 'default';
    }
  };

  return (
    <Row gutter={[16, 16]}>
      {servers.map((server) => (
        <Col span={12} key={server.id}>
          <Card
            hoverable
            style={{
              height: '100%',
              borderLeft: server.enabled ? `4px solid var(--success)` : '4px solid var(--bg-400)',
            }}
          >
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
              marginBottom: 16,
            }}>
              <Space>
                <ApiOutlined style={{ fontSize: 24, color: 'var(--primary-100)' }} />
                <div>
                  <Text strong style={{ fontSize: 16 }}>
                    {server.name}
                  </Text>
                  <div style={{ marginTop: 4 }}>
                    <Tag
                      color={getStatusColor(server.status)}
                      icon={getStatusIcon(server.status)}
                    >
                      {getStatusText(server.status)}
                    </Tag>
                    <Tag color={getTransportColor(server.source || server.transport)}>
                      {(server.source || server.transport).toUpperCase()}
                    </Tag>
                  </div>
                </div>
              </Space>
              <Space>
                <Button
                  type="text"
                  icon={<EditOutlined />}
                  onClick={() => onEdit(server)}
                  size="small"
                />
                <Button
                  type="text"
                  danger
                  icon={<DeleteOutlined />}
                  onClick={() => onDelete(server.id)}
                  size="small"
                />
              </Space>
            </div>

            <div style={{ marginBottom: 12 }}>
              <Text type="secondary" style={{ fontSize: 12 }}>
                URL:
              </Text>
              <Text code style={{ marginLeft: 4, fontSize: 12 }}>
                {server.url}
              </Text>
            </div>

            <Row gutter={16}>
              <Col span={8}>
                <Statistic
                  title="工具"
                  value={server.tools?.length || 0}
                  valueStyle={{ fontSize: 20 }}
                />
              </Col>
              <Col span={8}>
                <Statistic
                  title="资源"
                  value={server.resources?.length || 0}
                  valueStyle={{ fontSize: 20 }}
                />
              </Col>
              <Col span={8}>
                <Statistic
                  title="提示词"
                  value={server.prompts?.length || 0}
                  valueStyle={{ fontSize: 20 }}
                />
              </Col>
            </Row>

            {server.lastError && (
              <div style={{
                marginTop: 12,
                padding: '8px',
                background: '#fff2f0',
                border: '1px solid #ffccc7',
                borderRadius: 4,
                fontSize: 12,
                color: '#ff4d4f',
              }}>
                错误: {server.lastError}
              </div>
            )}
          </Card>
        </Col>
      ))}
    </Row>
  );
};

export default MCPServerList;
