/**
 * @file components/CallRecordPanel.tsx
 * @description 工具调用记录面板组件
 */

import React, { useState } from 'react';
import { List, Typography, Tag, Space, Empty, Collapse, Button, Tooltip } from 'antd';
import {
  ToolOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  LoadingOutlined,
  CopyOutlined,
  RobotOutlined,
  ApiOutlined,
  CodeOutlined,
  FileTextOutlined,
  GlobalOutlined,
  CodeSandboxOutlined,
} from '@ant-design/icons';
import type { CallRecord } from '../types';

const { Text, Paragraph } = Typography;
const { Panel } = Collapse;

const TOOL_NAME_MAP: Record<string, string> = {
  'Read': '读取文件',
  'Write': '写入文件',
  'DeleteFile': '删除文件',
  'LS': '列出目录',
  'SearchReplace': '搜索替换',
  'Grep': '正则搜索',
  'Glob': '文件匹配',
  'SearchCodebase': '搜索代码库',
  'RunCommand': '执行命令',
  'CheckCommandStatus': '检查命令状态',
  'StopCommand': '停止命令',
  'GetDiagnostics': '获取诊断',
  'WebFetch': '获取网页',
  'WebSearch': '网络搜索',
  'Skill': '技能',
  'Task': '任务',
  'TodoWrite': '待办事项',
  'AskUserQuestion': '询问用户',
  'OpenPreview': '打开预览',
  'mcp_list_tools': 'MCP工具列表',
  'mcp_call_tool': 'MCP调用工具',
};

const getTypeConfig = (type: string) => {
  switch (type) {
    case 'tool':
      return { icon: ToolOutlined, color: '#1890ff', label: '工具' };
    case 'skill':
      return { icon: RobotOutlined, color: '#52c41a', label: '技能' };
    case 'mcp':
      return { icon: ApiOutlined, color: '#722ed1', label: 'MCP' };
    case 'child_agent':
      return { icon: RobotOutlined, color: '#eb2f96', label: '子模型' };
    default:
      return { icon: ToolOutlined, color: '#1890ff', label: '工具' };
  }
};

const getToolIcon = (name?: string) => {
  const toolName = name?.toLowerCase() || '';
  if (toolName.includes('read') || toolName.includes('file')) {
    return <FileTextOutlined style={{ color: '#1890ff' }} />;
  }
  if (toolName.includes('write') || toolName.includes('edit') || toolName.includes('code')) {
    return <CodeOutlined style={{ color: '#52c41a' }} />;
  }
  if (toolName.includes('browser') || toolName.includes('navigate')) {
    return <GlobalOutlined style={{ color: '#722ed1' }} />;
  }
  if (toolName.includes('terminal') || toolName.includes('shell') || toolName.includes('bash')) {
    return <CodeSandboxOutlined style={{ color: '#fa8c16' }} />;
  }
  return <ToolOutlined style={{ color: '#8c8c8c' }} />;
};

const formatDuration = (duration?: number) => {
  if (!duration) return '-';
  if (duration < 1000) return `${duration}ms`;
  if (duration < 60000) return `${(duration / 1000).toFixed(2)}s`;
  return `${(duration / 60000).toFixed(2)}m`;
};

const formatJson = (obj: any) => {
  try {
    return JSON.stringify(obj, null, 2);
  } catch {
    return String(obj);
  }
};

const copyToClipboard = (text: string) => {
  navigator.clipboard.writeText(text);
};

interface CallRecordPanelProps {
  records: CallRecord[];
  maxHeight?: number;
}

const CallRecordPanel: React.FC<CallRecordPanelProps> = ({
  records,
  maxHeight = 400,
}) => {
  const sortedRecords = [...records].sort((a, b) => {
    const timeA = a.startTime || new Date(a.timestamp || '').getTime() || 0;
    const timeB = b.startTime || new Date(b.timestamp || '').getTime() || 0;
    return timeB - timeA;
  });

  return (
    <div style={{ padding: '12px 16px', height: maxHeight, overflow: 'auto' }}>
      {records.length === 0 ? (
        <Empty description="暂无工具调用记录" style={{ marginTop: 48 }} />
      ) : (
        <List
          dataSource={sortedRecords}
          renderItem={(record: CallRecord) => {
            const typeConfig = getTypeConfig(record.type);
            const TypeIcon = typeConfig.icon;
            
            return (
              <div
                key={record.id}
                style={{
                  marginBottom: 12,
                  padding: '12px',
                  borderRadius: 8,
                  background: '#fff',
                  border: '1px solid #f0f0f0',
                }}
              >
                <Space size={8} style={{ marginBottom: 8 }}>
                  {getToolIcon(record.name)}
                  <Tag
                    color={typeConfig.color}
                    style={{ margin: 0, fontSize: 11 }}
                  >
                    {TOOL_NAME_MAP[record.name] || record.name}
                  </Tag>
                  <Tag
                    color={
                      record.status === 'success' ? 'success' :
                      record.status === 'error' ? 'error' :
                      record.status === 'running' ? 'processing' : 'default'
                    }
                    icon={
                      record.status === 'success' ? <CheckCircleOutlined /> :
                      record.status === 'error' ? <CloseCircleOutlined /> :
                      record.status === 'running' ? <LoadingOutlined spin /> : undefined
                    }
                    style={{ margin: 0, fontSize: 11 }}
                  >
                    {record.status === 'success' ? '成功' :
                     record.status === 'error' ? '失败' :
                     record.status === 'running' ? '执行中' : record.status}
                  </Tag>
                  <Text type="secondary" style={{ fontSize: 11 }}>
                    {formatDuration(record.duration)}
                  </Text>
                </Space>

                <Collapse
                  size="small"
                  ghost
                  items={[
                    {
                      key: 'args',
                      label: <Text type="secondary" style={{ fontSize: 12 }}>参数</Text>,
                      children: record.arguments ? (
                        <div style={{ position: 'relative' }}>
                          <pre style={{
                            background: '#f5f5f5',
                            padding: '8px 12px',
                            borderRadius: 6,
                            margin: 0,
                            maxHeight: 150,
                            overflow: 'auto',
                            fontSize: 11,
                            fontFamily: 'Consolas, Monaco, monospace',
                          }}>
                            {formatJson(record.arguments)}
                          </pre>
                          <Tooltip title="复制">
                            <Button
                              type="text"
                              size="small"
                              icon={<CopyOutlined />}
                              onClick={() => copyToClipboard(formatJson(record.arguments))}
                              style={{
                                position: 'absolute',
                                top: 4,
                                right: 4,
                              }}
                            />
                          </Tooltip>
                        </div>
                      ) : null,
                    },
                    {
                      key: 'result',
                      label: <Text type="secondary" style={{ fontSize: 12 }}>结果</Text>,
                      children: record.result ? (
                        <div style={{ position: 'relative' }}>
                          <pre style={{
                            background: record.status === 'error' ? '#fff2f0' : '#f6ffed',
                            padding: '8px 12px',
                            borderRadius: 6,
                            margin: 0,
                            maxHeight: 200,
                            overflow: 'auto',
                            fontSize: 11,
                            fontFamily: 'Consolas, Monaco, monospace',
                            whiteSpace: 'pre-wrap',
                            wordBreak: 'break-word',
                          }}>
                            {record.error || (typeof record.result === 'string' ? record.result : formatJson(record.result))}
                          </pre>
                          <Tooltip title="复制">
                            <Button
                              type="text"
                              size="small"
                              icon={<CopyOutlined />}
                              onClick={() => copyToClipboard(
                                record.error || (typeof record.result === 'string' ? record.result : formatJson(record.result))
                              )}
                              style={{
                                position: 'absolute',
                                top: 4,
                                right: 4,
                              }}
                            />
                          </Tooltip>
                        </div>
                      ) : null,
                    },
                  ]}
                />
              </div>
            );
          }}
        />
      )}
    </div>
  );
};

export default CallRecordPanel;
