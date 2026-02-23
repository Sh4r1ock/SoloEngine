import React, { useRef, useEffect } from 'react';
import { List, Typography, Tag, Space, Empty, Dropdown, Button } from 'antd';
import {
  UserOutlined,
  RobotOutlined,
  ToolOutlined,
  SettingOutlined,
  DownloadOutlined,
} from '@ant-design/icons';
import { useDebugStore } from '../../store/debugStore';
import { debugApi } from '../../services/debugApi';
import type { MenuProps } from 'antd';

const { Text } = Typography;

interface DebugMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  timestamp: number;
  agentName?: string;
}

const ConversationHistory: React.FC = () => {
  const {
    activeSessionId,
    sessions,
    messageFilter,
    searchQuery,
  } = useDebugStore();

  const messagesEndRef = useRef<HTMLDivElement>(null);

  const activeSession = activeSessionId
    ? sessions.find(s => s.id === activeSessionId)
    : null;

  const messages: DebugMessage[] = activeSession?.messages || [];

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  const filteredMessages = messages.filter((msg: DebugMessage) => {
    if (messageFilter !== 'all' && msg.role !== messageFilter) {
      return false;
    }
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      return msg.content.toLowerCase().includes(query);
    }
    return true;
  });

  // 导出对话历史
  const handleExport = async (format: 'json' | 'txt' | 'md') => {
    if (!activeSessionId) return;

    try {
      const response = await debugApi.exportSession(activeSessionId, format);

      // 创建下载链接
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.download = `debug_session_${activeSessionId}.${format}`;
      link.click();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('导出失败：', error);
    }
  };

  // 导出菜单项
  const exportMenu: MenuProps['items'] = [
    {
      key: 'json',
      label: 'JSON 格式',
      onClick: () => handleExport('json'),
    },
    {
      key: 'txt',
      label: '文本格式',
      onClick: () => handleExport('txt'),
    },
    {
      key: 'md',
      label: 'Markdown 格式',
      onClick: () => handleExport('md'),
    },
  ];

  // 获取角色图标
  const getRoleIcon = (role: string) => {
    switch (role) {
      case 'user': return <UserOutlined />;
      case 'assistant': return <RobotOutlined />;
      case 'system': return <SettingOutlined />;
      case 'tool': return <ToolOutlined />;
      default: return null;
    }
  };

  // 获取角色颜色
  const getRoleColor = (role: string) => {
    switch (role) {
      case 'user': return '#1890ff';
      case 'assistant': return '#52c41a';
      case 'system': return '#8c8c8c';
      case 'tool': return '#fa8c16';
      default: return '#000';
    }
  };

  // 格式化时间
  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
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
          <Text strong>对话历史</Text>
          <Tag>{messages.length} 条消息</Tag>
        </Space>
        <Dropdown menu={{ items: exportMenu }} trigger={['click']}>
          <Button icon={<DownloadOutlined />} size="small">
            导出
          </Button>
        </Dropdown>
      </div>

      <div style={{ flex: 1, overflow: 'auto', marginBottom: 16 }}>
        {filteredMessages.length === 0 ? (
          <Empty description="暂无消息" style={{ marginTop: 48 }} />
        ) : (
          <List
            dataSource={filteredMessages}
            renderItem={(msg: DebugMessage, index: number) => (
              <div
                key={msg.id}
                style={{
                  marginBottom: 16,
                  padding: '12px',
                  borderRadius: 8,
                  background: msg.role === 'assistant' ? '#f6ffed' : '#fff',
                  border: `1px solid ${msg.role === 'assistant' ? '#b7eb8f' : '#f0f0f0'}`,
                }}
              >
                <Space size={8} style={{ marginBottom: 8 }}>
                  <span style={{ color: getRoleColor(msg.role) }}>
                    {getRoleIcon(msg.role)}
                  </span>
                  <Text strong style={{ fontSize: 13 }}>
                    {msg.role === 'user' ? '用户' :
                     msg.role === 'assistant' ? '助手' :
                     msg.role === 'system' ? '系统' : '工具'}
                  </Text>
                  {msg.agentName && (
                    <Tag color="blue" style={{ margin: 0, fontSize: 11 }}>
                      {msg.agentName}
                    </Tag>
                  )}
                  <Text type="secondary" style={{ fontSize: 11, marginLeft: 'auto' }}>
                    {formatTime(msg.timestamp)}
                  </Text>
                </Space>
                <div style={{
                  marginTop: 8,
                  padding: '8px 12px',
                  borderRadius: 4,
                  background: msg.role === 'user' ? '#f0f0f0' : 'transparent',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}>
                  <Text style={{ fontSize: 14 }}>
                    {msg.content}
                  </Text>
                </div>
              </div>
            )}
          />
        )}
        <div ref={messagesEndRef} />
      </div>
    </div>
  );
};

export default ConversationHistory;
