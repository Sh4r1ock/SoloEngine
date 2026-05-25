/**
 * @file components/SessionList.tsx
 * @description 会话列表组件
 */

import React from 'react';
import { Button, Typography } from 'antd';
import { PlusOutlined, ClearOutlined, RobotOutlined } from '@ant-design/icons';
import type { ExtendedRunSession } from '../types';
import { formatSmartTime } from '../../../utils/timezone';
import '../styles/SessionList.css';

const { Text } = Typography;

const getStatusIcon = (status?: string) => {
  switch (status) {
    case 'completed':
      return <span style={{ color: '#52c41a', fontSize: 12 }}>●</span>;
    case 'cancelled':
    case 'interrupted':
    case 'stop':
      return <span style={{ color: '#faad14', fontSize: 12 }}>●</span>;
    case 'error':
    case 'failed':
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
    case 'stop':
      return '任务中断';
    case 'error':
    case 'failed':
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
    <div className="session-list-container">
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
          <div className="session-list-count">
            <Text style={{ fontSize: 12, color: 'var(--text-300)' }}>任务总数</Text>
            <Text style={{ fontSize: 12, color: 'var(--text-200)', fontWeight: 500 }}>
              {sessions.length}
            </Text>
          </div>
        )}
      </div>
      
      <div className="session-list-scroll custom-scrollbar">
        {sessions.length === 0 ? (
          <div className="session-list-empty">
            <div className="session-list-empty-icon">
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
          <div className="session-list-items">
            {sessions.map(session => {
              const isActive = currentSessionId === session.id;
              return (
                <div
                  key={session.id}
                  onClick={() => onSelectSession(session.id)}
                  className={`session-card ${isActive ? 'session-card-active' : ''}`}
                >
                  <div className="session-card-content">
                    <div className="session-card-header">
                      {getStatusIcon(session.status)}
                      <span className={`session-card-title ${isActive ? 'session-card-title-active' : ''}`}>
                        {(session as any).firstAssistantContent || session.name || '新任务'}
                      </span>
                    </div>
                    <div className="session-card-meta">
                      <span>{getStatusText(session.status)}</span>
                      <span>·</span>
                      <span>{formatSmartTime(session.createdAt || session.created_at)}</span>
                      {session.token_usage?.total_tokens != null && session.token_usage.total_tokens > 0 && (
                        <>
                          <span>·</span>
                          <span>{session.token_usage.total_tokens >= 1000 ? `${(session.token_usage.total_tokens / 1000).toFixed(1)}k` : session.token_usage.total_tokens} tokens</span>
                        </>
                      )}
                    </div>
                  </div>
                  <Button
                    type="text"
                    size="small"
                    icon={<ClearOutlined />}
                    onClick={(e) => onDeleteSession(session.id, e)}
                    className={`session-card-delete ${isActive ? 'session-card-delete-active' : ''}`}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

const areEqual = (prevProps: SessionListProps, nextProps: SessionListProps) => {
  if (prevProps.currentSessionId !== nextProps.currentSessionId) return false;
  if (prevProps.agenticFlowId !== nextProps.agenticFlowId) return false;
  if (prevProps.currentProjectId !== nextProps.currentProjectId) return false;
  if (prevProps.sessions.length !== nextProps.sessions.length) return false;
  for (let i = 0; i < prevProps.sessions.length; i++) {
    if (prevProps.sessions[i].id !== nextProps.sessions[i].id) return false;
    if (prevProps.sessions[i].status !== nextProps.sessions[i].status) return false;
    if (prevProps.sessions[i].name !== nextProps.sessions[i].name) return false;
    if ((prevProps.sessions[i] as any).firstAssistantContent !== (nextProps.sessions[i] as any).firstAssistantContent) return false;
    const prevTokens = prevProps.sessions[i].token_usage?.total_tokens;
    const nextTokens = nextProps.sessions[i].token_usage?.total_tokens;
    if (prevTokens !== nextTokens) return false;
  }
  return true;
};

export default React.memo(SessionList, areEqual);
