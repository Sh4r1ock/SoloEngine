/**
 * @file DynamicOperationArea.tsx
 * @description 动态操作区组件 - 根据工具调用类型自动切换界面
 * @author SoloEngine Team
 * @date 2026-02-24
 */

import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Tabs,
  Card,
  Typography,
  Tag,
  Space,
  Button,
  Empty,
  Spin,
  Tooltip,
  Badge,
  message,
  Divider,
  Image,
} from 'antd';
import {
  FileTextOutlined,
  CodeOutlined,
  TerminalOutlined,
  GlobalOutlined,
  SearchOutlined,
  DatabaseOutlined,
  ApiOutlined,
  RobotOutlined,
  ToolOutlined,
  EyeOutlined,
  CopyOutlined,
  DownloadOutlined,
  PlayCircleOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  LoadingOutlined,
  PlusOutlined,
  MinusOutlined,
  FileAddOutlined,
  LinkOutlined,
  PictureOutlined,
  HistoryOutlined,
  RocketOutlined,
} from '@ant-design/icons';

const { Text, Paragraph, Title } = Typography;

export type OperationType = 
  | 'document' 
  | 'code' 
  | 'terminal' 
  | 'browser' 
  | 'search' 
  | 'database' 
  | 'api' 
  | 'agent';

export interface OperationEvent {
  id: string;
  type: OperationType;
  toolName: string;
  status: 'pending' | 'running' | 'success' | 'error';
  timestamp: string;
  input?: any;
  output?: any;
  error?: string;
  metadata?: Record<string, any>;
  callType?: 'tool' | 'skill' | 'mcp' | 'child_agent';
  duration?: number;
}

interface DynamicOperationAreaProps {
  events: OperationEvent[];
  activeEventId?: string;
  onEventSelect?: (eventId: string) => void;
}

const getOperationIcon = (type: OperationType) => {
  switch (type) {
    case 'document':
      return <FileTextOutlined style={{ color: '#1890ff' }} />;
    case 'code':
      return <CodeOutlined style={{ color: '#52c41a' }} />;
    case 'terminal':
      return <TerminalOutlined style={{ color: '#fa8c16' }} />;
    case 'browser':
      return <GlobalOutlined style={{ color: '#722ed1' }} />;
    case 'search':
      return <SearchOutlined style={{ color: '#13c2c2' }} />;
    case 'database':
      return <DatabaseOutlined style={{ color: '#eb2f96' }} />;
    case 'api':
      return <ApiOutlined style={{ color: '#2f54eb' }} />;
    case 'agent':
      return <RobotOutlined style={{ color: '#52c41a' }} />;
    default:
      return <ToolOutlined />;
  }
};

const getOperationLabel = (type: OperationType) => {
  const labels: Record<OperationType, string> = {
    document: '文档查看器',
    code: '代码编辑器',
    terminal: '终端',
    browser: '浏览器',
    search: '搜索',
    database: '数据库',
    api: 'API调用',
    agent: 'Agent执行',
  };
  return labels[type];
};

const detectOperationType = (toolName: string): OperationType => {
  const name = toolName.toLowerCase();
  
  if (name.includes('read') || name.includes('file') || name.includes('document')) {
    return 'document';
  }
  if (name.includes('write') || name.includes('code') || name.includes('edit')) {
    return 'code';
  }
  if (name.includes('terminal') || name.includes('command') || name.includes('shell') || name.includes('bash')) {
    return 'terminal';
  }
  if (name.includes('browser') || name.includes('navigate') || name.includes('screenshot')) {
    return 'browser';
  }
  if (name.includes('search') || name.includes('web')) {
    return 'search';
  }
  if (name.includes('database') || name.includes('sql') || name.includes('query')) {
    return 'database';
  }
  if (name.includes('api') || name.includes('http') || name.includes('request')) {
    return 'api';
  }
  if (name.includes('agent') || name.includes('model')) {
    return 'agent';
  }
  
  return 'document';
};

const DocumentViewer: React.FC<{ event: OperationEvent }> = ({ event }) => {
  const content = event.output?.content || event.output?.result || event.output || '';
  const filePath = event.input?.file_path || event.input?.path || event.metadata?.filePath;
  const fileSize = event.metadata?.size;
  const encoding = event.metadata?.encoding || 'utf-8';
  const isJson = useMemo(() => {
    try {
      if (typeof content === 'object') return true;
      if (typeof content === 'string') {
        JSON.parse(content);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }, [content]);

  const formatFileSize = (bytes?: number) => {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  const renderContent = () => {
    if (isJson && typeof content !== 'string') {
      return (
        <pre style={{ 
          margin: 0, 
          whiteSpace: 'pre-wrap', 
          wordBreak: 'break-word',
          fontFamily: 'var(--font-family-code)',
          fontSize: 13,
        }}>
          {JSON.stringify(content, null, 2)}
        </pre>
      );
    }
    if (isJson && typeof content === 'string') {
      try {
        const parsed = JSON.parse(content);
        return (
          <pre style={{ 
            margin: 0, 
            whiteSpace: 'pre-wrap', 
            wordBreak: 'break-word',
            fontFamily: 'var(--font-family-code)',
            fontSize: 13,
          }}>
            {JSON.stringify(parsed, null, 2)}
          </pre>
        );
      } catch {
        return (
          <pre style={{ 
            margin: 0, 
            whiteSpace: 'pre-wrap', 
            wordBreak: 'break-word',
            fontFamily: 'var(--font-family-code)',
            fontSize: 13,
          }}>
            {content}
          </pre>
        );
      }
    }
    return (
      <pre style={{ 
        margin: 0, 
        whiteSpace: 'pre-wrap', 
        wordBreak: 'break-word',
        fontFamily: 'var(--font-family-code)',
        fontSize: 13,
      }}>
        {typeof content === 'string' ? content : JSON.stringify(content, null, 2)}
      </pre>
    );
  };
  
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ 
        padding: '8px 12px', 
        borderBottom: '1px solid #f0f0f0',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        background: '#fafafa',
      }}>
        <Space>
          <FileTextOutlined style={{ color: '#1890ff' }} />
          <Text strong style={{ maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {filePath || '文档内容'}
          </Text>
          {isJson && <Tag color="blue">JSON</Tag>}
        </Space>
        <Space>
          {fileSize && (
            <Text type="secondary" style={{ fontSize: 12 }}>
              {formatFileSize(fileSize)}
            </Text>
          )}
          <Tooltip title="复制内容">
            <Button 
              type="text" 
              size="small" 
              icon={<CopyOutlined />}
              onClick={() => {
                navigator.clipboard.writeText(typeof content === 'string' ? content : JSON.stringify(content, null, 2));
                message.success('已复制');
              }}
            />
          </Tooltip>
          <Tooltip title="下载">
            <Button type="text" size="small" icon={<DownloadOutlined />} />
          </Tooltip>
        </Space>
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: 12 }}>
        {renderContent()}
      </div>
    </div>
  );
};

const CodeEditor: React.FC<{ event: OperationEvent }> = ({ event }) => {
  const content = event.output?.content || event.output?.code || event.output || '';
  const language = event.input?.language || event.metadata?.language || 'javascript';
  const filePath = event.input?.file_path || event.input?.filename || event.input?.path;
  const originalContent = event.input?.old_content || event.input?.original || event.metadata?.originalContent;
  const newContent = event.input?.new_content || event.input?.content || event.metadata?.newContent;
  const hasDiff = originalContent !== undefined && newContent !== undefined;
  const [viewMode, setViewMode] = useState<'content' | 'diff'>('content');

  const renderDiffLine = (line: string, type: 'add' | 'remove' | 'same', lineNum: number) => {
    const bgColor = type === 'add' ? '#1e3a1e' : type === 'remove' ? '#3a1e1e' : 'transparent';
    const textColor = type === 'add' ? '#89d185' : type === 'remove' ? '#f48771' : '#d4d4d4';
    const prefix = type === 'add' ? '+' : type === 'remove' ? '-' : ' ';
    
    return (
      <div key={lineNum} style={{ display: 'flex', background: bgColor }}>
        <span style={{ 
          width: 40, 
          textAlign: 'right', 
          paddingRight: 8, 
          color: '#858585',
          userSelect: 'none',
          borderRight: '1px solid #404040',
        }}>
          {lineNum}
        </span>
        <span style={{ 
          width: 20, 
          textAlign: 'center',
          color: textColor,
          userSelect: 'none',
        }}>
          {prefix}
        </span>
        <span style={{ 
          color: textColor,
          whiteSpace: 'pre',
        }}>
          {line}
        </span>
      </div>
    );
  };

  const computeDiff = (oldStr: string, newStr: string) => {
    const oldLines = oldStr.split('\n');
    const newLines = newStr.split('\n');
    const result: Array<{ line: string; type: 'add' | 'remove' | 'same'; oldNum?: number; newNum?: number }> = [];
    
    let oldIdx = 0;
    let newIdx = 0;
    
    while (oldIdx < oldLines.length || newIdx < newLines.length) {
      if (oldIdx >= oldLines.length) {
        result.push({ line: newLines[newIdx], type: 'add', newNum: newIdx + 1 });
        newIdx++;
      } else if (newIdx >= newLines.length) {
        result.push({ line: oldLines[oldIdx], type: 'remove', oldNum: oldIdx + 1 });
        oldIdx++;
      } else if (oldLines[oldIdx] === newLines[newIdx]) {
        result.push({ line: oldLines[oldIdx], type: 'same', oldNum: oldIdx + 1, newNum: newIdx + 1 });
        oldIdx++;
        newIdx++;
      } else {
        const oldLineInNew = newLines.slice(newIdx).indexOf(oldLines[oldIdx]);
        const newLineInOld = oldLines.slice(oldIdx).indexOf(newLines[newIdx]);
        
        if (oldLineInNew === -1 && newLineInOld === -1) {
          result.push({ line: oldLines[oldIdx], type: 'remove', oldNum: oldIdx + 1 });
          result.push({ line: newLines[newIdx], type: 'add', newNum: newIdx + 1 });
          oldIdx++;
          newIdx++;
        } else if (oldLineInNew !== -1 && (newLineInOld === -1 || oldLineInNew <= newLineInOld)) {
          for (let i = 0; i < oldLineInNew; i++) {
            result.push({ line: newLines[newIdx + i], type: 'add', newNum: newIdx + i + 1 });
          }
          newIdx += oldLineInNew;
        } else {
          for (let i = 0; i < newLineInOld; i++) {
            result.push({ line: oldLines[oldIdx + i], type: 'remove', oldNum: oldIdx + i + 1 });
          }
          oldIdx += newLineInOld;
        }
      }
    }
    
    return result;
  };

  const diffLines = useMemo(() => {
    if (hasDiff) {
      return computeDiff(originalContent, newContent);
    }
    return [];
  }, [hasDiff, originalContent, newContent]);

  const stats = useMemo(() => {
    if (!hasDiff) return null;
    const added = diffLines.filter(l => l.type === 'add').length;
    const removed = diffLines.filter(l => l.type === 'remove').length;
    return { added, removed };
  }, [hasDiff, diffLines]);
  
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ 
        padding: '8px 12px', 
        borderBottom: '1px solid #f0f0f0',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        background: '#fafafa',
      }}>
        <Space>
          <CodeOutlined style={{ color: '#52c41a' }} />
          <Text strong style={{ maxWidth: 250, overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {filePath || '代码'}
          </Text>
          <Tag>{language}</Tag>
          {hasDiff && (
            <Tag color="orange">已修改</Tag>
          )}
        </Space>
        <Space>
          {hasDiff && (
            <>
              {stats && (
                <Space size={4}>
                  <Text type="secondary" style={{ fontSize: 11 }}>
                    <PlusOutlined style={{ color: '#52c41a' }} /> {stats.added}
                  </Text>
                  <Text type="secondary" style={{ fontSize: 11 }}>
                    <MinusOutlined style={{ color: '#ff4d4f' }} /> {stats.removed}
                  </Text>
                </Space>
              )}
              <Button 
                type="text" 
                size="small"
                icon={viewMode === 'diff' ? <EyeOutlined /> : <FileAddOutlined />}
                onClick={() => setViewMode(viewMode === 'diff' ? 'content' : 'diff')}
              >
                {viewMode === 'diff' ? '内容' : '差异'}
              </Button>
            </>
          )}
          <Tooltip title="复制代码">
            <Button 
              type="text" 
              size="small" 
              icon={<CopyOutlined />}
              onClick={() => {
                const textToCopy = hasDiff && viewMode === 'diff' 
                  ? newContent 
                  : (typeof content === 'string' ? content : JSON.stringify(content, null, 2));
                navigator.clipboard.writeText(textToCopy);
                message.success('已复制');
              }}
            />
          </Tooltip>
        </Space>
      </div>
      <div style={{ flex: 1, overflow: 'auto', background: '#1e1e1e' }}>
        {hasDiff && viewMode === 'diff' ? (
          <div style={{ padding: '8px 0', fontFamily: 'var(--font-family-code)', fontSize: 13 }}>
            {diffLines.map((item, idx) => renderDiffLine(item.line, item.type, idx + 1))}
          </div>
        ) : (
          <pre style={{ 
            margin: 0, 
            padding: 12,
            color: '#d4d4d4',
            fontFamily: 'var(--font-family-code)',
            fontSize: 13,
          }}>
            {typeof content === 'string' ? content : JSON.stringify(content, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
};

const TerminalView: React.FC<{ event: OperationEvent }> = ({ event }) => {
  const output = event.output?.output || event.output?.result || event.output || '';
  const command = event.input?.command || event.input?.cmd || '';
  
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ 
        padding: '8px 12px', 
        borderBottom: '1px solid #f0f0f0',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        background: '#1e1e1e',
      }}>
        <Space>
          <TerminalOutlined style={{ color: '#fa8c16' }} />
          <Text style={{ color: '#fff' }} strong>终端</Text>
        </Space>
        <Tag color={event.status === 'success' ? 'success' : 'error'}>
          {event.status === 'success' ? '退出码: 0' : `退出码: ${event.output?.exit_code || 1}`}
        </Tag>
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: 12, background: '#1e1e1e' }}>
        {command && (
          <div style={{ marginBottom: 8 }}>
            <Text style={{ color: '#4ec9b0' }}>$ {command}</Text>
          </div>
        )}
        <pre style={{ 
          margin: 0, 
          color: event.status === 'success' ? '#d4d4d4' : '#f48771',
          fontFamily: 'var(--font-family-code)',
          fontSize: 13,
          whiteSpace: 'pre-wrap',
        }}>
          {typeof output === 'string' ? output : JSON.stringify(output, null, 2)}
        </pre>
      </div>
    </div>
  );
};

const BrowserView: React.FC<{ event: OperationEvent }> = ({ event }) => {
  const url = event.input?.url || event.output?.url || '';
  const title = event.output?.title || event.metadata?.title || '';
  const screenshot = event.output?.screenshot || event.output?.image || event.metadata?.screenshot;
  const pageContent = event.output?.content || event.output?.text || event.metadata?.content;
  const action = event.input?.action || event.metadata?.action || 'navigate';
  const status = event.output?.status || event.metadata?.status;
  
  const getActionLabel = (actionType: string) => {
    const labels: Record<string, string> = {
      navigate: '导航',
      click: '点击',
      type: '输入',
      screenshot: '截图',
      scroll: '滚动',
      wait: '等待',
      extract: '提取',
    };
    return labels[actionType] || actionType;
  };

  const renderScreenshot = () => {
    if (!screenshot) return null;
    const src = screenshot.startsWith('data:') ? screenshot : `data:image/png;base64,${screenshot}`;
    return (
      <div style={{ textAlign: 'center' }}>
        <Image
          src={src}
          alt="Screenshot"
          style={{ maxWidth: '100%', borderRadius: 8 }}
          placeholder={
            <div style={{ 
              width: '100%', 
              height: 200, 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'center',
              background: '#f5f5f5',
              borderRadius: 8,
            }}>
              <Spin />
            </div>
          }
        />
      </div>
    );
  };
  
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ 
        padding: '8px 12px', 
        borderBottom: '1px solid #f0f0f0',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        background: '#fafafa',
      }}>
        <Space>
          <GlobalOutlined style={{ color: '#722ed1' }} />
          <Text strong style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {title || '浏览器'}
          </Text>
          <Tag color="purple">{getActionLabel(action)}</Tag>
          {status && (
            <Tag color={status === 'success' ? 'success' : 'warning'}>
              {status}
            </Tag>
          )}
        </Space>
        <Space>
          {url && (
            <Tooltip title={url}>
              <Button 
                type="link" 
                size="small" 
                href={url} 
                target="_blank"
                icon={<LinkOutlined />}
              >
                打开链接
              </Button>
            </Tooltip>
          )}
        </Space>
      </div>
      
      <div style={{ flex: 1, overflow: 'auto', padding: 12 }}>
        {title && (
          <div style={{ marginBottom: 12 }}>
            <Text type="secondary" style={{ fontSize: 12 }}>页面标题</Text>
            <Text strong style={{ display: 'block', marginTop: 4 }}>{title}</Text>
          </div>
        )}
        
        {url && (
          <div style={{ marginBottom: 12 }}>
            <Text type="secondary" style={{ fontSize: 12 }}>URL</Text>
            <Paragraph 
              copyable 
              style={{ 
                margin: '4px 0', 
                fontSize: 12,
                wordBreak: 'break-all',
              }}
            >
              {url}
            </Paragraph>
          </div>
        )}
        
        {screenshot ? (
          <div>
            <Text type="secondary" style={{ fontSize: 12, marginBottom: 8, display: 'block' }}>
              <PictureOutlined /> 页面截图
            </Text>
            {renderScreenshot()}
          </div>
        ) : pageContent ? (
          <div>
            <Text type="secondary" style={{ fontSize: 12, marginBottom: 8, display: 'block' }}>
              页面内容
            </Text>
            <pre style={{ 
              margin: 0, 
              whiteSpace: 'pre-wrap', 
              wordBreak: 'break-word',
              fontFamily: 'var(--font-family-code)',
              fontSize: 12,
              background: '#f5f5f5',
              padding: 12,
              borderRadius: 6,
              maxHeight: 300,
              overflow: 'auto',
            }}>
              {typeof pageContent === 'string' ? pageContent : JSON.stringify(pageContent, null, 2)}
            </pre>
          </div>
        ) : (
          <div style={{ textAlign: 'center', padding: 40 }}>
            <GlobalOutlined style={{ fontSize: 48, color: '#d9d9d9' }} />
            <Text type="secondary" style={{ display: 'block', marginTop: 16 }}>
              {event.output?.message || '浏览器操作完成'}
            </Text>
          </div>
        )}
      </div>
    </div>
  );
};

const SearchView: React.FC<{ event: OperationEvent }> = ({ event }) => {
  const query = event.input?.query || event.input?.search || '';
  const results = event.output?.results || event.output || [];
  
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ 
        padding: '8px 12px', 
        borderBottom: '1px solid #f0f0f0',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}>
        <Space>
          <SearchOutlined style={{ color: '#13c2c2' }} />
          <Text strong>搜索结果</Text>
        </Space>
        <Text type="secondary">"{query}"</Text>
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: 12 }}>
        {Array.isArray(results) && results.length > 0 ? (
          results.map((item: any, index: number) => (
            <Card key={index} size="small" style={{ marginBottom: 8 }}>
              <Text strong style={{ display: 'block', marginBottom: 4 }}>
                {item.title || item.name || `结果 ${index + 1}`}
              </Text>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {item.url || item.link || item.description || JSON.stringify(item).substring(0, 200)}
              </Text>
            </Card>
          ))
        ) : (
          <Empty description="无搜索结果" />
        )}
      </div>
    </div>
  );
};

const AgentView: React.FC<{ event: OperationEvent }> = ({ event }) => {
  const output = event.output?.output || event.output?.response || event.output || '';
  
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ 
        padding: '8px 12px', 
        borderBottom: '1px solid #f0f0f0',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}>
        <Space>
          <RobotOutlined style={{ color: '#52c41a' }} />
          <Text strong>{event.toolName || 'Agent'}</Text>
        </Space>
        <Tag color={event.status === 'success' ? 'success' : 'error'}>
          {event.status}
        </Tag>
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: 12 }}>
        <div style={{ 
          whiteSpace: 'pre-wrap', 
          wordBreak: 'break-word',
          fontSize: 13,
        }}>
          {typeof output === 'string' ? output : JSON.stringify(output, null, 2)}
        </div>
      </div>
    </div>
  );
};

const DynamicOperationArea: React.FC<DynamicOperationAreaProps> = ({
  events,
  activeEventId,
  onEventSelect,
}) => {
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [sidebarWidth] = useState(240);
  
  useEffect(() => {
    if (events.length > 0 && !activeKey) {
      const latestEvent = events[events.length - 1];
      setActiveKey(latestEvent.id);
    }
  }, [events, activeKey]);
  
  useEffect(() => {
    if (activeEventId) {
      setActiveKey(activeEventId);
    }
  }, [activeEventId]);
  
  const activeEvent = events.find(e => e.id === activeKey);

  const getCallTypeIcon = (callType?: 'tool' | 'skill' | 'mcp' | 'child_agent') => {
    switch (callType) {
      case 'tool':
        return <ToolOutlined style={{ color: '#1890ff', fontSize: 12 }} />;
      case 'skill':
        return <RocketOutlined style={{ color: '#52c41a', fontSize: 12 }} />;
      case 'mcp':
        return <ApiOutlined style={{ color: '#722ed1', fontSize: 12 }} />;
      case 'child_agent':
        return <RobotOutlined style={{ color: '#eb2f96', fontSize: 12 }} />;
      default:
        return null;
    }
  };

  const getCallTypeTag = (callType?: 'tool' | 'skill' | 'mcp' | 'child_agent') => {
    if (!callType) return null;
    const config: Record<string, { color: string; label: string }> = {
      tool: { color: 'blue', label: '工具' },
      skill: { color: 'green', label: '技能' },
      mcp: { color: 'purple', label: 'MCP' },
      child_agent: { color: 'magenta', label: '子模型' },
    };
    const { color, label } = config[callType] || { color: 'default', label: callType };
    return <Tag color={color} style={{ fontSize: 10, margin: 0, padding: '0 4px' }}>{label}</Tag>;
  };

  const formatDuration = (duration?: number) => {
    if (!duration) return '';
    if (duration < 1000) return `${duration}ms`;
    if (duration < 60000) return `${(duration / 1000).toFixed(1)}s`;
    return `${(duration / 60000).toFixed(1)}m`;
  };

  const formatTimestamp = (timestamp: string) => {
    try {
      const date = new Date(timestamp);
      return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch {
      return '';
    }
  };
  
  const renderOperationContent = (event: OperationEvent) => {
    switch (event.type) {
      case 'document':
        return <DocumentViewer event={event} />;
      case 'code':
        return <CodeEditor event={event} />;
      case 'terminal':
        return <TerminalView event={event} />;
      case 'browser':
        return <BrowserView event={event} />;
      case 'search':
        return <SearchView event={event} />;
      case 'agent':
        return <AgentView event={event} />;
      default:
        return (
          <div style={{ padding: 24 }}>
            <pre style={{ whiteSpace: 'pre-wrap' }}>
              {JSON.stringify(event.output, null, 2)}
            </pre>
          </div>
        );
    }
  };
  
  const getEventStatusIcon = (status: string) => {
    switch (status) {
      case 'success':
        return <CheckCircleOutlined style={{ color: '#52c41a' }} />;
      case 'error':
        return <CloseCircleOutlined style={{ color: '#ff4d4f' }} />;
      case 'running':
        return <LoadingOutlined spin style={{ color: '#1890ff' }} />;
      default:
        return null;
    }
  };

  const renderSidebarHeader = () => (
    <div style={{ 
      padding: '8px 12px', 
      borderBottom: '1px solid #f0f0f0',
      background: '#fafafa',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
    }}>
      <Space>
        <HistoryOutlined style={{ color: '#8c8c8c' }} />
        <Text strong style={{ fontSize: 13 }}>调用记录</Text>
      </Space>
      <Tag style={{ margin: 0 }}>{events.length}</Tag>
    </div>
  );

  const renderEventItem = (event: OperationEvent) => {
    const isActive = activeKey === event.id;
    return (
      <div
        key={event.id}
        onClick={() => {
          setActiveKey(event.id);
          onEventSelect?.(event.id);
        }}
        style={{
          padding: '10px 12px',
          cursor: 'pointer',
          background: isActive ? '#e6f7ff' : 'transparent',
          borderLeft: isActive ? '3px solid #1890ff' : '3px solid transparent',
          transition: 'all 0.2s',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          {getOperationIcon(event.type)}
          <Text 
            strong={isActive}
            style={{ 
              flex: 1, 
              overflow: 'hidden', 
              textOverflow: 'ellipsis',
              fontSize: 13,
            }}
          >
            {event.toolName}
          </Text>
          {getEventStatusIcon(event.status)}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, paddingLeft: 22 }}>
          {getCallTypeTag(event.callType)}
          {event.duration && (
            <Text type="secondary" style={{ fontSize: 11 }}>
              {formatDuration(event.duration)}
            </Text>
          )}
          {event.timestamp && (
            <Text type="secondary" style={{ fontSize: 11 }}>
              {formatTimestamp(event.timestamp)}
            </Text>
          )}
        </div>
      </div>
    );
  };
  
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ 
        padding: '8px 12px', 
        borderBottom: '1px solid #f0f0f0',
        background: '#fafafa',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <Space>
          <ToolOutlined style={{ color: '#1890ff' }} />
          <Text strong>操作区</Text>
        </Space>
        {activeEvent && (
          <Space>
            {getCallTypeTag(activeEvent.callType)}
            <Tag color={activeEvent.status === 'success' ? 'success' : activeEvent.status === 'error' ? 'error' : 'processing'}>
              {activeEvent.status === 'success' ? '成功' : activeEvent.status === 'error' ? '失败' : activeEvent.status}
            </Tag>
          </Space>
        )}
      </div>
      
      {events.length === 0 ? (
        <div style={{ 
          flex: 1, 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'center' 
        }}>
          <Empty description="暂无操作" />
        </div>
      ) : (
        <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
          <div style={{ 
            width: sidebarWidth, 
            borderRight: '1px solid #f0f0f0',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}>
            {renderSidebarHeader()}
            <div style={{ flex: 1, overflow: 'auto' }}>
              {events.map(event => renderEventItem(event))}
            </div>
          </div>
          
          <div style={{ flex: 1, overflow: 'hidden' }}>
            {activeEvent ? (
              renderOperationContent(activeEvent)
            ) : (
              <Empty description="选择一个操作查看详情" />
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export { detectOperationType };
export default DynamicOperationArea;
