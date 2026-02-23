import React from 'react';
import { List, Typography, Tag, Space, Empty, Collapse, Descriptions, Button } from 'antd';
import {
  ToolOutlined,
  ClockCircleOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  LoadingOutlined,
  CopyOutlined,
} from '@ant-design/icons';
import { useDebugStore, ExtendedDebugSession } from '../../store/debugStore';

const { Text, Paragraph } = Typography;
const { Panel } = Collapse;

interface ToolCall {
  id: string;
  name: string;
  status: 'success' | 'error' | 'pending' | string;
  duration?: number;
  arguments: Record<string, any>;
  result?: any;
  error?: string;
}

const OperationRecords: React.FC = () => {
  const {
    activeSessionId,
    sessions,
    toolFilter,
  } = useDebugStore();

  const activeSession: ExtendedDebugSession | undefined = activeSessionId
    ? sessions.find((s: ExtendedDebugSession) => s.id === activeSessionId)
    : undefined;

  const toolCalls: ToolCall[] = activeSession?.toolCalls || [];

  const filteredToolCalls: ToolCall[] = toolFilter && toolFilter !== 'all'
    ? toolCalls.filter((tc: ToolCall) => tc.name.toLowerCase().includes(toolFilter.toLowerCase()))
    : toolCalls;

  // 格式化持续时间
  const formatDuration = (duration?: number) => {
    if (!duration) return '-';
    if (duration < 1000) return `${duration}ms`;
    if (duration < 60000) return `${(duration / 1000).toFixed(2)}s`;
    return `${(duration / 60000).toFixed(2)}m`;
  };

  // 复制到剪贴板
  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  // 格式化 JSON
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
        <Empty description="请选择一个调试会话" />
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
            renderItem={(toolCall: ToolCall) => (
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
                  <ToolOutlined style={{ color: 'var(--primary-100)' }} />
                  <Text strong style={{ fontSize: 13 }}>
                    {toolCall.name}
                  </Text>
                  <Tag
                    color={toolCall.status === 'success' ? 'green' :
                           toolCall.status === 'error' ? 'red' :
                           toolCall.status === 'pending' ? 'orange' : 'default'}
                    icon={toolCall.status === 'success' ? <CheckCircleOutlined /> :
                           toolCall.status === 'error' ? <CloseCircleOutlined /> :
                           toolCall.status === 'pending' ? <LoadingOutlined /> : undefined}
                    style={{ margin: 0, fontSize: 11 }}
                  >
                    {toolCall.status === 'success' ? '成功' :
                     toolCall.status === 'error' ? '失败' :
                     toolCall.status === 'pending' ? '执行中' : toolCall.status}
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
                            <Descriptions.Item label="工具名称">
                              {toolCall.name}
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
                                  {formatJson(toolCall.arguments)}
                                </pre>
                                <Button
                                  type="text"
                                  size="small"
                                  icon={<CopyOutlined />}
                                  onClick={() => copyToClipboard(formatJson(toolCall.arguments))}
                                  style={{
                                    position: 'absolute',
                                    top: 4,
                                    right: 4,
                                  }}
                                />
                              </div>
                            </Descriptions.Item>
                            {toolCall.result !== undefined && (
                              <Descriptions.Item label="结果">
                                <div style={{ position: 'relative' }}>
                                  <pre style={{
                                    background: '#f6ffed',
                                    padding: '8px',
                                    borderRadius: 4,
                                    margin: 0,
                                    maxHeight: 150,
                                    overflow: 'auto',
                                    fontSize: 11,
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
                              <Descriptions.Item label="错误">
                                <Paragraph type="danger" style={{ margin: 0, fontSize: 12 }}>
                                  {toolCall.error}
                                </Paragraph>
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
