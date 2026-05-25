/**
 * SoloEngine : 运行面板主组件
 *
 * @file index.tsx
 * @description 运行面板主组件 - 模块化重构版本
 * @author Sh4rlock
 * @date 2026-04-09
 *
 * 功能描述：
 * 本组件提供以下核心功能：
 *     - AgenticFlow运行交互界面
 *     - 消息列表显示
 *     - 消息输入和发送
 *     - 会话管理
 *     - 文件资源管理器
 *     - WebSocket实时通信
 *     - Agentic面板显示
 *
 * 依赖:
 *     - react: React核心库
 *     - react-router-dom: 路由管理
 *     - antd: Ant Design组件
 *     - @ant-design/icons: Ant Design图标
 *     - ./stores/runPanelStore: 运行面板状态管理
 *     - ./hooks/useStreamingData: 流数据Hook
 *     - ../../hooks/useRunWebSocket: WebSocket Hook
 *     - ../../store/runProjectStore: 运行项目状态管理
 *     - ../../services/runApi: 运行API服务
 *     - ../../services/agenticFlowApi: AgenticFlow API服务
 *     - ../../services/runProjectApi: 运行项目API服务
 *
 * 使用示例:
 *     - <RunPanel agenticFlowId="flow-id" />
 */

import React, { useEffect, useState, useRef, useCallback } from 'react';
import { Layout, Button, Typography, Modal, Dropdown, List, Tag, Empty, Spin, Tooltip, App } from 'antd';
import type { MenuProps } from 'antd';
import {
  FolderOutlined,
  FolderOpenOutlined,
  HistoryOutlined,
  CheckOutlined,
  LockOutlined,
  FolderAddOutlined,
  FileAddOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';

import { useRunPanelStore, generateId } from './stores/runPanelStore';
import type { FileSystemChange } from './types';
import { useStreamingData } from './hooks/useStreamingData';
import { WEBSOCKET_CONFIG } from '../../config/websocket';
import { useRunWebSocket, ExecutionEvent } from '../../hooks/useRunWebSocket';
import { useRunProjectStore } from '../../store/runProjectStore';
import { runApi } from '../../services/runApi';
import { loadMessages } from './utils/loadMessagesWithFileChanges';
import { formatSmartTime } from '../../utils/timezone';
import { agenticFlowApi } from '../../services/agenticFlowApi';
import { runProjectApi, RecentProjectInfo, FileInfo } from '../../services/runProjectApi';

import MessageList, { type MessageListHandle } from './components/MessageList';
import MessageInput from './components/MessageInput';
import ScrollNavigationButtons from './components/ScrollNavigationButtons';
import SessionList from './components/SessionList';
import AgenticPanel from './components/AgenticPanel';
import FileExplorer from './FileExplorer';
import type { LLMMessage, DataBlock, FileTab, CallRecord, CallType, SubagentOutput } from './types';

const { Header } = Layout;
const { Text } = Typography;

const getSessionStorageKey = (flowId: string, projectId: string) =>
  `soloengine-session-${flowId}-${projectId}`;

interface RunPanelProps {
  agenticFlowId?: string;
}

const ResizableDivider: React.FC<{
  dividerIndex: number;
  right?: number;
  isDragging: number | null;
  onMouseDown: (e: React.MouseEvent, index: number) => void;
}> = ({ dividerIndex, right = -3, isDragging, onMouseDown }) => {
  const [isHovered, setIsHovered] = useState(false);
  const isActive = isDragging === dividerIndex;

  return (
    <div
      onMouseDown={e => onMouseDown(e, dividerIndex)}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      style={{
        position: 'absolute',
        top: 0,
        bottom: 0,
        right,
        width: 6,
        cursor: 'col-resize',
        zIndex: 20,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: isActive ? 'var(--primary-300, rgba(63, 81, 181, 0.15))' : (isHovered ? 'var(--primary-300, rgba(63, 81, 181, 0.1))' : 'transparent'),
        transition: 'background 0.2s',
      }}
    >
      <div style={{
        width: 2,
        height: 40,
        borderRadius: 1,
        background: isActive ? 'var(--primary-100)' : (isHovered ? 'var(--primary-200)' : 'var(--bg-300)'),
        transition: isActive ? 'none' : 'background 0.2s',
      }} />
    </div>
  );
};

const RunPanel: React.FC<RunPanelProps> = ({ agenticFlowId }) => {
  const accumulateTokenUsage = (existing: any, delta: any) => {
    if (!delta) return existing;
    if (!existing) return delta;
    return {
      prompt_tokens: (existing.prompt_tokens || 0) + (delta.prompt_tokens || 0),
      completion_tokens: (existing.completion_tokens || 0) + (delta.completion_tokens || 0),
      total_tokens: (existing.total_tokens || 0) + (delta.total_tokens || 0),
    };
  };
  const navigate = useNavigate();
  const { message } = App.useApp();

  // 统一格式：将 SessionMessage[] 转换为 LLMMessage[]
  const {
    sessions,
    currentSessionId,
    isRunning,
    startRunning,
    stopRunning,
    setCurrentSessionId,
    setSessions,
    inputText,
    setInputText,
    isWaitingReply,
    setIsWaitingReply,
    currentMsgId,
    setCurrentMsgId,
    setCallRecords,
    setSubagentOutputs,
    clearSubagentOutputs,
    editorTabs,
    documentTabs,
    activeEditorTabId,
    activeDocumentTabId,
    agenticPanels,
    activeAgenticTab,
    panelRatios,
    setPanelRatios,
    openAgenticPanel,
    closeAgenticPanel,
    setActiveAgenticTab,
    updateEditorTab,
    closeEditorTab,
    setActiveEditorTabId,
    updateDocumentTab,
    closeDocumentTab,
    setActiveDocumentTabId,
    openOrNavigateFile,
    currentProject,
    recentProjects,
    canvasData,
    setCanvasData,
    setRecentProjects,
    setCurrentProject,
    setMessages,
    setFileChangesMap,
    incrementFileChangeRefreshKey,
    createNewSession: storeCreateNewSession,
    deleteSession: storeDeleteSession,
    loadSessionsForProject: storeLoadSessionsForProject,
    handleExternalFileChanges,
    clearRecallPreview,
  } = useRunPanelStore();

  const {
    currentProject: runProjectCurrentProject,
    loading: projectLoading,
    loadCurrentProject,
    loadRecentProjects,
    selectOrCreateProject,
    openNativeFolderDialog,
  } = useRunProjectStore();

  const streamingDataHook = useStreamingData();
  const streamingDataHookRef = useRef(streamingDataHook);
  // 保持streamingDataHookRef最新
  useEffect(() => {
    streamingDataHookRef.current = streamingDataHook;
  }, [streamingDataHook]);

  const isConnectedRef = useRef(false);
  const messageAddedRef = useRef<boolean>(false);
  const currentMsgIdRef = useRef<string>('');
  const fileExplorerActionsRef = useRef<{ refresh: () => void; applyIncrementalChanges: (changes: FileSystemChange[]) => void; openNewFileDialog: () => void; openNewFolderDialog: () => void; navigateToFile: (path: string) => Promise<void> } | null>(null);
  const isStoppingRef = useRef(false);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const firstChunkTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const messagesLengthRef = useRef(0);
  const lastStreamActivityRef = useRef<number>(0);
  const streamActivityCheckRef = useRef<NodeJS.Timeout | null>(null);

  const flowIdRef = useRef<string | null>(null);
  const projectIdRef = useRef<string | null>(null);

  flowIdRef.current = agenticFlowId || null;
  projectIdRef.current = currentProject?.id || null;

  useEffect(() => {
    const unsub = useRunPanelStore.subscribe((state, prevState) => {
      if (state.currentSessionId === prevState.currentSessionId) return;
      const fid = flowIdRef.current;
      const pid = projectIdRef.current;
      if (!fid || !pid || !state.currentSessionId) return;
      const key = `soloengine-session-${fid}-${pid}`;
      localStorage.setItem(key, JSON.stringify({ currentSessionId: state.currentSessionId }));
    });
    return unsub;
  }, []);

  const clearTimeouts = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    if (firstChunkTimeoutRef.current) {
      clearTimeout(firstChunkTimeoutRef.current);
      firstChunkTimeoutRef.current = null;
    }
    if (streamActivityCheckRef.current) {
      clearInterval(streamActivityCheckRef.current);
      streamActivityCheckRef.current = null;
    }
    lastStreamActivityRef.current = 0;
  }, []);

  const messagesLength = useRunPanelStore(state => state.messages.length);
  useEffect(() => {
    messagesLengthRef.current = messagesLength;
  }, [messagesLength]);

  const [recentModalVisible, setRecentModalVisible] = useState(false);
  const [switchingProjectId, setSwitchingProjectId] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState<number | null>(null);
  const [dragStartX, setDragStartX] = useState(0);
  const [dragStartRatios, setDragStartRatios] = useState<number[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);
  const messageScrollContainerRef = useRef<HTMLDivElement>(null);
  const messageListRef = useRef<MessageListHandle>(null);

  useEffect(() => {
    currentMsgIdRef.current = currentMsgId;
  }, [currentMsgId]);

  const loadSessionsForProject = useCallback(async (projectId: string) => {
    if (!agenticFlowId || !projectId) return;
    await storeLoadSessionsForProject(agenticFlowId, projectId);
  }, [agenticFlowId, storeLoadSessionsForProject]);

  // 根据currentProject加载sessions（用于初始化）
  const loadSessionsFromBackend = useCallback(async () => {
    if (!agenticFlowId || !currentProject?.id) return;
    await loadSessionsForProject(currentProject.id);
  }, [agenticFlowId, currentProject?.id, loadSessionsForProject]);

  const loadSessionsRef = useRef(loadSessionsFromBackend);
  loadSessionsRef.current = loadSessionsFromBackend;

  useEffect(() => {
    loadCurrentProject(agenticFlowId);
    if (agenticFlowId) {
      loadRecentProjects(agenticFlowId).then((projects: any) => {
        setRecentProjects(projects || []);
      });
    }
  }, [agenticFlowId, loadCurrentProject, loadRecentProjects, setRecentProjects]);

  const prevProjectRef = useRef<{id: string; name: string; folder_path: string} | null>(null);
  useEffect(() => {
    if (runProjectCurrentProject) {
      const newProject = {
        id: runProjectCurrentProject.id,
        name: runProjectCurrentProject.name,
        folder_path: runProjectCurrentProject.folder_path,
      };
      const prev = prevProjectRef.current;
      if (!prev || prev.id !== newProject.id || prev.name !== newProject.name || prev.folder_path !== newProject.folder_path) {
        prevProjectRef.current = newProject;
        setCurrentProject(newProject);
      }
    } else {
      if (prevProjectRef.current !== null) {
        prevProjectRef.current = null;
        setCurrentProject(null);
      }
    }
  }, [runProjectCurrentProject, setCurrentProject]);

  useEffect(() => {
    const loadCanvasData = async () => {
      if (!agenticFlowId) return;
      try {
        const flow = await agenticFlowApi.getFlow(agenticFlowId);
        if (flow.canvas_data) {
          setCanvasData(flow.canvas_data);
        }
      } catch (error) {
        console.warn('Failed to load canvas data:', error);
      }
    };
    loadCanvasData();
  }, [agenticFlowId, setCanvasData]);

  const initCounterRef = useRef(0);

  useEffect(() => {
    if (!agenticFlowId || !currentProject?.id) return;

    const initId = ++initCounterRef.current;

    const init = async () => {
      await loadSessionsRef.current();

      if (initId !== initCounterRef.current) return;

      const key = getSessionStorageKey(agenticFlowId, currentProject.id);
      const storedData = localStorage.getItem(key);
      if (storedData) {
        try {
          const { currentSessionId: storedSessionId } = JSON.parse(storedData);
          if (storedSessionId) {
            const currentSessions = useRunPanelStore.getState().sessions;
            const isValid = currentSessions.some(s => s.id === storedSessionId);
            if (isValid) {
              setCurrentSessionId(storedSessionId);
              const { messages: restoredMessages, fileChangesMap } = await loadMessages(storedSessionId);
              if (initId !== initCounterRef.current) return;
              if (restoredMessages && restoredMessages.length > 0) {
                setMessages(restoredMessages);
                setFileChangesMap(prev => ({ ...prev, ...fileChangesMap }));
              }
            } else {
              localStorage.removeItem(key);
            }
          }
        } catch (e) {
          console.error('Failed to parse stored session:', e);
          localStorage.removeItem(key);
        }
      }
    };

    init();
  }, [agenticFlowId, currentProject?.id, setCurrentSessionId, setMessages, setFileChangesMap]);

  const handleExecutionEnd = useCallback((
    streamingHook: any,
    messageStatus: 'completed' | 'stopped' | 'error',
    sessionStatus: string,
    tokenData: any,
    errorMessage?: string,
  ) => {
    setIsWaitingReply(false);
    const finalData = streamingHook.finalizeStream();
    const totalTokens = tokenData?.total_tokens ||
      (tokenData?.prompt_tokens && tokenData?.completion_tokens
        ? tokenData.prompt_tokens + tokenData.completion_tokens
        : undefined);

    if (!messageAddedRef.current) {
      const msgId = currentMsgIdRef.current || `msg_${Date.now()}`;
      const endMessage: LLMMessage = {
        id: msgId,
        role: 'assistant',
        content: '',
        data: finalData,
        timestamp: new Date().toISOString(),
        status: messageStatus,
        tokens: totalTokens,
        error: messageStatus === 'error' ? (errorMessage || '执行失败') : undefined,
      };
      setMessages(prev => [...prev, endMessage]);
      messageAddedRef.current = true;

      if (currentSessionId) {
        const contentBlock = finalData.find((b: DataBlock) => b.type === 'content' && b.content);
        const firstAssistantContent = contentBlock?.content?.substring(0, 50) || undefined;
        setSessions(sessionsState => {
          const updated = sessionsState.map(s =>
            s.id === currentSessionId
              ? {
                  ...s,
                  status: sessionStatus,
                  firstAssistantContent: s.firstAssistantContent || firstAssistantContent,
                  token_usage: accumulateTokenUsage(s.token_usage, tokenData),
                  updated_at: new Date().toISOString(),
                  messages: [...(s.messages || []), {
                    id: endMessage.id,
                    role: endMessage.role,
                    content: endMessage.content || '',
                    reasoning_content: endMessage.reasoning_content,
                    status: messageStatus,
                    error: endMessage.error,
                    data: endMessage.data || [],
                    message_index: (s.messages?.length || 0),
                    timestamp: endMessage.timestamp,
                    created_at: endMessage.timestamp,
                    tokens: totalTokens,
                    prompt_tokens: tokenData?.prompt_tokens,
                    completion_tokens: tokenData?.completion_tokens,
                    total_tokens: tokenData?.total_tokens,
                  }]
                }
              : s
          );
          updated.sort((a: any, b: any) =>
            new Date(b.updated_at || b.createdAt || '').getTime() - new Date(a.updated_at || a.createdAt || '').getTime()
          );
          return updated;
        });
      }
    } else if (currentSessionId) {
      const contentBlock = finalData.find((b: DataBlock) => b.type === 'content' && b.content);
      const firstAssistantContent = contentBlock?.content?.substring(0, 50) || undefined;
      setSessions(sessionsState => {
        const updated = sessionsState.map(s =>
          s.id === currentSessionId
            ? { ...s, status: sessionStatus, firstAssistantContent: s.firstAssistantContent || firstAssistantContent, token_usage: accumulateTokenUsage(s.token_usage, tokenData), updated_at: new Date().toISOString() }
            : s
        );
        updated.sort((a: any, b: any) =>
          new Date(b.updated_at || b.createdAt || '').getTime() - new Date(a.updated_at || a.createdAt || '').getTime()
        );
        return updated;
      });
    }

    stopRunning();
    clearTimeouts();
  }, [setIsWaitingReply, setMessages, setSessions, stopRunning, currentSessionId, clearTimeouts]);

  const handleExecutionEvent = useCallback((event: ExecutionEvent) => {
    const streamingHook = streamingDataHookRef.current;

    switch (event.event_type) {
      case 'execution_start':
        setCallRecords([]);
        clearSubagentOutputs();
        streamingHook.resetStream();
        messageAddedRef.current = false;
        startRunning();
        setIsWaitingReply(true);
        break;

      case 'agent_start':
        break;

      case 'agent_complete':
        break;

      case 'tool_call':
        setCallRecords((prev: CallRecord[]) => {
          const callId = event.tool_call_id || event.tool_name || generateId();
          const callType = (event.tool_type || 'tool') as CallType;
          const existingIndex = prev.findIndex((r: CallRecord) => r.callId === callId && r.type === callType);
          
          if (existingIndex >= 0) {
            const updated = [...prev];
            updated[existingIndex] = {
              ...updated[existingIndex],
              status: 'running',
              startTime: updated[existingIndex].startTime || Date.now(),
              metadata: event.metadata,
            };
            return updated;
          }
          
          return [...prev, {
            id: generateId(),
            callId,
            type: callType,
            name: event.tool_name || 'unknown',
            status: 'running',
            arguments: event.tool_args,
            timestamp: event.timestamp,
            startTime: Date.now(),
            metadata: event.metadata,
          }];
        });
        
        const toolName = event.tool_name?.toLowerCase() || '';
        if (toolName.includes('write') || toolName.includes('edit')) {
          openAgenticPanel('editor');
        } else if (toolName.includes('browser') || toolName.includes('navigate')) {
          openAgenticPanel('browser');
        } else if (toolName.includes('read') || toolName.includes('file')) {
          openAgenticPanel('document');
        } else if (toolName.includes('terminal') || toolName.includes('shell') || toolName.includes('bash')) {
          openAgenticPanel('terminal');
        }
        break;

      case 'tool_result':
        setCallRecords((prev: CallRecord[]) => {
          const callId = event.tool_call_id || event.tool_name;
          const callType = (event.tool_type || 'tool') as CallType;
          const endTime = Date.now();
          
          return prev.map((r: CallRecord) => {
            if (r.callId === callId && r.type === callType) {
              return {
                ...r,
                status: event.error ? 'error' : 'success',
                result: event.tool_result,
                error: event.error,
                endTime,
                duration: endTime - (r.startTime || endTime),
              };
            }
            return r;
          });
        });
        break;

      case 'subagent_start':
        setSubagentOutputs((prev: SubagentOutput[]) => {
          const existingIndex = prev.findIndex(sa => sa.id === (event as any).subagent_id);
          
          if (existingIndex >= 0) {
            const updated = [...prev];
            updated[existingIndex] = {
              ...updated[existingIndex],
              status: 'running',
              startTime: Date.now(),
              input: (event as any).subagent_input,
              agentType: (event as any).subagent_type,
            };
            return updated;
          }
          
          return [...prev, {
            id: (event as any).subagent_id || generateId(),
            name: (event as any).subagent_name || 'Unknown Agent',
            output: '',
            status: 'running',
            calls: [],
            startTime: Date.now(),
            input: (event as any).subagent_input,
            agentType: (event as any).subagent_type,
          }];
        });
        break;

      case 'subagent_complete':
        setSubagentOutputs((prev: SubagentOutput[]) => {
          const endTime = Date.now();
          return prev.map(sa => {
            if (sa.id === (event as any).subagent_id) {
              const startTime = sa.startTime || endTime;
              // 修复：如果 event.content 为空，保留已有的 output
              const newOutput = (event as any).content || (event as any).subagent_output;
              return {
                ...sa,
                output: newOutput || sa.output || '',
                status: event.error ? 'error' : 'completed',
                endTime,
                duration: endTime - startTime,
              };
            }
            return sa;
          });
        });
        break;

      case 'file_change_preview': {
        const previewChanges = (event as any).file_changes;
        if (previewChanges && previewChanges.length > 0) {
          streamingHook.addFileChangePreview(previewChanges, (event as any).agent_id, (event as any).agent_name);
        }
        break;
      }

      case 'file_changes_ready': {
        incrementFileChangeRefreshKey();
        const fcReadyMsgId = (event as any).message_id;

        if (fcReadyMsgId && currentSessionId) {
          (async () => {
            try {
              const { fileChangesApi } = await import('../../services/fileChangesApi');
              const response = await fileChangesApi.getSessionFileChanges(currentSessionId, {
                message_ids: [fcReadyMsgId],
                diff_type: 'net',
              });
              const fcApiData = (response as any)?.data || response;
              if (fcApiData?.changes && fcApiData.changes.length > 0) {
                const changes = fcApiData.changes.map((c: any) => ({
                  file_path: c.file_path,
                  operation: c.operation,
                  content_type: c.content_type || 'text',
                  id: c.id,
                  tool_call_id: c.tool_call_id,
                  status: c.status,
                  diff: (c.lines_added || c.lines_removed) ? {
                    lines_added: c.lines_added ?? 0,
                    lines_removed: c.lines_removed ?? 0,
                  } : undefined,
                }));
                setFileChangesMap(prev => ({
                  ...prev,
                  [fcReadyMsgId]: changes,
                }));
              }
            } catch (fcError) {
              console.error('[RunPanel] file_changes_ready API call failed:', fcError);
            }
          })();
        }
        break;
      }

      case 'file_system_event': {
        const changes: FileSystemChange[] = (event as any).changes || [];
        if (changes.length > 0) {
          fileExplorerActionsRef.current?.applyIncrementalChanges(changes);
          handleExternalFileChanges(changes);
        }
        break;
      }

      case 'stream':
        try {
          const delta = event.delta || {} as any;
          const hasContent = (delta as any).reasoning_content || (delta as any).tool_calls || (delta as any).content;
          const hasLegacyContent = event.content !== undefined && event.content_type !== undefined;
          if (hasContent) {
            streamingHook.processStreamChunk(delta, (event as any).agent_id, (event as any).agent_name);
            setIsWaitingReply(false);
          } else if (hasLegacyContent) {
            streamingHook.processLegacyStream(event.content!, event.content_type!);
            setIsWaitingReply(false);
          }
        } catch (err) {
          console.error('[Stream] Error processing stream chunk:', err);
        }
        lastStreamActivityRef.current = Date.now();
        if (firstChunkTimeoutRef.current) {
          clearTimeout(firstChunkTimeoutRef.current);
          firstChunkTimeoutRef.current = null;
        }
        break;

      case 'execution_complete': {
        const tokenData = event.tokens || event.data?.tokens || event.data?.token_usage || null;

        if (event.user_message_id) {
          setMessages(prev => {
            const lastUserMsgIdx = prev.reduce((lastIdx, msg, idx) => {
              if (msg.role === 'user') return idx;
              return lastIdx;
            }, -1);

            return prev.map((m, idx) => {
              if (m.role === 'user' && idx === lastUserMsgIdx && m.id.startsWith('msg_')) {
                return { ...m, id: event.user_message_id! };
              }
              return m;
            });
          });
        }

        handleExecutionEnd(streamingHook, 'completed', 'completed', tokenData);
        break;
      }

      case 'message_ids_updated': {
        if (event.message_ids) {
          setMessages(prev => {
            const lastAssistantMsgIdx = prev.reduce((lastIdx, msg, idx) => {
              if (msg.role === 'assistant') return idx;
              return lastIdx;
            }, -1);

            if (lastAssistantMsgIdx === -1) return prev;

            const updatedMessages = prev.map((m, idx) => {
              if (m.role === 'assistant' && idx === lastAssistantMsgIdx && m.id.startsWith('msg_')) {
                const mainAgentId = Object.keys(event.message_ids!)[0];
                const newId = mainAgentId ? event.message_ids![mainAgentId] : undefined;
                if (newId) {
                  return { ...m, id: newId };
                }
              }
              return m;
            });

            if (currentSessionId) {
              setSessions(sessionsState => sessionsState.map(s =>
                s.id === currentSessionId
                  ? {
                      ...s,
                      messages: updatedMessages.map((m, i): any => ({
                        id: m.id,
                        role: m.role,
                        content: m.content || '',
                        reasoning_content: m.reasoning_content,
                        data: m.data || [],
                        message_index: i,
                        timestamp: m.timestamp,
                        created_at: m.timestamp,
                        tokens: m.tokens,
                      }))
                    }
                  : s
              ));
            }

            return updatedMessages;
          });
        }
        break;
      }

      case 'execution_stopped': {
        const tokenData = event.tokens || event.data?.tokens || event.data?.token_usage || null;
        handleExecutionEnd(streamingHook, 'stopped', 'cancelled', tokenData);
        break;
      }

      case 'execution_cancelled':
      case 'agent_error':
      case 'execution_error': {
        const isCancelled = event.event_type === 'execution_cancelled';
        const messageStatus = isCancelled ? 'stopped' : 'error';
        const sessionStatus = isCancelled ? 'cancelled' : 'error';
        const tokenData = event.tokens || event.data?.tokens || event.data?.token_usage || null;
        const errorMessage = !isCancelled ? (event.error || '执行失败') : undefined;
        handleExecutionEnd(streamingHook, messageStatus, sessionStatus, tokenData, errorMessage);
        if (!isCancelled) {
          message.error(event.error || '执行失败');
        }
        break;
      }
    }
  }, [startRunning, stopRunning, setIsWaitingReply, setCallRecords, openAgenticPanel, setMessages, clearSubagentOutputs, setSubagentOutputs, currentSessionId, incrementFileChangeRefreshKey, clearTimeouts]);

  const handleWebSocketMessage = useCallback((msg: any) => {
    if (msg.type === 'execution_result') {
      stopRunning();
      setIsWaitingReply(false);
    }
  }, [stopRunning, setIsWaitingReply]);

  const handleWebSocketError = useCallback((_error?: any) => {
    message.error('WebSocket连接错误');
    stopRunning();
    setIsWaitingReply(false);
  }, [stopRunning, setIsWaitingReply]);

  const { isConnected, executeFlow, stopFlow } = useRunWebSocket({
    agenticFlowId: agenticFlowId || null,
    sessionId: currentSessionId,
    runProjectId: currentProject?.id || null,
    onMessage: handleWebSocketMessage,
    onEvent: handleExecutionEvent,
    onError: handleWebSocketError,
    autoReconnect: true,
  });

  useEffect(() => {
    isConnectedRef.current = isConnected;
  }, [isConnected]);

  const prevIsConnectedRef = useRef(false);

  const handleWebSocketReconnect = useCallback(async () => {
    const { isRunning: running, isWaitingReply: waiting, currentSessionId: sessionId } = useRunPanelStore.getState();
    if (!running && !waiting) return;
    if (!sessionId) return;

    try {
      const sessionData = await runApi.getSession(sessionId);
      const sessionStatus = sessionData?.status;

      if (sessionStatus === 'completed' || sessionStatus === 'failed' || sessionStatus === 'stop') {
        const finalData = streamingDataHookRef.current.finalizeStream();
        const tokenData = sessionData?.token_usage;
        const totalTokens = tokenData?.total_tokens ||
          (tokenData?.prompt_tokens && tokenData?.completion_tokens
            ? tokenData.prompt_tokens + tokenData.completion_tokens
            : undefined);

        if (!messageAddedRef.current) {
          const msgId = currentMsgIdRef.current || `msg_${Date.now()}`;
          const statusMap: Record<string, string> = {
            completed: 'completed',
            failed: 'error',
            stop: 'stopped',
          };
          const assistantMessage: LLMMessage = {
            id: msgId,
            role: 'assistant',
            content: '',
            data: finalData,
            timestamp: new Date().toISOString(),
            status: (statusMap[sessionStatus] || 'completed') as any,
            tokens: totalTokens,
          };
          setMessages(prev => [...prev, assistantMessage]);
          messageAddedRef.current = true;
        }

        stopRunning();
        setIsWaitingReply(false);
        clearTimeouts();

        try {
          const { messages: restoredMessages, fileChangesMap } = await loadMessages(sessionId);
          if (restoredMessages && restoredMessages.length > 0) {
            setMessages(restoredMessages);
            setFileChangesMap(prev => ({ ...prev, ...fileChangesMap }));
            incrementFileChangeRefreshKey();
          }
        } catch {}
      }
    } catch (error) {
      console.warn('[ReconnectCheck] Failed to check session status:', error);
      stopRunning();
      setIsWaitingReply(false);
      clearTimeouts();
    }
  }, [stopRunning, setIsWaitingReply, setMessages, setFileChangesMap, incrementFileChangeRefreshKey, clearTimeouts]);

  useEffect(() => {
    if (isConnected && !prevIsConnectedRef.current) {
      handleWebSocketReconnect();
    }
    prevIsConnectedRef.current = isConnected;
  }, [isConnected, handleWebSocketReconnect]);

  const createNewSession = useCallback(() => {
    const newSessionId = storeCreateNewSession(agenticFlowId || null, currentProject?.id || null);
    if (!newSessionId) {
      message.error('请先选择项目和流程');
      return null;
    }
    streamingDataHookRef.current.resetStream();
    return newSessionId;
  }, [agenticFlowId, currentProject?.id, storeCreateNewSession]);

  const handleSwitchSession = useCallback(async (sessionId: string) => {
    if (currentSessionId === sessionId) {
      if (messagesLengthRef.current === 0) {
        try {
          const { messages: restoredMessages, fileChangesMap, rawMessages } = await loadMessages(sessionId);
          if (restoredMessages && restoredMessages.length > 0) {
            setMessages(restoredMessages);
            setFileChangesMap(prev => ({ ...prev, ...fileChangesMap }));
            setSessions(sessions.map(s => s.id === sessionId ? { ...s, messages: rawMessages, fileChangesMap } : s));
          }
        } catch (error) {
          console.warn('Failed to load session messages:', error);
        }
      }
      return;
    }

    setCurrentSessionId(sessionId);
    setCallRecords([]);
    streamingDataHookRef.current.resetStream();
    setMessages([]);
    clearRecallPreview();

    try {
      const { messages: restoredMessages, fileChangesMap, rawMessages } = await loadMessages(sessionId);
      if (restoredMessages && restoredMessages.length > 0) {
        setMessages(restoredMessages);
        setFileChangesMap(prev => ({ ...prev, ...fileChangesMap }));
        setSessions(sessions.map(s => s.id === sessionId ? { ...s, messages: rawMessages, fileChangesMap } : s));
      } else {
        setMessages([]);
      }
    } catch (error) {
      console.warn('Failed to load session messages:', error);
      setMessages([]);
    }
  }, [currentSessionId, setCurrentSessionId, setMessages, setCallRecords, sessions, setSessions, setFileChangesMap]);

  const handleDeleteSession = async (sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const success = await storeDeleteSession(sessionId, agenticFlowId, currentProject?.id);
    if (success) {
      message.success('会话已删除');
    } else {
      message.error('删除会话失败');
    }
  };

  const handleGoHome = () => navigate('/main');

  /**
   * 切换项目时重置会话状态
   *
   * 功能：
   * 1. 清空当前 session_id
   * 2. 清空消息列表
   * 3. 清空调用记录
   * 4. 重置流式数据
   * 5. 触发 WebSocket 重新连接（通过依赖项变化自动触发）
   */
  const resetSessionForNewProject = useCallback(async () => {
    setCurrentSessionId(null);

    // 2. 清空消息列表
    setMessages([]);

    // 3. 清空 sessions 列表
    setSessions([]);

    // 4. 清空调用记录
    setCallRecords([]);
    clearSubagentOutputs();

    // 5. 重置流式数据
    streamingDataHookRef.current.resetStream();
  }, [
    setCurrentSessionId,
    setMessages,
    setSessions,
    setCallRecords,
    clearSubagentOutputs
  ]);

  const handleSelectFolder = async () => {
    if (!agenticFlowId) {
      message.warning('请先选择工作流');
      return;
    }
    const result = await openNativeFolderDialog(agenticFlowId);
    if (result?.project_id) {
      if (currentProject?.id === result.project_id) {
        message.info('已在当前项目中');
        return;
      }

      message.success(`已选择项目: ${result.project_name}`);

      // ✅ 先更新currentProject，确保后续操作使用正确的项目
      setCurrentProject({
        id: result.project_id,
        name: result.project_name,
        folder_path: result.folder_path,
      });

      // ✅ 重置会话状态
      await resetSessionForNewProject();

      // ✅ 使用项目ID直接加载sessions（避免React状态异步更新问题）
      await loadSessionsForProject(result.project_id);
    }
  };

  const handleSelectFromRecent = async (project: RecentProjectInfo) => {
    if (!agenticFlowId) return;

    setSwitchingProjectId(project.project_id);
    try {
      const result = await selectOrCreateProject(agenticFlowId, project.folder_path);
      if (result) {
        if (currentProject?.id === result.project_id) {
          message.info(`当前已处于工作区: ${project.project_name}`);
          return;
        }

        message.success(`已切换到工作区: ${project.project_name}`);
        setRecentModalVisible(false);

        // ✅ 先更新currentProject，确保后续操作使用正确的项目
        setCurrentProject({
          id: result.project_id,
          name: result.project_name,
          folder_path: result.folder_path,
        });

        // ✅ 重置会话状态
        await resetSessionForNewProject();

        // ✅ 使用项目ID直接加载sessions（避免React状态异步更新问题）
        await loadSessionsForProject(result.project_id);
      }
    } finally {
      setSwitchingProjectId(null);
    }
  };

  const handleSendMessage = async () => {
    if (!inputText.trim()) return;
    if (!agenticFlowId || !currentProject?.id) {
      message.error('请先选择项目和流程');
      return;
    }

    // 添加运行状态检查
    if (isRunning || isWaitingReply) {
      message.warning('请等待当前对话完成后再发送新消息');
      return;
    }

    // 保存输入文本，避免在异步操作中被清空
    const currentInputText = inputText;

    let sessionId = currentSessionId;
    let needWaitConnection = false;
    const existingSession = sessions.find(s => s.id === sessionId);
    
    if (!sessionId || !existingSession) {
      sessionId = crypto.randomUUID();
      setCurrentSessionId(sessionId);
      needWaitConnection = true;
      setSessions(prev => [{
        id: sessionId!,
        status: 'pending',
        name: '新任务',
        createdAt: new Date().toISOString(),
        messages: [],
      }, ...prev]);
    }

    const userMessage: LLMMessage = {
      id: `msg_user_${Date.now()}`,
      role: 'user',
      content: currentInputText,
      timestamp: new Date().toISOString(),
    };

    const assistantMsgId = `msg_asst_${Date.now()}`;
    setCurrentMsgId(assistantMsgId);
    currentMsgIdRef.current = assistantMsgId;
    streamingDataHookRef.current.setCurrentMsgIdRef(assistantMsgId);
    setMessages(prev => [...prev, userMessage]);
    
    setSessions(prev => prev.map(s => 
      s.id === sessionId 
        ? { 
            ...s, 
            messages: [...(s.messages || []), {
              id: userMessage.id,
              role: userMessage.role,
              content: userMessage.content,
              reasoning_content: userMessage.reasoning_content,
              data: userMessage.data || [],
              message_index: (s.messages?.length || 0),
              timestamp: userMessage.timestamp,
              created_at: userMessage.timestamp,
              tokens: userMessage.tokens,
            }]
          }
        : s
    ));
    
    setInputText('');
    startRunning();
    setIsWaitingReply(true);

    setTimeout(() => {
      messageListRef.current?.scrollToBottom();
    }, 100);

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

      if (needWaitConnection) {
        const maxWaitTime = 10000;
        const startTime = Date.now();
        
        await new Promise<void>((resolve) => {
          const checkConnection = () => {
            if (isConnectedRef.current) {
              resolve();
            } else if (Date.now() - startTime > maxWaitTime) {
              resolve();
            } else {
              setTimeout(checkConnection, 100);
            }
          };
          checkConnection();
        });
      }

      if (isConnectedRef.current) {
        // 从canvasData获取第一个agent节点的llm_config_id
        await executeFlow(currentCanvasData, currentInputText, agenticFlowId, sessionId, currentProject?.id);

        timeoutRef.current = setTimeout(() => {
          const currentIsRunning = useRunPanelStore.getState().isRunning;
          if (currentIsRunning) {
            message.error('执行超时，请重试');
            stopFlow();
            stopRunning();
          }
        }, WEBSOCKET_CONFIG.EXECUTION_TIMEOUT * 1000);

        firstChunkTimeoutRef.current = setTimeout(() => {
          const currentIsWaiting = useRunPanelStore.getState().isWaitingReply;
          if (currentIsWaiting) {
            message.error('等待响应超时，请检查后端服务是否正常');
            stopFlow();
            stopRunning();
          }
        }, WEBSOCKET_CONFIG.RESPONSE_TIMEOUT * 1000);

        lastStreamActivityRef.current = Date.now();
        streamActivityCheckRef.current = setInterval(() => {
          const { isRunning: checkRunning } = useRunPanelStore.getState();
          if (checkRunning && lastStreamActivityRef.current > 0) {
            const elapsed = Date.now() - lastStreamActivityRef.current;
            if (elapsed > 60000) {
              stopFlow();
              handleWebSocketReconnect();
            }
          }
        }, 30000);
      }
    } catch (error: any) {
      message.error('发送消息失败: ' + (error.response?.data?.detail || error.message));
      setMessages(prev => prev.filter(m => m.id !== userMessage.id));
      stopRunning();
      setIsWaitingReply(false);
    }
  };

  const handleStopExecution = async () => {
    if (isStoppingRef.current) return;
    isStoppingRef.current = true;

    const finalizeAndStop = () => {
      const finalData = streamingDataHookRef.current.finalizeStream();
      if (!messageAddedRef.current && finalData.length > 0) {
        const msgId = currentMsgIdRef.current || `msg_${Date.now()}`;
        const stoppedMessage: LLMMessage = {
          id: msgId,
          role: 'assistant',
          content: '',
          data: finalData,
          timestamp: new Date().toISOString(),
          status: 'stopped',
        };
        setMessages(prev => [...prev, stoppedMessage]);
        messageAddedRef.current = true;
      }
      stopRunning();
      setIsWaitingReply(false);
      clearTimeouts();
    };

    try {
      const sent = await stopFlow();
      stopRunning();
      setIsWaitingReply(false);
      clearTimeouts();
      if (sent) {
        setTimeout(() => {
          const stillRunning = useRunPanelStore.getState().isRunning || useRunPanelStore.getState().isWaitingReply;
          if (stillRunning) {
            finalizeAndStop();
          }
        }, 3000);
      } else {
        finalizeAndStop();
      }
    } catch {
      finalizeAndStop();
    } finally {
      setTimeout(() => {
        isStoppingRef.current = false;
      }, 500);
    }
  };

  const handleFileSelect = async (file: FileInfo) => {
    const isCode = isCodeFile(file.name);
    const isBinary = isBinaryFile(file.name);
    const projectFolder = currentProject?.folder_path;
    const resolvedPath = resolveFilePath(file.path, projectFolder);

    const result = openOrNavigateFile({
      filePath: resolvedPath,
      fileName: file.name,
      isCode,
      isBinary,
      projectFolderPath: projectFolder ?? null,
    });

    if (result.existed) return;

    try {
      const response = await runProjectApi.readFile(resolvedPath);
      if (response.code === 200) {
        if (isCode) {
          updateEditorTab(result.tab.id, { content: response.data.content, isLoading: false });
        } else {
          updateDocumentTab(result.tab.id, { content: response.data.content, isLoading: false });
        }
      }
    } catch (error) {
      if (isCode) {
        updateEditorTab(result.tab.id, { content: `无法加载文件: ${error}`, isLoading: false });
      } else {
        updateDocumentTab(result.tab.id, { content: `无法加载文件: ${error}`, isLoading: false });
      }
    }
  };

  const handleFileClickByPath = (filePath: string) => {
    const name = filePath.split(/[\\/]/).pop() || filePath;
    const projectFolder = currentProject?.folder_path;
    const resolvedPath = resolveFilePath(filePath, projectFolder);
    handleFileSelect({ name, path: resolvedPath, is_dir: false, size: 0, modified: new Date().toISOString() });
  };

  const toRelativePath = useCallback((absolutePath: string): string => {
    const projectFolder = currentProject?.folder_path;
    if (!projectFolder) return absolutePath;
    const pf = projectFolder.replace(/\\/g, '/').replace(/\/+$/, '');
    const tp = absolutePath.replace(/\\/g, '/');
    if (tp.startsWith(pf + '/')) return tp.slice(pf.length + 1);
    return absolutePath;
  }, [currentProject?.folder_path]);

  useEffect(() => {
    const tab = editorTabs.find(t => t.id === activeEditorTabId);
    if (tab && tab.path) {
      fileExplorerActionsRef.current?.navigateToFile(toRelativePath(tab.path));
    }
  }, [activeEditorTabId, editorTabs]);

  const handleEditorContentChange = (tabId: string, content: string) => {
    updateEditorTab(tabId, { content, isModified: true });
  };

  const handleDocumentContentChange = (tabId: string, content: string) => {
    updateDocumentTab(tabId, { content, isModified: true });
  };

  const handleAutoSave = async (tab: FileTab) => {
    if (!tab.isModified || tab.isBinary) return;
    try {
      await runProjectApi.writeFile(tab.path, tab.content);
      if (tab.type === 'editor') {
        updateEditorTab(tab.id, { isModified: false });
      } else {
        updateDocumentTab(tab.id, { isModified: false });
      }
    } catch (error) {
      console.error('Auto save failed:', error);
    }
  };

  const handleMouseDown = useCallback((e: React.MouseEvent, dividerIndex: number) => {
    e.preventDefault();
    setIsDragging(dividerIndex);
    setDragStartX(e.clientX);
    setDragStartRatios([...panelRatios]);
  }, [panelRatios]);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (isDragging === null || !containerRef.current) return;

    const containerRect = containerRef.current.getBoundingClientRect();
    const deltaX = e.clientX - dragStartX;
    const deltaRatio = (deltaX / containerRect.width) * 10;

    const newRatios = [...dragStartRatios];
    const leftIndex = isDragging;
    const rightIndex = isDragging + 1;

    let leftNew = dragStartRatios[leftIndex] + deltaRatio;
    let rightNew = dragStartRatios[rightIndex] - deltaRatio;

    if (leftNew < 0.5) leftNew = 0.5;
    if (rightNew < 0.5) rightNew = 0.5;

    newRatios[leftIndex] = leftNew;
    newRatios[rightIndex] = rightNew;

    setPanelRatios(newRatios);
  }, [isDragging, dragStartX, dragStartRatios, setPanelRatios]);

  const handleMouseUp = useCallback(() => setIsDragging(null), []);

  useEffect(() => {
    if (isDragging !== null) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    }
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, handleMouseMove, handleMouseUp]);

  const projectMenuItems: MenuProps['items'] = [
    { key: 'select', label: <span onClick={handleSelectFolder}><FolderOutlined style={{ marginRight: 8 }} />选择项目</span> },
    { key: 'recent', label: <span onClick={() => setRecentModalVisible(true)}><HistoryOutlined style={{ marginRight: 8 }} />历史项目</span> },
  ];

  const totalRatio = panelRatios.reduce((a, b) => a + b, 0);

  const truncatePath = (path: string, maxLength = 40) => {
    if (path.length <= maxLength) return path;
    const parts = path.split(/[/\\]/);
    return parts.length <= 2 ? '...' + path.slice(-(maxLength - 3)) : '.../' + parts.slice(-2).join('/');
  };

  return (
    <>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      <Layout style={{ height: '100%', background: 'var(--bg-100)' }}>
        <Header style={{ 
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          background: 'var(--sidebar-bg)',
          padding: '0 24px', height: 56,
          position: 'sticky', top: 0, zIndex: 100,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 180 }}>
            <div onClick={handleGoHome} style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}>
              <img src="/logo.png" alt="SoloEngine" style={{ width: 32, height: 32, backgroundColor: 'white', borderRadius: 8, padding: 2, objectFit: 'contain' }} />
              <Text style={{ color: '#fff', fontSize: 16, fontWeight: 600 }}>SoloEngine</Text>
            </div>
            <div style={{ width: 1, height: 20, background: 'rgba(255, 255, 255, 0.1)', borderRadius: 1 }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 6, background: 'rgba(255, 255, 255, 0.04)', border: '1px solid rgba(255, 255, 255, 0.06)' }}>
              <LockOutlined style={{ fontSize: 12, color: 'var(--success)' }} />
              <Text style={{ fontSize: 12, color: 'rgba(255, 255, 255, 0.6)' }}>安全沙箱</Text>
            </div>
          </div>
          
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 180, justifyContent: 'flex-end' }}>
            {currentProject ? (
              <Dropdown menu={{ items: projectMenuItems }} trigger={['click']} placement="bottomRight">
                <Button type="text" icon={<FolderOpenOutlined style={{ color: 'rgba(255, 255, 255, 0.7)' }} />} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', height: 34, borderRadius: 8, background: 'rgba(255, 255, 255, 0.06)', border: '1px solid rgba(255, 255, 255, 0.1)', color: 'rgba(255, 255, 255, 0.85)', fontWeight: 500 }}>
                  <Text style={{ maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'rgba(255, 255, 255, 0.85)', fontSize: 13 }}>{currentProject.name}</Text>
                </Button>
              </Dropdown>
            ) : (
              <Button type="primary" icon={<FolderOutlined />} onClick={handleSelectFolder} loading={projectLoading} style={{ display: 'flex', alignItems: 'center', gap: 8, height: 36, borderRadius: 8, background: 'linear-gradient(135deg, var(--primary-100), var(--primary-200))', border: 'none', fontWeight: 500, boxShadow: '0 2px 8px rgba(59, 130, 246, 0.3)' }}>选择项目</Button>
            )}
          </div>
        </Header>

        <div ref={containerRef} style={{ height: 'calc(100vh - 52px)', position: 'relative', display: 'flex', flexDirection: 'row', background: 'var(--bg-100)', overflow: 'hidden' }}>
          <div style={{ width: `${(panelRatios[0] / totalRatio) * 100}%`, position: 'relative', flexShrink: 0 }}>
            <SessionList
              sessions={sessions}
              currentSessionId={currentSessionId}
              agenticFlowId={agenticFlowId}
              currentProjectId={currentProject?.id}
              onSelectSession={handleSwitchSession}
              onDeleteSession={handleDeleteSession}
              onCreateSession={createNewSession}
            />
            <ResizableDivider dividerIndex={0} isDragging={isDragging} onMouseDown={handleMouseDown} />
          </div>

          <div style={{ width: `${(panelRatios[1] / totalRatio) * 100}%`, position: 'relative', background: 'var(--bg-100)', display: 'flex', flexDirection: 'column', flexShrink: 0, borderRight: '1px solid var(--bg-300)' }}>
            <div style={{ flex: 1, position: 'relative', minHeight: 0, display: 'flex', flexDirection: 'column', isolation: 'isolate' }}>
              <div ref={messageScrollContainerRef} style={{ flex: 1, overflow: 'auto', overflowX: 'hidden', padding: 16, display: 'flex', flexDirection: 'column', background: 'var(--bg-100)', minHeight: 0 }}>
                <MessageList
                  ref={messageListRef}
                  isWaitingReply={isWaitingReply}
                  scrollContainerRef={messageScrollContainerRef}
                  onFileClick={handleFileClickByPath}
                />
              </div>
              <ScrollNavigationButtons containerRef={messageScrollContainerRef} messageListRef={messageListRef} />
            </div>
            <MessageInput
              value={inputText}
              onChange={setInputText}
              onSend={handleSendMessage}
              onStop={handleStopExecution}
              isRunning={isRunning || isWaitingReply}
              disabled={!agenticFlowId || !currentProject?.id}
            />
            <ResizableDivider dividerIndex={1} isDragging={isDragging} onMouseDown={handleMouseDown} />
          </div>

          <div style={{ width: `${(panelRatios[2] / totalRatio) * 100}%`, position: 'relative', flexShrink: 0 }}>
            <AgenticPanel
              panels={agenticPanels}
              activeTab={activeAgenticTab}
              editorTabs={editorTabs}
              documentTabs={documentTabs}
              activeEditorTabId={activeEditorTabId}
              activeDocumentTabId={activeDocumentTabId}
              onOpenPanel={openAgenticPanel}
              onClosePanel={closeAgenticPanel}
              onSetActiveTab={setActiveAgenticTab}
              onSetActiveEditorTabId={setActiveEditorTabId}
              onSetActiveDocumentTabId={setActiveDocumentTabId}
              onCloseEditorTab={closeEditorTab}
              onCloseDocumentTab={closeDocumentTab}
              onEditorContentChange={handleEditorContentChange}
              onDocumentContentChange={handleDocumentContentChange}
              onAutoSave={handleAutoSave}
            />
            <ResizableDivider dividerIndex={2} isDragging={isDragging} onMouseDown={handleMouseDown} />
          </div>

          <div style={{ width: `${(panelRatios[3] / totalRatio) * 100}%`, background: 'var(--bg-100)', display: 'flex', flexDirection: 'column', position: 'relative', flexShrink: 0 }}>
            <div style={{ padding: '0 10px', borderBottom: '1px solid var(--bg-300)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg-100)', height: 45 }}>
              <Text strong style={{ fontSize: 13, color: 'var(--text-100)' }}>资源管理器</Text>
              {currentProject && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                  <Tooltip title="新建文件"><Button type="text" size="small" icon={<FileAddOutlined style={{ fontSize: 13 }} />} onClick={() => fileExplorerActionsRef.current?.openNewFileDialog()} style={{ width: 26, height: 26, padding: 0, color: 'var(--text-300)' }} /></Tooltip>
                  <Tooltip title="新建文件夹"><Button type="text" size="small" icon={<FolderAddOutlined style={{ fontSize: 13 }} />} onClick={() => fileExplorerActionsRef.current?.openNewFolderDialog()} style={{ width: 26, height: 26, padding: 0, color: 'var(--text-300)' }} /></Tooltip>
                  <Tooltip title="刷新"><Button type="text" size="small" icon={<ReloadOutlined style={{ fontSize: 13 }} />} onClick={() => fileExplorerActionsRef.current?.refresh()} style={{ width: 26, height: 26, padding: 0, color: 'var(--text-300)' }} /></Tooltip>
                </div>
              )}
            </div>
            <div style={{ flex: 1, overflow: 'auto' }}>
              {currentProject ? (
                <FileExplorer onFileSelect={handleFileSelect} onFileEdit={handleFileSelect} onActionsReady={actions => { fileExplorerActionsRef.current = actions; const tab = editorTabs.find(t => t.id === activeEditorTabId); if (tab && tab.path) actions.navigateToFile(toRelativePath(tab.path)); }} />
              ) : (
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 32 }}>
                  <div style={{ width: 48, height: 48, borderRadius: 12, background: 'var(--bg-200)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 10 }}><FolderOutlined style={{ fontSize: 20, color: 'var(--text-300)' }} /></div>
                  <Text style={{ fontSize: 11, color: 'var(--text-300)' }}>请先选择项目</Text>
                </div>
              )}
            </div>
          </div>
        </div>

        <Modal title={<div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><HistoryOutlined style={{ color: 'var(--primary-100)' }} /><span>历史项目</span></div>} open={recentModalVisible} onCancel={() => setRecentModalVisible(false)} footer={null} width={480} styles={{ content: { borderRadius: 12 }, header: { borderBottom: '1px solid var(--bg-300)' } }}>
          <Spin spinning={projectLoading}>
            {recentProjects.length === 0 ? (
              <Empty description="暂无历史项目" style={{ padding: '40px 0' }} />
            ) : (
              <List dataSource={recentProjects} renderItem={(project) => (
                <List.Item style={{ cursor: 'pointer', padding: '12px 14px', borderRadius: 10, border: 'none' }} onClick={() => handleSelectFromRecent(project)}>
                  <List.Item.Meta avatar={switchingProjectId === project.project_id ? <Spin size="small" /> : currentProject?.id === project.project_id ? <CheckOutlined style={{ color: 'var(--success)', fontSize: 16 }} /> : <FolderOutlined style={{ fontSize: 16, color: 'var(--text-200)' }} />} title={<div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Text strong style={{ fontSize: 13 }}>{project.project_name}</Text>{currentProject?.id === project.project_id && <Tag color="success" style={{ fontSize: 10, padding: '0 6px', margin: 0, borderRadius: 4 }}>当前</Tag>}</div>} description={<Tooltip title={project.folder_path}><Text type="secondary" style={{ fontSize: 11 }}>{truncatePath(project.folder_path)}</Text></Tooltip>} />
                  <Text type="secondary" style={{ fontSize: 11 }}>{formatSmartTime(project.accessed_at)}</Text>
                </List.Item>
              )} style={{ maxHeight: 360, overflow: 'auto' }} />
            )}
          </Spin>
        </Modal>

      </Layout>
    </>
  );
};

const isCodeFile = (fileName: string): boolean => {
  const codeExtensions = ['js', 'jsx', 'ts', 'tsx', 'py', 'java', 'c', 'cpp', 'h', 'hpp', 'go', 'rs', 'rb', 'php', 'cs', 'swift', 'kt', 'scala', 'vue', 'svelte', 'css', 'scss', 'less', 'html', 'xml', 'json', 'yaml', 'yml', 'sh', 'bash', 'ps1', 'bat', 'sql', 'log', 'ini', 'conf', 'cfg', 'env', 'toml', 'md', 'markdown'];
  return codeExtensions.includes(fileName.split('.').pop()?.toLowerCase() || '');
};

const isBinaryFile = (fileName: string): boolean => {
  const binaryExtensions = ['pyc', 'pyo', 'pyd', 'exe', 'dll', 'so', 'dylib', 'bin', 'dat', 'png', 'jpg', 'jpeg', 'gif', 'bmp', 'ico', 'webp', 'mp3', 'mp4', 'wav', 'avi', 'mov', 'mkv', 'flv', 'wmv', 'zip', 'tar', 'gz', 'rar', '7z', 'bz2', 'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'ttf', 'otf', 'woff', 'woff2', 'eot', 'class', 'jar', 'war', 'ear', 'node_modules', 'lock', 'sqlite', 'db'];
  return binaryExtensions.includes(fileName.split('.').pop()?.toLowerCase() || '');
};

function safeJoinPath(base: string, ...parts: string[]): string {
  const segments = base.replace(/\\/g, '/').replace(/\/+$/, '').split('/');
  for (const part of parts) {
    const partSegments = part.replace(/\\/g, '/').replace(/\/+$/, '').split('/');
    for (const seg of partSegments) {
      if (seg === '..') {
        if (segments.length > 0) segments.pop();
      } else if (seg !== '.' && seg !== '') {
        segments.push(seg);
      }
    }
  }
  return segments.join('/');
}

function resolveFilePath(filePath: string, projectFolderPath?: string | null): string {
  const normalized = filePath.replace(/\\/g, '/');
  if (/^[a-zA-Z]:\//.test(normalized)) {
    return normalized;
  }
  if (normalized.startsWith('/')) {
    return normalized;
  }
  if (!projectFolderPath) {
    return normalized;
  }
  return safeJoinPath(projectFolderPath, normalized);
}

export default RunPanel;
