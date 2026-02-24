/**
 * @file MCPManager.tsx
 * @description MCP管理器主组件 - MCP工具管理核心组件
 * @author SoloEngine Team
 * @date 2026-02-19
 */
import React, { useEffect, useState } from 'react';
import { Typography, Button, Space, Modal, message, Empty, Spin, Tag, Row, Col } from 'antd';
import {
  PlusOutlined,
  CloudDownloadOutlined,
  ReloadOutlined,
  ApiOutlined,
  DisconnectOutlined,
} from '@ant-design/icons';
import { mcpApi } from '../../services/mcpApi';
import MCPAddServerModal from './MCPAddServerModal';
import MCPImportDialog from './MCPImportDialog';
import UnifiedCard from '../common/UnifiedCard';

const { Title, Text } = Typography;

interface ServerData {
  id: string;
  user_id?: string;
  name: string;
  transport: string;
  url?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  headers?: Record<string, string>;
  timeout: number;
  enabled: boolean;
  is_public?: boolean;
  is_default?: boolean;
  author?: string;
  source?: string;
  description?: string;
  tags?: string[];
  version: number;
  created_at?: string;
  updated_at?: string;
  status?: string;
}

const MCPManager: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [servers, setServers] = useState<ServerData[]>([]);
  const [addModalVisible, setAddModalVisible] = useState(false);
  const [importModalVisible, setImportModalVisible] = useState(false);
  const [editingServer, setEditingServer] = useState<ServerData | null>(null);

  const loadServerList = async () => {
    setLoading(true);
    try {
      const response = await mcpApi.getServers();
      if (response.code === 200) {
        setServers(response.data || []);
      }
    } catch (error) {
      message.error('加载 MCP 工具列表失败：' + String(error));
    } finally {
      setLoading(false);
    }
  };

  const handleAddServer = () => {
    setEditingServer(null);
    setAddModalVisible(true);
  };

  const handleEditServer = (server: ServerData) => {
    setEditingServer(server);
    setAddModalVisible(true);
  };

  const handleDeleteServer = async (serverId: string) => {
    try {
      await mcpApi.deleteServer(serverId);
      message.success('MCP 工具已删除');
      loadServerList();
    } catch (error) {
      message.error('删除 MCP 工具失败：' + String(error));
    }
  };

  const handleConnectServer = async (serverId: string) => {
    try {
      const response = await mcpApi.connectServer(serverId);
      if (response.code === 200) {
        message.success('连接成功');
        loadServerList();
      } else {
        message.error('连接失败：' + response.message);
      }
    } catch (error) {
      message.error('连接失败：' + String(error));
    }
  };

  const handleDisconnectServer = async (serverId: string) => {
    try {
      await mcpApi.disconnectServer(serverId);
      message.success('已断开连接');
      loadServerList();
    } catch (error) {
      message.error('断开连接失败：' + String(error));
    }
  };

  const handleRefresh = () => {
    loadServerList();
  };

  const handleImport = () => {
    setImportModalVisible(true);
  };

  const handleSaveServer = () => {
    setAddModalVisible(false);
    setEditingServer(null);
    loadServerList();
  };

  useEffect(() => {
    loadServerList();
  }, []);

  const getStatusText = (status?: string) => {
    switch (status) {
      case 'connected': return '已连接';
      case 'connecting': return '连接中';
      case 'error': return '错误';
      default: return '未连接';
    }
  };

  return (
    <div style={{ padding: '24px' }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 24,
      }}>
        <div>
          <Title level={3} style={{ margin: 0 }}>MCP 工具</Title>
          <Text type="secondary" style={{ fontSize: 13 }}>
            管理模型上下文协议工具
          </Text>
        </div>
        <Space>
          <Button
            icon={<CloudDownloadOutlined />}
            onClick={handleImport}
          >
            导入 MCP
          </Button>
          <Button
            icon={<PlusOutlined />}
            type="primary"
            onClick={handleAddServer}
          >
            新建 MCP
          </Button>
          <Button
            icon={<ReloadOutlined />}
            onClick={handleRefresh}
            loading={loading}
          >
            刷新
          </Button>
        </Space>
      </div>

      {loading && servers.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '48px' }}>
          <Spin size="large" />
        </div>
      ) : servers.length === 0 ? (
        <Empty
          style={{ padding: '60px 20px' }}
          description={
            <span>
              暂无 MCP 工具
              <br />
              <Text type="secondary" style={{ fontSize: 13 }}>
                点击上方"新建 MCP"按钮创建您的第一个工具
              </Text>
            </span>
          }
        />
      ) : (
        <Row gutter={[16, 16]}>
          {servers.map((server) => (
            <Col xs={24} sm={12} md={8} lg={6} key={server.id}>
              <UnifiedCard
                name={server.name}
                description={server.is_default 
                  ? (server.description || '系统默认MCP工具')
                  : (server.url || server.command || '无地址')
                }
                icon={<ApiOutlined />}
                tags={server.is_default 
                  ? [server.transport.toUpperCase(), ...(server.tags || [])]
                  : [server.transport.toUpperCase()]
                }
                status={server.status}
                statusText={getStatusText(server.status)}
                meta1={{ 
                  label: server.is_default ? '作者' : '超时', 
                  value: server.is_default ? (server.author || 'SoloEngine') : `${server.timeout}s` 
                }}
                updatedAt={server.updated_at}
                isDefault={server.is_default}
                onClick={() => !server.is_default && handleEditServer(server)}
                onPlay={
                  server.is_default 
                    ? undefined 
                    : server.status === 'connected'
                      ? () => handleDisconnectServer(server.id)
                      : () => handleConnectServer(server.id)
                }
                onDelete={server.is_default ? undefined : () => handleDeleteServer(server.id)}
                deleteConfirmText="确定要删除此MCP工具吗？"
              />
            </Col>
          ))}
        </Row>
      )}

      <MCPAddServerModal
        visible={addModalVisible}
        server={editingServer as any}
        onClose={() => {
          setAddModalVisible(false);
          setEditingServer(null);
        }}
        onSave={handleSaveServer}
      />

      <MCPImportDialog
        visible={importModalVisible}
        onClose={() => setImportModalVisible(false)}
        onImport={() => {
          setImportModalVisible(false);
          loadServerList();
        }}
      />
    </div>
  );
};

export default MCPManager;
