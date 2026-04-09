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
import { Layout, Button, Typography, message, Modal, Dropdown, List, Tag, Empty, Spin, Tooltip } from 'antd';
import type { MenuProps } from 'antd';
import {
  RobotOutlined,
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
import { useStreamingData } from './hooks/useStreamingData';
import { useRunWebSocket, ExecutionEvent } from '../../hooks/useRunWebSocket';
import { useRunProjectStore } from '../../store/runProjectStore';
import { runApi } from '../../services/runApi';
import { agenticFlowApi } from '../../services/agenticFlowApi';
import { runProjectApi, RecentProjectInfo, FileInfo } from '../../services/runProjectApi';

import MessageList from './components/MessageList';
import MessageInput from './components/MessageInput';
import SessionList from './components/SessionList';
import AgenticPanel from './components/AgenticPanel';
import FileExplorer from './FileExplorer';

import type { LLMMessage, DataBlock, FileTab, CallRecord, SubagentOutput } from './types';

const { Header } = Layout;
const { Text } = Typography;

interface RunPanelProps {
  agenticFlowId?: string;
}

const RunPanel: React.FC<RunPanelProps> = ({ agenticFlowId }) => {
  const navigate = useNavigate();

  // 统一格式：将 SessionMessage[] 转换为 LLMMessage[]
  const convertToLLMMessages = (msgs: any[]): LLMMessage[] => {
    return msgs.map((msg: any) => {
      const data: DataBlock[] = msg.data || [];
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
        timestamp: msg.created_at || msg.timestamp || new Date().toISOString(),
        tokens: msg.total_tokens || msg.tokens,
        agent_id: msg.agent_id,
        agent_name: msg.agent_name,
        parent_agent_id: msg.parent_agent_id,
        status: msg.status,
      };
    });
  };

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
    callRecords,
    setCallRecords,
    addSubagentOutput,
    updateSubagentOutput,
    setSubagentOutputs,
    clearSubagentOutputs,
    streamingData,
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
    addEditorTab,
    updateEditorTab,
    closeEditorTab,
    setActiveEditorTabId,
    addDocumentTab,
    updateDocumentTab,
    closeDocumentTab,
    setActiveDocumentTabId,
    currentProject,
    recentProjects,
    canvasData,
    setCanvasData,
    setRecentProjects,
    setCurrentProject,
    setExpandedReasoning,
    setExpandedToolCalls,
    setStreamingExpandedKeys,
    clearStreamingData,
    messages,
    setMessages,
    addMessage,
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
  const isConnectedRef = useRef(false);
  const streamingDataRef = useRef<DataBlock[]>([]);
  const messageAddedRef = useRef<boolean>(false);
  const currentMsgIdRef = useRef<string>('');
  const fileExplorerActionsRef = useRef<{ refresh: () => void; openNewFileDialog: () => void; openNewFolderDialog: () => void } | null>(null);
  const autoSaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [recentModalVisible, setRecentModalVisible] = useState(false);
  const [switchingProjectId, setSwitchingProjectId] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState<number | null>(null);
  const [dragStartX, setDragStartX] = useState(0);
  const [dragStartRatios, setDragStartRatios] = useState<number[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    streamingDataRef.current = streamingData;
  }, [streamingData]);

  useEffect(() => {
    currentMsgIdRef.current = currentMsgId;
  }, [currentMsgId]);

  // 加载指定项目的sessions
  const loadSessionsForProject = useCallback(async (projectId: string) => {
    if (!agenticFlowId || !projectId) return;
    
    try {
      const sessionsData = await runApi.getSessions({
        agentic_flow_id: agenticFlowId,
        run_project_id: projectId,
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
  }, [agenticFlowId, setSessions]);

  // 根据currentProject加载sessions（用于初始化）
  const loadSessionsFromBackend = useCallback(async () => {
    if (!agenticFlowId || !currentProject?.id) return;
    await loadSessionsForProject(currentProject.id);
  }, [agenticFlowId, currentProject?.id, loadSessionsForProject]);

  useEffect(() => {
    loadCurrentProject(agenticFlowId);
    if (agenticFlowId) {
      loadRecentProjects(agenticFlowId).then((projects: any) => {
        setRecentProjects(projects || []);
      });
    }
  }, [agenticFlowId, loadCurrentProject, loadRecentProjects, setRecentProjects]);

  useEffect(() => {
    if (runProjectCurrentProject) {
      setCurrentProject({
        id: runProjectCurrentProject.id,
        name: runProjectCurrentProject.name,
        folder_path: runProjectCurrentProject.folder_path,
      });
    } else {
      setCurrentProject(null);
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

  useEffect(() => {
    if (!agenticFlowId || !currentProject?.id) return;

    const init = async () => {
      await loadSessionsFromBackend();
      
      const storedState = localStorage.getItem('run-panel-store');
      if (storedState) {
        try {
          const parsed = JSON.parse(storedState);
          const storedSessionId = parsed.state?.currentSessionId;
          
          if (storedSessionId) {
            try {
              // API 返回 SessionMessage[] 格式（统一格式）
              const msgs = await runApi.getSessionMessages(storedSessionId);
              if (msgs && msgs.length > 0) {
                setCurrentSessionId(storedSessionId);
                setMessages(convertToLLMMessages(msgs));
              }
            } catch {
              setCurrentSessionId(null);
              setMessages([]);
            }
          }
        } catch (e) {
          console.error('Failed to parse stored session:', e);
        }
      }
    };

    init();
  }, [agenticFlowId, currentProject?.id, loadSessionsFromBackend, setCurrentSessionId, setMessages]);

  const handleExecutionEvent = useCallback((event: ExecutionEvent) => {
    switch (event.event_type) {
      case 'execution_start':
        setCallRecords([]);
        clearSubagentOutputs();
        streamingDataHook.resetStream();
        messageAddedRef.current = false;
        startRunning();
        setIsWaitingReply(true);
        break;

      case 'agent_start':
        console.log(`Agent started: ${event.agent_name} (${event.agent_id})`);
        break;

      case 'agent_complete':
        console.log(`Agent completed: ${event.agent_name}`);
        break;

      case 'tool_call':
        setCallRecords((prev: CallRecord[]) => {
          const callId = event.tool_call_id || event.tool_name || generateId();
          const existingIndex = prev.findIndex((r: CallRecord) => r.callId === callId && r.type === 'tool');
          
          if (existingIndex >= 0) {
            const updated = [...prev];
            updated[existingIndex] = {
              ...updated[existingIndex],
              status: 'running',
              startTime: updated[existingIndex].startTime || Date.now(),
              metadata: (event as any).metadata,
            };
            return updated;
          }
          
          return [...prev, {
            id: generateId(),
            callId,
            type: 'tool',
            name: event.tool_name || 'unknown',
            status: 'running',
            arguments: event.tool_args,
            timestamp: event.timestamp,
            startTime: Date.now(),
            metadata: (event as any).metadata,
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
          const endTime = Date.now();
          
          return prev.map((r: CallRecord) => {
            if (r.callId === callId && r.type === 'tool') {
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

      case 'skill_call':
        setCallRecords((prev: CallRecord[]) => {
          const callId = (event as any).skill_call_id || (event as any).skill_name || generateId();
          const existingIndex = prev.findIndex((r: CallRecord) => r.callId === callId && r.type === 'skill');
          
          if (existingIndex >= 0) {
            const updated = [...prev];
            updated[existingIndex] = {
              ...updated[existingIndex],
              status: 'running',
              startTime: updated[existingIndex].startTime || Date.now(),
              metadata: (event as any).metadata,
            };
            return updated;
          }
          
          return [...prev, {
            id: generateId(),
            callId,
            type: 'skill',
            name: (event as any).skill_name || 'unknown',
            status: 'running',
            arguments: (event as any).skill_args,
            result: (event as any).skill_result,
            timestamp: event.timestamp,
            startTime: Date.now(),
            metadata: (event as any).metadata,
          }];
        });
        break;

      case 'skill_result':
        setCallRecords((prev: CallRecord[]) => {
          const callId = (event as any).skill_call_id || (event as any).skill_name;
          const endTime = Date.now();
          
          return prev.map((r: CallRecord) => {
            if (r.callId === callId && r.type === 'skill') {
              return {
                ...r,
                status: event.error ? 'error' : 'success',
                result: (event as any).skill_result,
                error: event.error,
                endTime,
                duration: endTime - (r.startTime || endTime),
              };
            }
            return r;
          });
        });
        break;

      case 'mcp_call':
        setCallRecords((prev: CallRecord[]) => {
          const callId = (event as any).mcp_call_id || (event as any).mcp_name || generateId();
          const existingIndex = prev.findIndex((r: CallRecord) => r.callId === callId && r.type === 'mcp');
          
          if (existingIndex >= 0) {
            const updated = [...prev];
            updated[existingIndex] = {
              ...updated[existingIndex],
              status: 'running',
              startTime: updated[existingIndex].startTime || Date.now(),
              metadata: { ...(event as any).metadata, mcp_server: (event as any).mcp_server },
            };
            return updated;
          }
          
          return [...prev, {
            id: generateId(),
            callId,
            type: 'mcp',
            name: (event as any).mcp_name || 'unknown',
            status: 'running',
            arguments: (event as any).mcp_args,
            result: (event as any).mcp_result,
            timestamp: event.timestamp,
            startTime: Date.now(),
            metadata: { ...(event as any).metadata, mcp_server: (event as any).mcp_server },
          }];
        });
        break;

      case 'mcp_result':
        setCallRecords((prev: CallRecord[]) => {
          const callId = (event as any).mcp_call_id || (event as any).mcp_name;
          const endTime = Date.now();
          
          return prev.map((r: CallRecord) => {
            if (r.callId === callId && r.type === 'mcp') {
              return {
                ...r,
                status: event.error ? 'error' : 'success',
                result: (event as any).mcp_result,
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

      case 'stream':
        const delta = event.delta || {} as any;
        if ((delta as any).reasoning_content || (delta as any).tool_calls || (delta as any).content) {
          setIsWaitingReply(false);
          streamingDataHook.processStreamChunk(delta, (event as any).agent_id, (event as any).agent_name);
        }
        
        if (event.content !== undefined && event.content_type !== undefined) {
          setIsWaitingReply(false);
          streamingDataHook.processLegacyStream(event.content, event.content_type);
        }
        break;

      case 'execution_complete': {
        const finalData = streamingDataHook.finalizeStream();
        if (!messageAddedRef.current && finalData.length > 0) {
          const assistantMessage: LLMMessage = {
            id: currentMsgIdRef.current || `msg_${Date.now()}`,
            role: 'assistant',
            content: '',
            data: finalData,
            timestamp: new Date().toISOString(),
            status: 'completed',
          };
          setMessages(prev => {
            const updatedMessages = [...prev, assistantMessage];
            
            if (currentSessionId) {
              setSessions(sessionsState => sessionsState.map(s => 
                s.id === currentSessionId 
                  ? { 
                      ...s, 
                      status: 'completed',
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
          messageAddedRef.current = true;
        } else if (currentSessionId) {
          // 即使没有消息数据，也要更新session状态
          setSessions(sessionsState => sessionsState.map(s => 
            s.id === currentSessionId 
              ? { ...s, status: 'completed' }
              : s
          ));
        }
        stopRunning();
        setIsWaitingReply(false);
        break;
      }

      case 'execution_cancelled':
      case 'agent_error':
      case 'execution_error': {
        const finalData = streamingDataHook.finalizeStream();
        const isCancelled = event.event_type === 'execution_cancelled' || event.status === 'stopped';
        const messageStatus = isCancelled ? 'stopped' : 'error';
        const sessionStatus = isCancelled ? 'cancelled' : 'error';
        
        if (finalData.length > 0) {
          const stoppedMessage: LLMMessage = {
            id: currentMsgIdRef.current || `msg_${Date.now()}`,
            role: 'assistant',
            content: '',
            data: finalData,
            timestamp: new Date().toISOString(),
            status: messageStatus,
          };
          setMessages(prev => [...prev, stoppedMessage]);
          
          if (currentSessionId) {
            setSessions(sessionsState => sessionsState.map(s => 
              s.id === currentSessionId 
                ? { 
                    ...s, 
                    status: sessionStatus,
                    messages: [...(s.messages || []), {
                      id: stoppedMessage.id,
                      role: stoppedMessage.role,
                      content: stoppedMessage.content || '',
                      reasoning_content: stoppedMessage.reasoning_content,
                      data: stoppedMessage.data || [],
                      message_index: (s.messages?.length || 0),
                      timestamp: stoppedMessage.timestamp,
                      created_at: stoppedMessage.timestamp,
                      tokens: stoppedMessage.tokens,
                    }]
                  }
                : s
            ));
          }
        } else if (currentSessionId) {
          // 即使没有消息数据，也要更新session状态
          setSessions(sessionsState => sessionsState.map(s => 
            s.id === currentSessionId 
              ? { ...s, status: sessionStatus }
              : s
          ));
        }
        stopRunning();
        setIsWaitingReply(false);
        if (!isCancelled) {
          message.error(event.error || '执行失败');
        }
        break;
      }
    }
  }, [startRunning, stopRunning, setIsWaitingReply, setCallRecords, openAgenticPanel, setMessages, streamingDataHook, clearSubagentOutputs, setSubagentOutputs]);

  const handleWebSocketMessage = useCallback((msg: any) => {
    if (msg.type === 'execution_result') {
      stopRunning();
      setIsWaitingReply(false);
    }
  }, [stopRunning, setIsWaitingReply]);

  const { isConnected, executeFlow, stopFlow } = useRunWebSocket({
    agenticFlowId: agenticFlowId || null,
    sessionId: currentSessionId,
    runProjectId: currentProject?.id || null,
    onMessage: handleWebSocketMessage,
    onEvent: handleExecutionEvent,
    onError: () => message.error('WebSocket连接错误'),
    autoReconnect: true,
  });

  useEffect(() => {
    isConnectedRef.current = isConnected;
  }, [isConnected]);

  const createNewSession = useCallback(() => {
    if (!agenticFlowId || !currentProject?.id) {
      message.error('请先选择项目和流程');
      return null;
    }

    const newSessionId = crypto.randomUUID();
    setCurrentSessionId(newSessionId);
    setMessages([]);
    setCallRecords([]);
    streamingDataHook.resetStream();

    return newSessionId;
  }, [agenticFlowId, currentProject?.id, setCurrentSessionId, setMessages, setCallRecords, streamingDataHook]);

  const handleSwitchSession = useCallback(async (sessionId: string) => {
    if (currentSessionId === sessionId) {
      // 即使是当前会话，如果没有消息也需要加载
      if (messages.length === 0) {
        try {
          const msgs = await runApi.getSessionMessages(sessionId);
          if (msgs && msgs.length > 0) {
            setMessages(convertToLLMMessages(msgs));
          }
        } catch (error) {
          console.warn('Failed to load session messages:', error);
        }
      }
      return;
    }

    setCurrentSessionId(sessionId);
    setMessages([]);
    setCallRecords([]);
    streamingDataHook.resetStream();

    const session = sessions.find(s => s.id === sessionId);
    
    if (session && session.messages && session.messages.length > 0) {
      setMessages(convertToLLMMessages(session.messages));
    } else {
      try {
        // API 返回 SessionMessage[] 格式（统一格式）
        const msgs = await runApi.getSessionMessages(sessionId);
        if (msgs && msgs.length > 0) {
          const restoredMessages = convertToLLMMessages(msgs);
          setMessages(restoredMessages);
          
          // 更新 session 缓存
          setSessions(prev => prev.map(s => 
            s.id === sessionId ? { ...s, messages: msgs } : s
          ));
        }
      } catch (error) {
        console.warn('Failed to load session messages:', error);
      }
    }
  }, [currentSessionId, setCurrentSessionId, setMessages, setCallRecords, streamingDataHook, sessions, setSessions, messages.length]);

  const handleDeleteSession = async (sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation();
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
    console.log('[RunPanel] Resetting session for new project...');

    // 1. 重置 session ID（这会触发 useRunWebSocket 断开旧连接）
    setCurrentSessionId(null);

    // 2. 清空消息列表
    setMessages([]);

    // 3. 清空 sessions 列表
    setSessions([]);

    // 4. 清空调用记录
    setCallRecords([]);
    clearSubagentOutputs();

    // 5. 重置流式数据
    streamingDataHook.resetStream();

    console.log('[RunPanel] Session reset completed');
  }, [
    setCurrentSessionId,
    setMessages,
    setSessions,
    setCallRecords,
    clearSubagentOutputs,
    streamingDataHook
  ]);

  const handleSelectFolder = async () => {
    if (!agenticFlowId) {
      message.warning('请先选择工作流');
      return;
    }
    const result = await openNativeFolderDialog(agenticFlowId);
    if (result?.project_id) {
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
        name: `会话 ${prev.length + 1}`,
        createdAt: new Date().toISOString(),
        messages: [],
      }, ...prev]);
    }

    const userMessage: LLMMessage = {
      id: `msg_${Date.now()}`,
      role: 'user',
      content: inputText,
      timestamp: new Date().toISOString(),
    };

    const assistantMsgId = `msg_${Date.now()}`;
    setCurrentMsgId(assistantMsgId);
    streamingDataHook.setCurrentMsgIdRef(assistantMsgId);
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
              console.log('WebSocket connected, proceeding with message send');
              resolve();
            } else if (Date.now() - startTime > maxWaitTime) {
              console.log('WebSocket connection timeout, falling back');
              resolve();
            } else {
              setTimeout(checkConnection, 100);
            }
          };
          checkConnection();
        });
      }

      if (isConnectedRef.current) {
        await executeFlow(currentCanvasData, inputText, agenticFlowId, sessionId, currentProject?.id);
      }
    } catch (error: any) {
      message.error('发送消息失败: ' + (error.response?.data?.detail || error.message));
      setMessages(prev => prev.filter(m => m.id !== userMessage.id));
    } finally {
      stopRunning();
      setIsWaitingReply(false);
    }
  };

  const handleStopExecution = async () => {
    await stopFlow();
    stopRunning();
    setIsWaitingReply(false);
  };

  const handleFileSelect = async (file: FileInfo) => {
    const isCode = isCodeFile(file.name);
    const isBinary = isBinaryFile(file.name);
    const tabId = `tab_${file.path}`;

    if (isCode) {
      const existingTab = editorTabs.find(t => t.path === file.path);
      if (existingTab) {
        setActiveEditorTabId(existingTab.id);
        openAgenticPanel('editor');
        return;
      }

      openAgenticPanel('editor');
      
      const loadingTab: FileTab = {
        id: tabId,
        name: file.name,
        path: file.path,
        content: '',
        isModified: false,
        isLoading: true,
        isBinary,
        type: 'editor',
      };
      addEditorTab(loadingTab);
      setActiveEditorTabId(tabId);

      try {
        const response = await runProjectApi.readFile(file.path);
        if (response.code === 200) {
          updateEditorTab(tabId, { content: response.data.content, isLoading: false });
        }
      } catch (error) {
        updateEditorTab(tabId, { content: `无法加载文件: ${error}`, isLoading: false });
      }
    } else {
      const existingTab = documentTabs.find(t => t.path === file.path);
      if (existingTab) {
        setActiveDocumentTabId(existingTab.id);
        openAgenticPanel('document');
        return;
      }

      openAgenticPanel('document');
      
      const loadingTab: FileTab = {
        id: tabId,
        name: file.name,
        path: file.path,
        content: '',
        isModified: false,
        isLoading: true,
        isBinary,
        type: 'document',
      };
      addDocumentTab(loadingTab);
      setActiveDocumentTabId(tabId);

      try {
        const response = await runProjectApi.readFile(file.path);
        if (response.code === 200) {
          updateDocumentTab(tabId, { content: response.data.content, isLoading: false });
        }
      } catch (error) {
        updateDocumentTab(tabId, { content: `无法加载文件: ${error}`, isLoading: false });
      }
    }
  };

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
  const dividerStyle: React.CSSProperties = {
    position: 'absolute', top: 0, bottom: 0, width: 6, cursor: 'col-resize', zIndex: 20,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  };
  const dividerLineStyle: React.CSSProperties = {
    width: 2, height: 40, borderRadius: 1,
    background: isDragging !== null ? 'var(--primary-100)' : 'var(--bg-300)',
    transition: isDragging !== null ? 'none' : 'background 0.2s',
  };

  const truncatePath = (path: string, maxLength = 40) => {
    if (path.length <= maxLength) return path;
    const parts = path.split(/[/\\]/);
    return parts.length <= 2 ? '...' + path.slice(-(maxLength - 3)) : '.../' + parts.slice(-2).join('/');
  };

  const formatSmartTime = (dateStr?: string) => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    const now = new Date();
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    if (date.toDateString() === now.toDateString()) return `${hours}:${minutes}`;
    const month = date.getMonth() + 1;
    const day = date.getDate();
    return date.getFullYear() === now.getFullYear() ? `${month}月${day}日 ${hours}:${minutes}` : `${date.getFullYear()}年${month}月${day}日 ${hours}:${minutes}`;
  };

  return (
    <>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      <Layout style={{ height: '100%', background: 'var(--bg-100)' }}>
        <Header style={{ 
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          background: 'linear-gradient(180deg, var(--sidebar-bg) 0%, rgba(15, 23, 42, 0.98) 100%)',
          borderBottom: '1px solid rgba(255, 255, 255, 0.06)', padding: '0 20px', height: '52px', backdropFilter: 'blur(12px)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div onClick={handleGoHome} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', padding: '6px 10px', borderRadius: 8 }}>
              <div style={{ width: 28, height: 28, background: 'linear-gradient(135deg, var(--primary-100) 0%, var(--primary-200) 100%)', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: 12, fontWeight: 700, boxShadow: '0 2px 8px rgba(59, 130, 246, 0.3)' }}>SE</div>
              <div style={{ color: '#fff', fontSize: 15, fontWeight: 600 }}>SoloEngine</div>
            </div>
            <div style={{ width: 1, height: 20, background: 'rgba(255, 255, 255, 0.1)', borderRadius: 1 }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 6, background: 'rgba(255, 255, 255, 0.04)', border: '1px solid rgba(255, 255, 255, 0.06)' }}>
              <LockOutlined style={{ fontSize: 12, color: 'var(--success)' }} />
              <Text style={{ fontSize: 12, color: 'rgba(255, 255, 255, 0.6)' }}>安全沙箱</Text>
            </div>
          </div>
          
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
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
            <div onMouseDown={e => handleMouseDown(e, 0)} style={{ ...dividerStyle, right: -3 }}><div style={dividerLineStyle} /></div>
          </div>

          <div style={{ width: `${(panelRatios[1] / totalRatio) * 100}%`, background: 'var(--bg-100)', display: 'flex', flexDirection: 'column', flexShrink: 0, borderRight: '1px solid var(--bg-300)' }}>
            <div style={{ flex: 1, overflow: 'auto', overflowX: 'hidden', padding: 16, display: 'flex', flexDirection: 'column', background: 'var(--bg-100)', minHeight: 0 }}>
              <MessageList
                messages={messages}
                streamingData={streamingData}
                isWaitingReply={isWaitingReply}
                currentMsgId={currentMsgId}
                currentMsgIdRef={streamingDataHook.currentMsgIdRef}
              />
            </div>
            <MessageInput
              value={inputText}
              onChange={setInputText}
              onSend={handleSendMessage}
              onStop={handleStopExecution}
              isRunning={isRunning || isWaitingReply}
              disabled={!agenticFlowId || !currentProject?.id}
            />
            <div onMouseDown={e => handleMouseDown(e, 1)} style={{ ...dividerStyle, right: -3 }}><div style={dividerLineStyle} /></div>
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
            <div onMouseDown={e => handleMouseDown(e, 2)} style={{ ...dividerStyle, right: -3 }}><div style={dividerLineStyle} /></div>
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
                <FileExplorer onFileSelect={handleFileSelect} onFileEdit={handleFileSelect} onActionsReady={actions => { fileExplorerActionsRef.current = actions; }} />
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

export default RunPanel;
