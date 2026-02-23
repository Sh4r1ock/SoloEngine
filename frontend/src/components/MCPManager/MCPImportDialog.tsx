import React, { useEffect, useState } from 'react';
import { Modal, List, Typography, Tag, Space, Button, Input, Empty, Spin, Card, Row, Col, message } from 'antd';
import { CloudDownloadOutlined, SearchOutlined, ApiOutlined } from '@ant-design/icons';
import { mcpApi } from '../../services/mcpApi';

const { Text, Paragraph } = Typography;

interface OpenMCP {
  id: string;
  name: string;
  description: string;
  author: string;
  version: string;
  url: string;
  transport: 'websocket' | 'http';
  tags: string[];
  stars: number;
}

interface MCPImportDialogProps {
  visible: boolean;
  onClose: () => void;
  onImport: () => void;
}

const MCPImportDialog: React.FC<MCPImportDialogProps> = ({ visible, onClose, onImport }) => {
  const [loading, setLoading] = useState(false);
  const [mcps, setMcps] = useState<OpenMCP[]>([]);
  const [filteredMcps, setFilteredMcps] = useState<OpenMCP[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [importing, setImporting] = useState<string | null>(null);

  // 加载开源 MCP 列表
  const loadOpenMCPList = async () => {
    setLoading(true);
    try {
      const response = await mcpApi.getOpenMCPList();
      if (response.code === 200) {
        setMcps(response.data);
        setFilteredMcps(response.data);
      } else {
        message.error('获取开源MCP列表失败：' + response.message);
        setMcps([]);
        setFilteredMcps([]);
      }
    } catch (error) {
      message.error('获取开源MCP列表失败：' + String(error));
      setMcps([]);
      setFilteredMcps([]);
    } finally {
      setLoading(false);
    }
  };

  // 导入 MCP
  const handleImport = async (mcp: OpenMCP) => {
    setImporting(mcp.id);
    try {
      const response = await mcpApi.importOpenMCP(mcp.id);
      if (response.code === 200) {
        message.success(`成功导入 ${mcp.name}`);
        onImport();
      }
    } catch (error) {
      message.error(`导入 ${mcp.name} 失败：` + String(error));
    } finally {
      setImporting(null);
    }
  };

  // 搜索过滤
  useEffect(() => {
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      setFilteredMcps(
        mcps.filter(mcp =>
          mcp.name.toLowerCase().includes(query) ||
          mcp.description.toLowerCase().includes(query) ||
          mcp.tags.some(tag => tag.toLowerCase().includes(query))
        )
      );
    } else {
      setFilteredMcps(mcps);
    }
  }, [searchQuery, mcps]);

  useEffect(() => {
    if (visible) {
      loadOpenMCPList();
    }
  }, [visible]);

  return (
    <Modal
      title={
        <Space>
          <CloudDownloadOutlined style={{ color: 'var(--primary-100)' }} />
          <span>导入开源 MCP</span>
        </Space>
      }
      open={visible}
      onCancel={onClose}
      footer={null}
      width={800}
    >
      <div style={{ marginBottom: 16 }}>
        <Input
          placeholder="搜索开源 MCP..."
          prefix={<SearchOutlined />}
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          allowClear
        />
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '48px' }}>
          <Spin size="large" />
        </div>
      ) : filteredMcps.length === 0 ? (
        <Empty description="没有找到匹配的 MCP" />
      ) : (
        <List
          dataSource={filteredMcps}
          renderItem={(mcp) => (
            <Card
              size="small"
              style={{ marginBottom: 12 }}
              hoverable
            >
              <Row gutter={16} align="middle">
                <Col span={16}>
                  <Space size={8} style={{ marginBottom: 4 }}>
                    <ApiOutlined style={{ color: 'var(--accent-100)' }} />
                    <Text strong style={{ fontSize: 14 }}>
                      {mcp.name}
                    </Text>
                    <Tag color="blue">{mcp.version}</Tag>
                    <Tag color={mcp.transport === 'websocket' ? 'purple' : 'green'}>
                      {mcp.transport.toUpperCase()}
                    </Tag>
                  </Space>
                  <Paragraph
                    style={{ margin: '8px 0', fontSize: 12 }}
                    ellipsis={{ rows: 2 }}
                  >
                    {mcp.description}
                  </Paragraph>
                  <Space size={4}>
                    <Text type="secondary" style={{ fontSize: 11 }}>
                      作者: {mcp.author}
                    </Text>
                    <Text type="secondary" style={{ fontSize: 11 }}>
                      ⭐ {mcp.stars}
                    </Text>
                  </Space>
                  <div style={{ marginTop: 8 }}>
                    {(mcp.tags || []).map((tag: string) => (
                      <Tag key={tag} style={{ marginBottom: 4, fontSize: 11 }}>
                        {tag}
                      </Tag>
                    ))}
                  </div>
                </Col>
                <Col span={8} style={{ textAlign: 'right' }}>
                  <Button
                    type="primary"
                    icon={<CloudDownloadOutlined />}
                    onClick={() => handleImport(mcp)}
                    loading={importing === mcp.id}
                    disabled={importing !== null}
                  >
                    导入
                  </Button>
                </Col>
              </Row>
            </Card>
          )}
        />
      )}
    </Modal>
  );
};

export default MCPImportDialog;
