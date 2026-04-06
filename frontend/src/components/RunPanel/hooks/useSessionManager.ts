/**
 * @file hooks/useSessionManager.ts
 * @description 会话管理 Hook
 */

import { useCallback } from 'react';
import { message } from 'antd';
import { useRunPanelStore } from '../stores/runPanelStore';
import { runApi } from '../../../services/runApi';
import type { LLMMessage } from '../types';

export const useSessionManager = (agenticFlowId?: string) => {
  const {
    sessions,
    currentSessionId,
    setCurrentSessionId,
    setSessions,
    setMessages,
    setCallRecords,
    clearStreamingData,
    currentProject,
  } = useRunPanelStore();

  const createNewSession = useCallback(() => {
    if (!agenticFlowId || !currentProject?.id) {
      message.error('请先选择项目和流程');
      return null;
    }
    const newSessionId = crypto.randomUUID();
    setCurrentSessionId(newSessionId);
    setMessages([]);
    setCallRecords([]);
    clearStreamingData();
    return newSessionId;
  }, [agenticFlowId, currentProject?.id, setCurrentSessionId, setMessages, setCallRecords, clearStreamingData]);
  const handleSwitchSession = useCallback(async (sessionId: string) => {
    // 获取当前消息状态
    const currentMessages = useRunPanelStore.getState().messages;
    
    if (currentSessionId === sessionId) {
      // 即使是当前会话，如果没有消息也需要加载
      if (currentMessages.length === 0) {
        try {
          const msgs = await runApi.getSessionMessages(sessionId);
          const restoredMessages: LLMMessage[] = msgs.map((msg: any) => {
            const data = msg.data || [];
            let content = '';
            let reasoningContent: string | undefined;
            
            for (const block of data) {
              if (block.type === 'content') {
                content = block.content || '';
              } else if (block.type === 'reasoning_content') {
                reasoningContent = block.reasoning_content;
              }
            }
            
            return {
              id: msg.id,
              role: msg.role as 'user' | 'assistant' | 'system',
              content: content || msg.content || '',
              reasoning_content: reasoningContent,
              data,
              timestamp: msg.created_at || new Date().toISOString(),
              tokens: msg.total_tokens,
              agent_id: msg.agent_id,
            };
          });
          setMessages(restoredMessages);
        } catch (error) {
          console.warn('Failed to load session messages:', error);
        }
      }
      return;
    }
    
    setCurrentSessionId(sessionId);
    setMessages([]);
    setCallRecords([]);
    clearStreamingData();
    try {
      const msgs = await runApi.getSessionMessages(sessionId);
      const restoredMessages: LLMMessage[] = msgs.map((msg: any) => {
        const data = msg.data || [];
        let content = '';
        let reasoningContent: string | undefined;
        
        for (const block of data) {
          if (block.type === 'content') {
            content = block.content || '';
          } else if (block.type === 'reasoning_content') {
            reasoningContent = block.reasoning_content;
          }
        }
        
        return {
          id: msg.id,
          role: msg.role as 'user' | 'assistant' | 'system',
          content: content || msg.content || '',
          reasoning_content: reasoningContent,
          data,
          timestamp: msg.created_at || new Date().toISOString(),
          tokens: msg.total_tokens,
          agent_id: msg.agent_id,
        };
      });
      setMessages(restoredMessages);
    } catch (error) {
      console.warn('Failed to load session messages:', error);
    }
  }, [currentSessionId, setCurrentSessionId, setMessages, setCallRecords, clearStreamingData]);
  const handleDeleteSession = useCallback(async (sessionId: string) => {
    try {
      await runApi.deleteSession(sessionId);
      const newSessions = sessions.filter(s => s.id !== sessionId);
      setSessions(newSessions);
      if (currentSessionId === sessionId) {
        if (newSessions.length > 0) {
          setCurrentSessionId(newSessions[0].id);
        } else {
          setCurrentSessionId(null);
        }
        setMessages([]);
      }
      message.success('会话已删除');
    } catch (error) {
      message.error('删除会话失败');
    }
  }, [sessions, currentSessionId, setCurrentSessionId, setSessions, setMessages]);
  const loadSessionsFromBackend = useCallback(async () => {
    if (!agenticFlowId || !currentProject?.id) return;
    try {
      const sessionsData = await runApi.getSessions({
        agentic_flow_id: agenticFlowId,
        run_project_id: currentProject.id,
        limit: 50,
      });
      const extendedSessions = sessionsData.map((s: any) => ({
        ...s,
        name: `会话 ${s.id.substring(0, 8)}`,
        createdAt: s.created_at || new Date().toISOString(),
        messages: [],
      }));
      extendedSessions.sort((a: any, b: any) => 
        new Date(b.createdAt || '').getTime() - new Date(a.createdAt || '').getTime()
      );
      setSessions(extendedSessions);
    } catch (error) {
      console.warn('Failed to load sessions:', error);
    }
  }, [agenticFlowId, currentProject?.id, setSessions]);
  return {
    sessions,
    currentSessionId,
    createNewSession,
    handleSwitchSession,
    handleDeleteSession,
    loadSessionsFromBackend,
  };
};
