/**
 * @file hooks/useMessageManager.ts
 * @description 消息管理 Hook
 */

import { useCallback, useRef } from 'react';
import { message } from 'antd';
import { useRunPanelStore } from '../stores/runPanelStore';
import { runApi } from '../../../services/runApi';
import type { LLMMessage, DataBlock } from '../types';

export const useMessageManager = (agenticFlowId?: string) => {
  const {
    messages,
    setMessages,
    inputText,
    setInputText,
    isRunning,
    startRunning,
    stopRunning,
    isWaitingReply,
    setIsWaitingReply,
    currentSessionId,
    currentProject,
    canvasData,
    setCanvasData,
    setCallRecords,
    clearChildAgentOutputs,
    sessions,
  } = useRunPanelStore();

  const messageAddedRef = useRef<boolean>(false);
  const currentMsgIdRef = useRef<string>('');
  const streamingDataRef = useRef<DataBlock[]>([]);

  const handleSendMessage = useCallback(async (executeFlow: () => void) => {
    if (!inputText.trim()) return;
    if (!agenticFlowId || !currentProject?.id) {
      message.error('请先选择项目和流程');
      return;
    }

    let sessionId = currentSessionId;
    const existingSession = sessions.find(s => s.id === sessionId);
    
    if (!sessionId || !existingSession) {
      sessionId = crypto.randomUUID();
    }

    const userMessage: LLMMessage = {
      id: `msg_${Date.now()}`,
      role: 'user',
      content: inputText,
      timestamp: new Date().toISOString(),
    };

    const assistantMsgId = `msg_${Date.now()}`;
    currentMsgIdRef.current = assistantMsgId;
    
    setMessages(prev => [...prev, userMessage]);
    setInputText('');
    startRunning();
    setIsWaitingReply(true);
    messageAddedRef.current = false;

    streamingDataRef.current = [];

    try {
      let currentCanvasData = canvasData;
      if (!currentCanvasData?.nodes?.length) {
        currentCanvasData = {
          nodes: [{
            id: 'default_agent',
            type: 'executor',
            data: { name: 'Assistant', system_prompt: 'You are a helpful assistant.', tools: [], memory: true },
          }],
          edges: [],
        };
        setCanvasData(currentCanvasData);
      }

      if (executeFlow) {
        await executeFlow(currentCanvasData, inputText, agenticFlowId, sessionId, currentProject?.id);
      }
    } catch (error: any) {
      message.error('发送消息失败: ' + (error.response?.data?.detail || error.message));
      setMessages(prev => prev.filter(m => m.id !== userMessage.id));
      setIsWaitingReply(false);
    } finally {
      stopRunning();
    }
  }, [
    inputText,
    agenticFlowId,
    currentProject?.id,
    canvasData,
    currentSessionId,
    sessions,
    setMessages,
    setInputText,
    startRunning,
    stopRunning,
    setIsWaitingReply,
    setCanvasData,
  ]);

  return {
    messages,
    inputText,
    isRunning,
    isWaitingReply,
    setInputText,
    handleSendMessage,
    messageAddedRef,
    currentMsgIdRef,
    streamingDataRef,
  };
};
