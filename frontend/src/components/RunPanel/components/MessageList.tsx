/**
 * @file components/MessageList.tsx
 * @description 消息列表组件
 */

import React, { useRef, useEffect, useState, useCallback, MutableRefObject } from 'react';
import { Typography } from 'antd';
import { RobotOutlined } from '@ant-design/icons';
import { useRunPanelStore } from '../stores/runPanelStore';
import type { LLMMessage, DataBlock, SubagentOutput } from '../types';
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

const SUBAGENT_BASE_COLOR = '#3F51B5';

const getSubagentColor = (depth: number): string => {
  if (depth === 0) return 'transparent';
  
  const level = ((depth - 1) % 4) + 1;
  
  const opacityMap: Record<number, number> = {
    1: 0.4,
    2: 0.6,
    3: 0.8,
    4: 1.0,
  };
  
  const opacity = opacityMap[level];
  const alpha = Math.round(opacity * 255).toString(16).padStart(2, '0');
  return `${SUBAGENT_BASE_COLOR}${alpha}`;
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
  // 用于强制重新渲染的状态
  const [renderVersion, setRenderVersion] = useState(0);
  
  const {
    hoveredMessageId,
    setHoveredMessageId,
    subagentOutputs,
  } = useRunPanelStore();

  // 强制重新渲染的回调函数
  const forceUpdate = useCallback(() => {
    setRenderVersion(v => v + 1);
  }, []);

  const buildAgentMessageMap = (msgs: LLMMessage[]): Map<string, LLMMessage> => {
    const map = new Map<string, LLMMessage>();
    for (const m of msgs) {
      if (m.agent_id) {
        map.set(m.agent_id, m);
      }
    }
    return map;
  };

  const extractSubagentInfo = (block: DataBlock): { id: string; name: string } | null => {
    if (block.type !== 'tool_calls') return null;
    for (const tc of block.tool_calls || []) {
      if (tc.function?.name === 'Task' && tc.result) {
        try {
          const result = typeof tc.result === 'string' ? JSON.parse(tc.result) : tc.result;
          if (result.subagent_id && result.subagent_name) {
            return { id: result.subagent_id, name: result.subagent_name };
          }
        } catch {}
      }
    }
    return null;
  };

  const extractAgentName = (msg: LLMMessage): string | null => {
    if (msg.agent_name) return msg.agent_name;
    for (const block of msg.data || []) {
      if (block.type === 'tool_calls') {
        for (const tc of block.tool_calls || []) {
          if (tc.function?.name === 'Task' && tc.result) {
            try {
              const result = typeof tc.result === 'string' ? JSON.parse(tc.result) : tc.result;
              if (result.subagent_name) {
                return result.subagent_name;
              }
            } catch {}
          }
        }
      }
    }
    return null;
  };

  const { messageDepths, subagentIds, agentMessageMap } = React.useMemo(() => {
    const map = new Map<string, LLMMessage>();
    for (const m of messages) {
      if (m.agent_id) {
        map.set(m.agent_id, m);
      }
    }
    
    const depths = new Map<string, number>();
    const subIds = new Set<string>();
    
    for (const msg of messages) {
      if (msg.role === 'assistant' && msg.parent_agent_id) {
        subIds.add(msg.agent_id);
        
        let currentDepth = 1;
        let currentParentId = msg.parent_agent_id;
        const visited = new Set<string>();
        
        while (currentParentId && !visited.has(currentParentId)) {
          visited.add(currentParentId);
          const parentMsg = map.get(currentParentId);
          if (parentMsg && parentMsg.parent_agent_id) {
            currentDepth++;
            currentParentId = parentMsg.parent_agent_id;
          } else {
            break;
          }
        }
        
        depths.set(msg.id, currentDepth);
      }
    }
    
    return { messageDepths: depths, subagentIds: subIds, agentMessageMap: map };
  }, [messages]);

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
      // 直接使用 block._isExpanding 判断展开状态
      const isExpanded = block._isExpanding || false;

      return (
        <div key={idx} style={{ width: '100%' }}>
          <div
            onClick={() => {
              // 直接修改 block 的展开状态和手动操作标志
              block._isExpanding = !isExpanded;
              block._userToggled = true;
              // 触发重新渲染
              forceUpdate();
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
      // 直接使用 block._isExpanding 判断展开状态
      const isExpanded = block._isExpanding || false;

      return block.tool_calls?.map((tc, tcIdx) => {
        return (
          <div key={tcIdx} style={{ width: '100%' }}>
            <div
              onClick={() => {
                // 直接修改 block 的展开状态和手动操作标志
                block._isExpanding = !isExpanded;
                block._userToggled = true;
                // 触发重新渲染
                forceUpdate();
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

  // AgentGroup 接口定义
  interface AgentGroup {
    agent_id: string;
    agent_name: string;
    agent_level: number;
    blocks: DataBlock[];
  }

  // 按 agent 分组 DataBlocks
  const groupDataBlocksByAgent = (blocks: DataBlock[]): AgentGroup[] => {
    const groups: AgentGroup[] = [];
    let currentGroup: AgentGroup | null = null;

    for (const block of blocks) {
      const agentId = block.agent_id || 'default';
      const agentName = block.agent_name || 'AI助手';
      const agentLevel = block.agent_level || 0;

      if (!currentGroup || currentGroup.agent_id !== agentId) {
        currentGroup = {
          agent_id: agentId,
          agent_name: agentName,
          agent_level: agentLevel,
          blocks: []
        };
        groups.push(currentGroup);
      }
      currentGroup.blocks.push(block);
    }
    return groups;
  };

  // 渲染 Agent 分组
  const renderAgentGroups = (
    groups: AgentGroup[],
    isStreaming: boolean = false
  ): React.ReactNode => {
    return groups.map((group, groupIdx) => {
      const isMainAgent = group.agent_level === 0;
      const borderColor = getSubagentColor(group.agent_level);
      const blocks = group.blocks.map((block, idx) =>
        renderDataBlock(block, idx, '', isStreaming)
      );

      if (isMainAgent) {
        return <React.Fragment key={groupIdx}>{blocks}</React.Fragment>;
      }

      return (
        <div key={groupIdx} style={{
          marginLeft: 14 * group.agent_level,
          marginTop: 8,
          borderLeft: `3px solid ${borderColor}`,
          paddingLeft: 12,
          background: 'rgba(63, 81, 181, 0.05)',
          borderRadius: 6,
          paddingBottom: 8,
        }}>
          <div style={{ marginBottom: 4 }}>
            <Text style={{ fontSize: 13, color: borderColor, fontWeight: 500 }}>
              {group.agent_name}
            </Text>
          </div>
          {blocks}
        </div>
      );
    });
  };

  const renderSubagentMessages = (parentAgentId: string, depth: number): React.ReactNode => {
    const childMessages = messages.filter(msg => msg.parent_agent_id === parentAgentId);
    
    return childMessages.map(msg => {
      const borderColor = getSubagentColor(depth);
      
      return (
        <div key={msg.id} style={{
          marginLeft: 14,
          marginTop: 8,
          borderLeft: `3px solid ${borderColor}`,
          paddingLeft: 12,
          background: 'rgba(63, 81, 181, 0.05)',
          borderRadius: 6,
          paddingBottom: 8,
        }}>
          <div style={{ marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Text style={{ fontSize: 13, color: borderColor, fontWeight: 500 }}>
              {extractAgentName(msg) || 'SubAgent'}
            </Text>
            <Text style={{ fontSize: 12, color: 'var(--text-300)' }}>
              {formatSmartTime(msg.timestamp)}
            </Text>
          </div>
          {msg.data?.map((block, idx) => renderDataBlock(block, idx, msg.id))}
          {renderSubagentMessages(msg.agent_id, depth + 1)}
        </div>
      );
    });
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
          {messages.map(msg => {
            // Set 3 重构：后端已处理层级关系，前端直接渲染
            return msg.role === 'user' ? (
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
              <div 
                key={msg.id} 
                style={{ 
                  display: 'flex', 
                  gap: 8, 
                  alignItems: 'flex-start',
                }}
              >
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
                    <Text style={{ fontSize: 13, color: 'var(--text-100)', fontWeight: 500 }}>
                      {extractAgentName(msg) || 'AI助手'}
                    </Text>
                    <Text style={{ fontSize: 12, color: 'var(--text-300)' }}>
                      {formatSmartTime(msg.timestamp)}
                    </Text>
                  </div>
                  {/* Set 3 重构：后端已处理层级关系，直接使用 groupDataBlocksByAgent 渲染 */}
                  {msg.data && renderAgentGroups(groupDataBlocksByAgent(msg.data), false)}
                </div>
              </div>
            );
          })}
          
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
                
                {renderAgentGroups(groupDataBlocksByAgent(streamingData), true)}
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
