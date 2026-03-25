/**
 * @file components/MessageList.tsx
 * @description 消息列表组件
 */

import React, { useRef, useEffect, MutableRefObject } from 'react';
import { Typography } from 'antd';
import { RobotOutlined } from '@ant-design/icons';
import { useRunPanelStore } from '../stores/runPanelStore';
import type { LLMMessage, DataBlock } from '../types';
import BeautifulMarkdownRenderer from '../../common/BeautifulMarkdownRenderer';

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

interface MessageListProps {
  messages: LLMMessage[];
  streamingData: DataBlock[];
  isWaitingReply: boolean;
  currentMsgId: string;
  currentMsgIdRef: MutableRefObject<string>;
}

const MessageList: React.FC<MessageListProps> = ({
  messages,
  streamingData,
  isWaitingReply,
  currentMsgId,
  currentMsgIdRef,
}) => {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  
  const {
    hoveredMessageId,
    setHoveredMessageId,
    expandedReasoning,
    expandedToolCalls,
    streamingExpandedKeys,
    toggleReasoningExpand,
    toggleToolCallsExpand,
  } = useRunPanelStore();

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingData]);

  const renderDataBlock = (
    block: DataBlock,
    idx: number,
    msgId: string,
    isStreaming: boolean = false
  ) => {
    if (block.type === 'reasoning_content') {
      const key = isStreaming 
        ? `${currentMsgIdRef.current}-reasoning-${idx}` 
        : `${msgId}-reasoning-${idx}`;
      const isExpanded = expandedReasoning.has(key) || streamingExpandedKeys.has(key);
      
      return (
        <div key={idx} style={{ width: '100%' }}>
          <div 
            onClick={() => {
              if (isStreaming) {
                const newSet = new Set(expandedReasoning);
                if (newSet.has(key)) {
                  newSet.delete(key);
                } else {
                  newSet.add(key);
                }
                useRunPanelStore.getState().setExpandedReasoning(newSet);
              } else {
                toggleReasoningExpand(key);
              }
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              cursor: 'pointer',
              userSelect: 'none',
            }}>
            <span style={{ 
              fontSize: 12, 
              color: 'var(--text-200)',
              width: 14,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}>ⓘ</span>
            <Text style={{ fontSize: 12, color: 'var(--text-200)', fontWeight: 500 }}>
              Thought
            </Text>
          </div>
          {isExpanded && (
            <div style={{
              display: 'flex',
              gap: 0,
              marginTop: 4,
              maxHeight: '1000px',
              overflow: 'hidden',
              transition: 'max-height 0.5s ease-in-out',
            }}>
              <div style={{
                width: 14,
                display: 'flex',
                justifyContent: 'center',
                flexShrink: 0,
              }}>
                <div style={{ width: 2, background: 'var(--bg-300)' }} />
              </div>
              <div style={{
                flex: 1,
                padding: '0 0 6px 6px',
                fontSize: 12,
                color: 'var(--text-200)',
                lineHeight: 1.65,
                whiteSpace: 'pre-wrap',
              }}>
                {block.reasoning_content}
              </div>
            </div>
          )}
        </div>
      );
    }
    
    if (block.type === 'tool_calls') {
      return block.tool_calls?.map((tc, tcIdx) => {
        const key = isStreaming 
          ? `${currentMsgIdRef.current}-${idx}-${tcIdx}` 
          : `${msgId}-${idx}-${tcIdx}`;
        const isExpanded = expandedToolCalls.has(key) || streamingExpandedKeys.has(key);
        
        return (
          <div key={tcIdx} style={{ width: '100%' }}>
            <div 
              onClick={() => {
                if (isStreaming) {
                  const newSet = new Set(expandedToolCalls);
                  if (newSet.has(key)) {
                    newSet.delete(key);
                  } else {
                    newSet.add(key);
                  }
                  useRunPanelStore.getState().setExpandedToolCalls(newSet);
                } else {
                  toggleToolCallsExpand(key);
                }
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                cursor: 'pointer',
                userSelect: 'none',
              }}
            >
              <span style={{ 
                fontSize: 12, 
                color: 'var(--text-200)',
                width: 14,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}>⚙︎</span>
              <Text style={{ fontSize: 12, color: 'var(--text-200)', fontWeight: 500 }}>
                {tc.function?.name}
              </Text>
            </div>
            {isExpanded && (
              <div style={{
                display: 'flex',
                gap: 0,
                marginTop: 4,
                maxHeight: '1000px',
                overflow: 'hidden',
                transition: 'max-height 0.5s ease-in-out',
              }}>
                <div style={{
                  width: 14,
                  display: 'flex',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}>
                  <div style={{ width: 2, background: 'var(--bg-300)' }} />
                </div>
                <div style={{
                  flex: 1,
                  padding: '0 0 6px 6px',
                  fontSize: 12,
                  color: 'var(--text-200)',
                  lineHeight: 1.65,
                  whiteSpace: 'pre-wrap',
                }}>
                  参数: {tc.function?.arguments}
                  {tc.result && (
                    <div style={{ marginTop: 6 }}>
                      <span style={{ fontWeight: 500 }}>结果:</span>
                      {(() => {
                        try {
                          const parsed = typeof tc.result === 'string' ? JSON.parse(tc.result) : tc.result;
                          if (parsed && typeof parsed === 'object') {
                            return (
                              <div style={{ marginTop: 4 }}>
                                {Object.entries(parsed).map(([key, value]) => (
                                  <div key={key} style={{ marginTop: 2 }}>
                                    <span style={{ fontWeight: 500, color: 'var(--text-200)' }}>{key}:</span>{' '}
                                    <span style={{ color: 'var(--text-100)' }}>
                                      {typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value)}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            );
                          }
                        } catch {
                          return ` ${tc.result}`;
                        }
                        return ` ${tc.result}`;
                      })()}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      });
    }
    
    if (block.type === 'content') {
      return (
        <BeautifulMarkdownRenderer key={idx}>
          {block.content || ''}
        </BeautifulMarkdownRenderer>
      );
    }
    
    return null;
  };

  return (
    <>
      {messages.length === 0 && streamingData.length === 0 && !isWaitingReply ? (
        <div style={{ 
          flex: 1,
          display: 'flex', 
          flexDirection: 'column',
          justifyContent: 'center', 
          alignItems: 'center',
          padding: '40px 16px',
        }}>
          <div style={{
            width: 56,
            height: 56,
            borderRadius: '50%',
            background: 'linear-gradient(135deg, var(--primary-100), var(--primary-200))',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: 20,
            boxShadow: '0 8px 24px rgba(63, 81, 181, 0.25)',
          }}>
            <RobotOutlined style={{ fontSize: 24, color: '#fff' }} />
          </div>
          <Text style={{ fontSize: 16, color: 'var(--text-100)', fontWeight: 600, marginBottom: 8 }}>
            开始新对话
          </Text>
          <Text style={{ fontSize: 13, color: 'var(--text-300)', textAlign: 'center', lineHeight: 1.6 }}>
            在下方输入您的问题
          </Text>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {messages.map(msg => (
            msg.role === 'user' ? (
              <div 
                key={msg.id}
                onMouseEnter={() => setHoveredMessageId(msg.id)}
                onMouseLeave={() => setHoveredMessageId(null)}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                  alignItems: 'flex-end',
                }}
              >
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  flexDirection: 'row-reverse',
                }}>
                  <div style={{
                    width: 28,
                    height: 28,
                    borderRadius: 6,
                    background: 'linear-gradient(135deg, var(--primary-100), var(--primary-200))',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}>
                    <span style={{ color: '#fff', fontWeight: 500, fontSize: 12 }}>U</span>
                  </div>
                  <Text style={{ fontSize: 13, color: 'var(--text-100)', fontWeight: 500 }}>用户</Text>
                  <Text style={{ 
                    fontSize: 12, 
                    color: 'var(--text-300)', 
                    opacity: hoveredMessageId === msg.id ? 1 : 0,
                    transition: 'opacity 0.2s',
                  }}>
                    {formatSmartTime(msg.timestamp)}
                  </Text>
                </div>
                <div style={{
                  padding: '12px 14px',
                  borderRadius: 8,
                  background: 'var(--bg-200)',
                  maxWidth: '90%',
                }}>
                  <div style={{ 
                    whiteSpace: 'pre-wrap', 
                    lineHeight: 1.7,
                    fontSize: 14,
                    color: 'var(--text-100)',
                  }}>
                    {msg.content}
                  </div>
                </div>
              </div>
            ) : (
              <div key={msg.id} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                <div style={{
                  width: 28,
                  height: 28,
                  borderRadius: 6,
                  background: 'linear-gradient(135deg, var(--primary-100), var(--primary-200))',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}>
                  <RobotOutlined style={{ color: '#fff', fontSize: 14 }} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Text style={{ fontSize: 13, color: 'var(--text-100)', fontWeight: 500 }}>AI助手</Text>
                    <Text style={{ fontSize: 12, color: 'var(--text-300)' }}>{formatSmartTime(msg.timestamp)}</Text>
                  </div>
                  {msg.data && msg.data.map((block, idx) => renderDataBlock(block, idx, msg.id))}
                </div>
              </div>
            )
          ))}
          
          {(isWaitingReply || streamingData.length > 0) && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <div style={{
                width: 28,
                height: 28,
                borderRadius: 6,
                background: 'linear-gradient(135deg, var(--primary-100), var(--primary-200))',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}>
                <RobotOutlined style={{ color: '#fff', fontSize: 14 }} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Text style={{ fontSize: 13, color: 'var(--text-100)', fontWeight: 500 }}>AI助手</Text>
                  <Text style={{ fontSize: 12, color: 'var(--text-300)' }}>{formatSmartTime(new Date().toISOString())}</Text>
                </div>
                
                {isWaitingReply && streamingData.length === 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{
                      width: 14,
                      height: 14,
                      border: '2px solid var(--bg-300)',
                      borderTopColor: 'var(--primary-100)',
                      borderRadius: '50%',
                      animation: 'spin 1s linear infinite',
                    }} />
                    <Text style={{ fontSize: 14, color: 'var(--text-200)' }}>正在思考...</Text>
                  </div>
                )}
                
                {streamingData.map((block, idx) => renderDataBlock(block, idx, '', true))}
              </div>
            </div>
          )}
          
          <div ref={messagesEndRef} />
        </div>
      )}
    </>
  );
};

export default MessageList;
