/**
 * @file CallRecordItem.tsx
 * @description 调用记录项组件 - 工具/Skills/MCP/子模型调用的折叠展示
 * @author SoloEngine Team
 * @date 2026-02-24
 */

import React, { useState } from 'react';
import { Collapse, Tag, Space, Typography, Descriptions, Button, Tooltip, Empty } from 'antd';
import {
  ToolOutlined,
  RocketOutlined,
  ApiOutlined,
  RobotOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  LoadingOutlined,
  CopyOutlined,
  RightOutlined,
  DownOutlined,
  CodeOutlined,
  FileTextOutlined,
  GlobalOutlined,
  TerminalOutlined,
} from '@ant-design/icons';

const { Text, Paragraph } = Typography;

export type CallType = 'tool' | 'skill' | 'mcp' | 'child_agent';

export interface CallRecord {
  id: string;
  type: CallType;
  name: string;
  status: 'success' | 'error' | 'pending' | 'running';
  duration?: number;
  arguments?: Record<string, any>;
  result?: any;
  error?: string;
  timestamp: string;
  childCalls?: CallRecord[];
  output?: string;
}

interface CallRecordItemProps {
  record: CallRecord;
  defaultExpanded?: boolean;
  showDetails?: boolean;
}

const getCallIcon = (type: CallType, name?: string) => {
  if (type === 'tool') {
    const toolName = name?.toLowerCase() || '';
    if (toolName.includes('read') || toolName.includes('file')) {
      return <FileTextOutlined style={{ color: '#1890ff' }} />;
    }
    if (toolName.includes('write') || toolName.includes('code')) {
      return <CodeOutlined style={{ color: '#52c41a' }} />;
    }
    if (toolName.includes('web') || toolName.includes('search')) {
      return <GlobalOutlined style={{ color: '#722ed1' }} />;
    }
    if (toolName.includes('terminal') || toolName.includes('command')) {
      return <TerminalOutlined style={{ color: '#fa8c16' }} />;
    }
    return <ToolOutlined style={{ color: '#1890ff' }} />;
  }
  if (type === 'skill') {
    return <RocketOutlined style={{ color: '#52c41a' }} />;
  }
  if (type === 'mcp') {
    return <ApiOutlined style={{ color: '#722ed1' }} />;
  }
  if (type === 'child_agent') {
    return <RobotOutlined style={{ color: '#eb2f96' }} />;
  }
  return <ToolOutlined />;
};

const getCallTypeLabel = (type: CallType) => {
  const labels: Record<CallType, string> = {
    tool: '工具调用',
    skill: 'Skills调用',
    mcp: 'MCP调用',
    child_agent: '子模型调用',
  };
  return labels[type];
};

const getCallTypeColor = (type: CallType) => {
  const colors: Record<CallType, string> = {
    tool: 'blue',
    skill: 'green',
    mcp: 'purple',
    child_agent: 'magenta',
  };
  return colors[type];
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

const CallRecordItem: React.FC<CallRecordItemProps> = ({
  record,
  defaultExpanded = false,
  showDetails = true,
}) => {
  const [expanded, setExpanded] = useState(defaultExpanded);

  const isChildAgent = record.type === 'child_agent';
  const hasChildren = record.childCalls && record.childCalls.length > 0;

  const renderCollapsedHeader = () => (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        width: '100%',
        cursor: 'pointer',
      }}
      onClick={() => !isChildAgent && setExpanded(!expanded)}
    >
      <Space size={8}>
        {getCallIcon(record.type, record.name)}
        <Text strong style={{ fontSize: 13 }}>
          {record.name}
        </Text>
        <Tag color={getCallTypeColor(record.type)} style={{ margin: 0, fontSize: 11 }}>
          {getCallTypeLabel(record.type)}
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
      </Space>
      <Space size={8}>
        <Text type="secondary" style={{ fontSize: 11 }}>
          {formatDuration(record.duration)}
        </Text>
        {!isChildAgent && (
          expanded ? <DownOutlined style={{ fontSize: 10 }} /> : <RightOutlined style={{ fontSize: 10 }} />
        )}
      </Space>
    </div>
  );

  const renderDetails = () => (
    <div style={{ marginTop: 12 }}>
      {record.arguments && Object.keys(record.arguments).length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <Text type="secondary" style={{ fontSize: 12, marginBottom: 4, display: 'block' }}>
            调用参数
          </Text>
          <div style={{ position: 'relative' }}>
            <pre
              style={{
                background: '#f5f5f5',
                padding: '8px 12px',
                borderRadius: 6,
                margin: 0,
                maxHeight: 150,
                overflow: 'auto',
                fontSize: 11,
                fontFamily: 'var(--font-family-code)',
              }}
            >
              {formatJson(record.arguments)}
            </pre>
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
          </div>
        </div>
      )}

      {record.result !== undefined && (
        <div style={{ marginBottom: 12 }}>
          <Text type="secondary" style={{ fontSize: 12, marginBottom: 4, display: 'block' }}>
            返回结果
          </Text>
          <div style={{ position: 'relative' }}>
            <pre
              style={{
                background: '#f6ffed',
                padding: '8px 12px',
                borderRadius: 6,
                margin: 0,
                maxHeight: 200,
                overflow: 'auto',
                fontSize: 11,
                fontFamily: 'var(--font-family-code)',
                border: '1px solid #b7eb8f',
              }}
            >
              {typeof record.result === 'string' ? record.result : formatJson(record.result)}
            </pre>
            <Button
              type="text"
              size="small"
              icon={<CopyOutlined />}
              onClick={() => copyToClipboard(
                typeof record.result === 'string' ? record.result : formatJson(record.result)
              )}
              style={{
                position: 'absolute',
                top: 4,
                right: 4,
              }}
            />
          </div>
        </div>
      )}

      {record.output && (
        <div style={{ marginBottom: 12 }}>
          <Text type="secondary" style={{ fontSize: 12, marginBottom: 4, display: 'block' }}>
            LLM 输出
          </Text>
          <div
            style={{
              background: '#fff',
              padding: '12px',
              borderRadius: 6,
              border: '1px solid #d9d9d9',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              fontSize: 13,
              maxHeight: 300,
              overflow: 'auto',
            }}
          >
            {record.output}
          </div>
        </div>
      )}

      {record.error && (
        <div>
          <Text type="secondary" style={{ fontSize: 12, marginBottom: 4, display: 'block' }}>
            错误信息
          </Text>
          <Paragraph type="danger" style={{ margin: 0, fontSize: 12 }}>
            {record.error}
          </Paragraph>
        </div>
      )}

      {hasChildren && (
        <div style={{ marginTop: 12 }}>
          <Text type="secondary" style={{ fontSize: 12, marginBottom: 8, display: 'block' }}>
            内部调用 ({record.childCalls!.length})
          </Text>
          <div style={{ paddingLeft: 12, borderLeft: '2px solid #f0f0f0' }}>
            {record.childCalls!.map((child, index) => (
              <CallRecordItem
                key={child.id || index}
                record={child}
                defaultExpanded={child.type === 'child_agent'}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );

  if (isChildAgent) {
    return (
      <div
        style={{
          marginBottom: 12,
          padding: '12px',
          borderRadius: 8,
          background: '#fff',
          border: '1px solid #f0f0f0',
        }}
      >
        {renderCollapsedHeader()}
        {renderDetails()}
      </div>
    );
  }

  return (
    <div
      style={{
        marginBottom: 8,
        borderRadius: 8,
        background: '#fff',
        border: '1px solid #f0f0f0',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          padding: '10px 12px',
          borderBottom: expanded ? '1px solid #f0f0f0' : 'none',
          background: expanded ? '#fafafa' : '#fff',
        }}
      >
        {renderCollapsedHeader()}
      </div>
      {expanded && (
        <div style={{ padding: '12px' }}>
          {renderDetails()}
        </div>
      )}
    </div>
  );
};

export default CallRecordItem;
