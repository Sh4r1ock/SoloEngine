import React, { useState } from 'react';
import { Card, Input, Select, List, Typography, Tag, Empty, Collapse, Row, Col, Button, Space } from 'antd';
import { SearchOutlined, ApiOutlined, ExperimentOutlined } from '@ant-design/icons';
import { useMCPStore } from '../../store/mcpStore';
import { MCPTool } from '../../services/mcpApi';

const { Text, Paragraph } = Typography;

const MCPToolBrowser: React.FC = () => {
  const [searchQuery, setSearchQuery] = useState('');
  const [serverFilter, setServerFilter] = useState<string>('all');
  const { getAllTools, servers } = useMCPStore();

  const tools = getAllTools();

  const filteredTools = tools.filter((tool: MCPTool) => {
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      const matchesName = tool.name.toLowerCase().includes(query);
      const matchesDescription = tool.description?.toLowerCase().includes(query);
      if (!matchesName && !matchesDescription) {
        return false;
      }
    }

    if (serverFilter !== 'all' && tool.server_id !== serverFilter) {
      return false;
    }

    return true;
  });

  const serverOptions = [
    { value: 'all', label: '全部服务器' },
    ...servers.map(s => ({ value: s.id, label: s.name })),
  ];

  const getServerName = (serverId?: string) => {
    if (!serverId) return '未知服务器';
    const server = servers.find(s => s.id === serverId);
    return server?.name || '未知服务器';
  };

  return (
    <div>
      <Card
        title={
          <Space>
            <ExperimentOutlined style={{ color: 'var(--primary-100)' }} />
            <span>MCP 工具浏览器</span>
            <Tag>{filteredTools.length} 个工具</Tag>
          </Space>
        }
      >
        <Row gutter={16} style={{ marginBottom: 16 }}>
          <Col span={18}>
            <Input
              placeholder="搜索工具..."
              prefix={<SearchOutlined />}
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              allowClear
            />
          </Col>
          <Col span={6}>
            <Select
              style={{ width: '100%' }}
              value={serverFilter}
              onChange={setServerFilter}
              options={serverOptions}
            />
          </Col>
        </Row>

        {filteredTools.length === 0 ? (
          <Empty description="没有找到匹配的工具" />
        ) : (
          <List
            dataSource={filteredTools}
            renderItem={(tool: MCPTool, index: number) => (
              <Card
                size="small"
                style={{ marginBottom: 12 }}
                key={(tool.server_id || 'unknown') + '-' + tool.name + '-' + index}
              >
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
                }}>
                  <div style={{ flex: 1 }}>
                    <Space size={8} style={{ marginBottom: 8 }}>
                      <ApiOutlined style={{ color: 'var(--accent-100)' }} />
                      <Text strong style={{ fontSize: 14 }}>
                        {tool.name}
                      </Text>
                      <Tag color="blue" style={{ fontSize: 11 }}>
                        {getServerName(tool.server_id)}
                      </Tag>
                    </Space>
                    {tool.description && (
                      <Paragraph
                        style={{ margin: '8px 0', fontSize: 12, color: '#8c8c8c' }}
                        ellipsis={{ rows: 2, tooltip: tool.description }}
                      >
                        {tool.description}
                      </Paragraph>
                    )}
                  </div>
                  <Button
                    size="small"
                    type="primary"
                    onClick={() => {
                    }}
                  >
                    添加到画布
                  </Button>
                </div>

                {tool.input_schema && (
                  <Collapse
                    ghost
                    size="small"
                    style={{ marginTop: 8 }}
                    items={[
                      {
                        key: 'schema',
                        label: <Text type="secondary" style={{ fontSize: 12 }}>参数定义</Text>,
                        children: (
                          <pre style={{
                            background: '#f5f5f5',
                            padding: '12px',
                            borderRadius: 4,
                            margin: 0,
                            fontSize: 11,
                            maxHeight: 200,
                            overflow: 'auto',
                          }}>
                            {JSON.stringify(tool.input_schema, null, 2)}
                          </pre>
                        ),
                      },
                    ]}
                  />
                )}
              </Card>
            )}
          />
        )}
      </Card>
    </div>
  );
};

export default MCPToolBrowser;
