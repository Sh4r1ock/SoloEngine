/**
 * @file components/SessionList.tsx
 * @description 会话列表组件
 */

import React from 'react';
import { Button, Typography } from 'antd';
import { PlusOutlined, ClearOutlined, RobotOutlined } from '@ant-design/icons';
import type { ExtendedRunSession } from '../types';

const { Text } = Typography;

const formatSmartTime = (dateStr?: string) => {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  const now = new Date();
  
  const isSameYear = date.getFullYear() === now.getFullYear();
  const isToday = date.toDateString() === now.toDateString();
  
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  const timeStr = `${hours}:${minutes}`;
  
  if (isToday) {
    return timeStr;
  }
  
  const month = date.getMonth() + 1;
  const day = date.getDate();
  
  if (isSameYear) {
    return `${month}月${day}日 ${timeStr}`;
  }
  
  const year = date.getFullYear();
  return `${year}年${month}月${day}日 ${timeStr}`;
};

const getStatusIcon = (status?: string) => {
  switch (status) {
    case 'completed':
      return <span style={{ color: '#52c41a', fontSize: 12 }}>●</span>;
    case 'cancelled':
    case 'interrupted':
      return <span style={{ color: '#faad14', fontSize: 12 }}>●</span>;
    case 'error':
      return <span style={{ color: '#ff4d4f', fontSize: 12 }}>●</span>;
    default:
      return <span style={{ color: '#d9d9d9', fontSize: 12 }}>●</span>;
  }
};

const getStatusText = (status?: string) => {
  switch (status) {
    case 'completed':
      return '任务完成';
    case 'cancelled':
    case 'interrupted':
      return '任务中断';
    case 'error':
      return '任务异常';
    default:
      return '进行中';
  }
};

interface SessionListProps {
  sessions: ExtendedRunSession[];
  currentSessionId: string | null;
  agenticFlowId?: string;
  currentProjectId?: string;
  onSelectSession: (sessionId: string) => void;
  onDeleteSession: (sessionId: string, e: React.MouseEvent) => void;
  onCreateSession: () => void;
}

const SessionList: React.FC<SessionListProps> = ({
  sessions,
  currentSessionId,
  agenticFlowId,
  currentProjectId,
  onSelectSession,
  onDeleteSession,
  onCreateSession,
}) => {
  return (
    <div style={{
      background: 'var(--bg-200)',
      display: 'flex',
      flexDirection: 'column',
      position: 'relative',
      flexShrink: 0,
      borderRight: '1px solid var(--bg-300)',
      height: '100%',
    }}>
      <div style={{ padding: '12px 10px' }}>
        <Button 
          type="primary"
          block
          icon={<PlusOutlined />}
          onClick={onCreateSession}
          disabled={!agenticFlowId || !currentProjectId}
          style={{
            height: 38,
            borderRadius: 8,
            background: (!agenticFlowId || !currentProjectId) 
              ? 'var(--bg-300)' 
              : 'linear-gradient(135deg, var(--primary-100), var(--primary-200))',
            border: 'none',
            fontWeight: 500,
            boxShadow: (!agenticFlowId || !currentProjectId) 
              ? 'none' 
              : '0 2px 8px rgba(59, 130, 246, 0.25)',
          }}
        >
          新任务
        </Button>

        {sessions.length > 0 && (
          <div style={{ 
            marginTop: 8, 
            padding: '6px 10px', 
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}>
            <Text style={{ fontSize: 12, color: 'var(--text-300)' }}>任务总数</Text>
            <Text style={{ fontSize: 12, color: 'var(--text-200)', fontWeight: 500 }}>
              {sessions.length}
            </Text>
          </div>
        )}
      </div>
      
      <div style={{ flex: 1, overflow: 'auto', padding: '0 6px 8px' }}>
        {sessions.length === 0 ? (
          <div style={{ 
            padding: '32px 12px', 
            textAlign: 'center', 
          }}>
            <div style={{
              width: 52,
              height: 52,
              borderRadius: 14,
              background: 'linear-gradient(135deg, var(--bg-300), var(--bg-200))',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 14px',
              border: '1px solid var(--bg-300)',
            }}>
              <RobotOutlined style={{ fontSize: 22, color: 'var(--text-300)' }} />
            </div>
            <Text style={{ fontSize: 12, color: 'var(--text-300)', display: 'block', marginBottom: 4 }}>
              对话时自动创建
            </Text>
            <Text style={{ fontSize: 12, color: 'var(--text-300)' }}>
              或点击上方新建
            </Text>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {sessions.map(session => (
              <div
                key={session.id}
                onClick={() => onSelectSession(session.id)}
                style={{
                  padding: '10px 12px',
                  borderRadius: 8,
                  cursor: 'pointer',
                  background: currentSessionId === session.id 
                    ? 'linear-gradient(135deg, var(--primary-100), var(--primary-200))' 
                    : 'transparent',
                  color: currentSessionId === session.id ? '#fff' : 'var(--text-100)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  transition: 'all 0.15s ease',
                  border: currentSessionId === session.id ? 'none' : '1px solid transparent',
                }}
                onMouseEnter={(e) => {
                  if (currentSessionId !== session.id) {
                    e.currentTarget.style.background = 'var(--bg-300)';
                  }
                }}
                onMouseLeave={(e) => {
                  if (currentSessionId !== session.id) {
                    e.currentTarget.style.background = 'transparent';
                  }
                }}
              >
                <div style={{ overflow: 'hidden', flex: 1 }}>
                  <div style={{ 
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    marginBottom: 2,
                  }}>
                    {getStatusIcon(session.status)}
                    <span style={{
                      fontWeight: currentSessionId === session.id ? 600 : 450,
                      fontSize: 13,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}>
                      {(session as any).firstAssistantContent || session.name || `任务 ${session.id.substring(0, 8)}`}
                    </span>
                  </div>
                  <div style={{ 
                    fontSize: 11, 
                    opacity: 0.65, 
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}>
                    <span>{getStatusText(session.status)}</span>
                    <span>·</span>
                    <span>{formatSmartTime(session.createdAt || session.created_at)}</span>
                  </div>
                </div>
                <Button
                  type="text"
                  size="small"
                  icon={<ClearOutlined />}
                  onClick={(e) => onDeleteSession(session.id, e)}
                  style={{ 
                    opacity: currentSessionId === session.id ? 0.9 : 0.5,
                    color: currentSessionId === session.id ? '#fff' : 'var(--text-300)',
                    flexShrink: 0,
                    width: 22,
                    height: 22,
                    padding: 0,
                    minWidth: 22,
                  }}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default SessionList;
