import React from 'react';
import { List, Typography, Tag, Space, Empty, Collapse, Descriptions, Button } from 'antd';
import {
  ToolOutlined,
  ClockCircleOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  LoadingOutlined,
  CopyOutlined,
  RobotOutlined,
  ApiOutlined,
} from '@ant-design/icons';
import { useRunStore, ExtendedRunSession, ToolCallRecord } from '../../store/runStore';

const { Text, Paragraph } = Typography;
const { Panel } = Collapse;

const getTypeConfig = (type: 'tool' | 'skill' | 'mcp') => {
  switch (type) {
    case 'tool':
      return { icon: ToolOutlined, color: '#1890ff', label: '工具' };
    case 'skill':
      return { icon: RobotOutlined, color: '#52c41a', label: '技能' };
    case 'mcp':
      return { icon: ApiOutlined, color: '#722ed1', label: 'MCP' };
    default:
      return { icon: ToolOutlined, color: '#1890ff', label: '工具' };
  }
};

const OperationRecords: React.FC = () => {
  const {
    activeSessionId,
    sessions,
    toolFilter,
  } = useRunStore();

  const activeSession: ExtendedRunSession | undefined = activeSessionId
    ? sessions.find((s: ExtendedRunSession) => s.id === activeSessionId)
    : undefined;

  const toolCalls: ToolCallRecord[] = activeSession?.toolCalls || [];

  const filteredToolCalls: ToolCallRecord[] = toolFilter && toolFilter !== 'all'
    ? toolCalls.filter((tc: ToolCallRecord) => tc.name.toLowerCase().includes(toolFilter.toLowerCase()))
    : toolCalls;

  const formatDuration = (duration?: number) => {
    if (!duration) return '-';
    if (duration < 1000) return `${duration}ms`;
    if (duration < 60000) return `${(duration / 1000).toFixed(2)}s`;
    return `${(duration / 60000).toFixed(2)}m`;
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  const formatJson = (obj: any) => {
    try {
      return JSON.stringify(obj, null, 2);
    } catch {
      return String(obj);
    }
  };

  if (!activeSession) {
    return (
      <div style={{
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#fafafa',
      }}>
        <Empty description="请选择一个运行会话" />
      </div>
    );
  }

  return (
    <div style={{ padding: '16px', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 16,
      }}>
        <Space>
          <Text strong>工具调用记录</Text>
          <Tag>{filteredToolCalls.length} 次调用</Tag>
        </Space>
      </div>

      <div style={{ flex: 1, overflow: 'auto' }}>
        {filteredToolCalls.length === 0 ? (
          <Empty description="暂无工具调用记录" style={{ marginTop: 48 }} />
        ) : (
          <List
            dataSource={filteredToolCalls}
            renderItem={(toolCall: ToolCallRecord) => (
              <div
                key={toolCall.id}
                style={{
                  marginBottom: 12,
                  padding: '12px',
                  borderRadius: 8,
                  background: '#fff',
                  border: '1px solid #f0f0f0',
                }}
              >
                <Space size={8} style={{ marginBottom: 8 }}>
                  {(() => {
                    const typeConfig = getTypeConfig(toolCall.type || 'tool');
                    const TypeIcon = typeConfig.icon;
                    return <TypeIcon style={{ color: typeConfig.color }} />;
                  })()}
                  <Text strong style={{ fontSize: 13 }}>
                    {toolCall.name}
                  </Text>
                  <Tag
                    color={(() => {
                      const typeConfig = getTypeConfig(toolCall.type || 'tool');
                      return typeConfig.color;
                    })()}
                    style={{ margin: 0, fontSize: 11 }}
                  >
                    {(() => {
                      const typeConfig = getTypeConfig(toolCall.type || 'tool');
                      return typeConfig.label;
                    })()}
                  </Tag>
                  <Tag
                    color={toolCall.status === 'success' ? 'green' :
                           toolCall.status === 'error' ? 'red' :
                           toolCall.status === 'pending' ? 'orange' :
                           toolCall.status === 'running' ? 'blue' : 'default'}
                    icon={toolCall.status === 'success' ? <CheckCircleOutlined /> :
                           toolCall.status === 'error' ? <CloseCircleOutlined /> :
                           toolCall.status === 'pending' ? <LoadingOutlined /> :
                           toolCall.status === 'running' ? <LoadingOutlined spin /> : undefined}
                    style={{ margin: 0, fontSize: 11 }}
                  >
                    {toolCall.status === 'success' ? '成功' :
                     toolCall.status === 'error' ? '失败' :
                     toolCall.status === 'pending' ? '等待中' :
                     toolCall.status === 'running' ? '执行中' : toolCall.status}
                  </Tag>
                  <Space size={4}>
                    <ClockCircleOutlined style={{ fontSize: 12, color: '#8c8c8c' }} />
                    <Text type="secondary" style={{ fontSize: 11 }}>
                      {formatDuration(toolCall.duration)}
                    </Text>
                  </Space>
                </Space>

                <Collapse
                  size="small"
                  ghost
                  items={[
                    {
                      key: 'details',
                      label: (
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          查看详情
                        </Text>
                      ),
                      children: (
                        <div style={{ marginTop: 8 }}>
                          <Descriptions size="small" column={1}>
                            <Descriptions.Item label="调用类型">
                              <Tag
                                color={(() => {
                                  const typeConfig = getTypeConfig(toolCall.type || 'tool');
                                  return typeConfig.color;
                                })()}
                              >
                                {(() => {
                                  const typeConfig = getTypeConfig(toolCall.type || 'tool');
                                  return typeConfig.label;
                                })()}
                              </Tag>
                            </Descriptions.Item>
                            <Descriptions.Item label="名称">
                              {toolCall.name}
                            </Descriptions.Item>
                            <Descriptions.Item label="调用时长">
                              <Space size={4}>
                                <ClockCircleOutlined style={{ fontSize: 12 }} />
                                <Text>{formatDuration(toolCall.duration)}</Text>
                              </Space>
                            </Descriptions.Item>
                            <Descriptions.Item label="参数">
                              <div style={{ position: 'relative' }}>
                                <pre style={{
                                  background: '#f5f5f5',
                                  padding: '8px',
                                  borderRadius: 4,
                                  margin: 0,
                                  maxHeight: 150,
                                  overflow: 'auto',
                                  fontSize: 11,
                                }}>
                                  {formatJson(toolCall.arguments || {})}
                                </pre>
                                <Button
                                  type="text"
                                  size="small"
                                  icon={<CopyOutlined />}
                                  onClick={() => copyToClipboard(formatJson(toolCall.arguments || {}))}
                                  style={{
                                    position: 'absolute',
                                    top: 4,
                                    right: 4,
                                  }}
                                />
                              </div>
                            </Descriptions.Item>
                            {toolCall.result !== undefined && (
                              <Descriptions.Item label="调用结果">
                                <div style={{ position: 'relative' }}>
                                  <pre style={{
                                    background: toolCall.status === 'error' ? '#fff2f0' : '#f6ffed',
                                    padding: '8px',
                                    borderRadius: 4,
                                    margin: 0,
                                    maxHeight: 200,
                                    overflow: 'auto',
                                    fontSize: 11,
                                    border: `1px solid ${toolCall.status === 'error' ? '#ffccc7' : '#b7eb8f'}`,
                                  }}>
                                    {formatJson(toolCall.result)}
                                  </pre>
                                  <Button
                                    type="text"
                                    size="small"
                                    icon={<CopyOutlined />}
                                    onClick={() => copyToClipboard(formatJson(toolCall.result))}
                                    style={{
                                      position: 'absolute',
                                      top: 4,
                                      right: 4,
                                    }}
                                  />
                                </div>
                              </Descriptions.Item>
                            )}
                            {toolCall.error && (
                              <Descriptions.Item label="错误信息">
                                <div style={{
                                  background: '#fff2f0',
                                  border: '1px solid #ffccc7',
                                  borderRadius: 4,
                                  padding: '8px 12px',
                                }}>
                                  <Paragraph type="danger" style={{ margin: 0, fontSize: 12 }}>
                                    {toolCall.error}
                                  </Paragraph>
                                </div>
                              </Descriptions.Item>
                            )}
                          </Descriptions>
                        </div>
                      ),
                    },
                  ]}
                />
              </div>
            )}
          />
        )}
      </div>
    </div>
  );
};

export default OperationRecords;
