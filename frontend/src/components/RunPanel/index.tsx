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

import React, { useEffect, useMemo, useState, useRef, useCallback } from 'react';
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

import { useRunPanelStore, generateId, getRunPanelStore, RunPanelStoreContext, setCurrentRunPanelStore } from './stores/runPanelStore';
import type { FileSystemChange } from './types';
import { useStreamingData } from './hooks/useStreamingData';
import { WEBSOCKET_CONFIG } from '../../config/websocket';
import { useRunWebSocket, ExecutionEvent } from '../../hooks/useRunWebSocket';
import { useProjectWatcher } from '../../hooks/useProjectWatcher';
import { runApi } from '../../services/runApi';
import { loadMessages } from './utils/loadMessagesWithFileChanges';
import { buildLLMMessage } from './utils/messageUtils';
import { formatSmartTime } from '../../utils/timezone';
import { agenticFlowApi } from '../../services/agenticFlowApi';
import { runProjectApi, RecentProjectInfo, FileInfo } from '../../services/runProjectApi';

import MessageList, { type MessageListHandle } from './components/MessageList';
import MessageInput from './components/MessageInput';
import QueueBar from './components/QueueBar';
import ScrollNavigationButtons from './components/ScrollNavigationButtons';
import SessionList from './components/SessionList';
import AgenticPanel from './components/AgenticPanel';
import FileExplorer from './FileExplorer';
import type { LLMMessage, Message, DataBlock, FileTab, CallRecord, CallType, SubagentOutput, SystemMessage, TokenTotals } from './types';

const { Header } = Layout;
const { Text } = Typography;

interface RunPanelProps {
  agenticFlowId?: string;
}

/**
 * 终态事件 → (消息状态, 会话状态) 单一映射（路径合并核心）：
 * 暂停（execution_stopped）与正常完成（execution_complete）、执行错误（execution_error）
 * 只差 status 一个点，其余收尾逻辑全部走 finalizeExecution 同一路径。
 * 删除散落的 statusMap / isCancelled 三元等临时映射。
 */
const TERMINAL_MAP = {
  execution_complete: { messageStatus: 'completed', sessionStatus: 'completed' },
  execution_stopped: { messageStatus: 'stopped', sessionStatus: 'cancelled' },
  execution_error: { messageStatus: 'error', sessionStatus: 'error' },
} as const;

type TerminalEvent = keyof typeof TERMINAL_MAP;

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
  const store = useMemo(() => getRunPanelStore(agenticFlowId!), [agenticFlowId]);
  setCurrentRunPanelStore(store);

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
    projectLoading,
    loadCurrentProject,
    loadRecentProjects,
    selectOrCreateProject,
    openNativeFolderDialog,
  } = useRunPanelStore();

  const streamingDataHook = useStreamingData();
  const streamingDataHookRef = useRef(streamingDataHook);
  // 保持streamingDataHookRef最新
  useEffect(() => {
    streamingDataHookRef.current = streamingDataHook;
  }, [streamingDataHook]);

  const isConnectedRef = useRef(false);
  const messageAddedRef = useRef<boolean>(false);
  const executionStartedRef = useRef<boolean>(false);
  const currentMsgIdRef = useRef<string>('');
  // 后端聚合改造（4.4-1）：消息级 token 由后端 agent_usage 聚合（agentUsageMap），
  // rootAgentTokensRef 前端累计已删除（不再前端拼接）。
  const fileExplorerActionsRef = useRef<{ refresh: () => void; applyIncrementalChanges: (changes: FileSystemChange[]) => void; openNewFileDialog: () => void; openNewFolderDialog: () => void; navigateToFile: (path: string) => Promise<void> } | null>(null);
  const isStoppingRef = useRef(false);
  // 轮次级 rootAgentId（路径合并/解耦核心）：本轮执行的消息级归属 agent。
  // 与 useStreamingData 状态机内的 rootAgentIdRef 解耦——后者被 finalizeStream 清空
  //（暂停路径提前 finalize 后 getRootAgentId 返回 null，导致 token_totals 丢失的根因 R2）；
  // 本引用由组件掌控生命周期：execution_start 清空、root agent_start 写入，
  // finalizeExecution 读取（?? getRootAgentId 兜底），finalize 不影响归属。
  const roundRootAgentIdRef = useRef<string | null>(null);
  const safetyTimerRef = useRef<NodeJS.Timeout | null>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const firstChunkTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const messagesLengthRef = useRef(0);
  const lastStreamActivityRef = useRef<number>(0);
  const streamActivityCheckRef = useRef<NodeJS.Timeout | null>(null);

  const flowIdRef = useRef<string | null>(null);
  const projectIdRef = useRef<string | null>(null);

  flowIdRef.current = agenticFlowId || null;
  projectIdRef.current = currentProject?.id || null;

  const saveContextTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const unsub = useRunPanelStore.subscribe(() => {
      if (isResettingRef.current) return;
      const fid = flowIdRef.current;
      const pid = projectIdRef.current;
      if (!fid || !pid) return;
      if (saveContextTimerRef.current) clearTimeout(saveContextTimerRef.current);
      saveContextTimerRef.current = setTimeout(() => {
        useRunPanelStore.getState().saveContext(fid, pid);
      }, 1000);
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
  const [queueMessages, setQueueMessages] = useState<string[]>([]);
  // Plan 模式状态（plan_mode_changed 事件驱动）：RunPanel 顶部徽标显示 计划模式/执行模式
  const [planMode, setPlanMode] = useState<boolean>(false);
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

  const isResettingRef = useRef(false);

  useEffect(() => {
    loadCurrentProject(agenticFlowId);
    if (agenticFlowId) {
      loadRecentProjects(agenticFlowId).then((projects: any) => {
        setRecentProjects(projects || []);
      });
    }
  }, [agenticFlowId, loadCurrentProject, loadRecentProjects, setRecentProjects]);

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

      const store = useRunPanelStore.getState();
      const { currentSessionId: cachedSessionId } = store.loadContext(agenticFlowId, currentProject.id);

      if (initId !== initCounterRef.current) return;

      if (cachedSessionId) {
        const currentSessions = useRunPanelStore.getState().sessions;
        const isValid = currentSessions.some(s => s.id === cachedSessionId);
        if (isValid) {
          setCurrentSessionId(cachedSessionId);
          const { messages: restoredMessages, fileChangesMap } = await loadMessages(cachedSessionId);
          if (initId !== initCounterRef.current) return;
          if (restoredMessages && restoredMessages.length > 0) {
            setMessages(restoredMessages);
            setFileChangesMap(prev => ({ ...prev, ...fileChangesMap }));
          }
        }
      }

      const tabsToLoad = useRunPanelStore.getState().editorTabs.filter(t => t.isLoading);
      const currentFlowId = useRunPanelStore.getState().agenticFlowId;
      for (const tab of tabsToLoad) {
        runProjectApi.readFile(tab.path, 'utf-8', currentFlowId).then(res => {
          if (res.code === 200) {
            useRunPanelStore.getState().updateEditorTab(tab.id, { content: res.data.content, isLoading: false, fileSize: res.data.size });
          }
        }).catch(() => {
          useRunPanelStore.getState().updateEditorTab(tab.id, { content: '加载失败', isLoading: false });
        });
      }
      const docTabsToLoad = useRunPanelStore.getState().documentTabs.filter(t => t.isLoading);
      for (const tab of docTabsToLoad) {
        runProjectApi.readFile(tab.path, 'utf-8', currentFlowId).then(res => {
          if (res.code === 200) {
            useRunPanelStore.getState().updateDocumentTab(tab.id, { content: res.data.content, isLoading: false, fileSize: res.data.size });
          }
        }).catch(() => {
          useRunPanelStore.getState().updateDocumentTab(tab.id, { content: '加载失败', isLoading: false });
        });
      }

      isResettingRef.current = false;
    };

    init();
  }, [agenticFlowId, currentProject?.id, setCurrentSessionId, setMessages, setFileChangesMap]);

  const createLLMMessage = useCallback((options: {
    finalData: DataBlock[];
    messageStatus: 'completed' | 'stopped' | 'error' | 'compacted';
    totalTokens?: number;
    agentId?: string;
    agentName?: string;
    tokenHistory?: any[];
    tokenTotals?: TokenTotals;
  }): LLMMessage => {
    const { finalData, messageStatus, totalTokens, agentId, agentName, tokenHistory, tokenTotals } = options;
    const msgId = currentMsgIdRef.current || `msg_${Date.now()}`;
    // 未显式传入时从 blocks 推断：流式路径 blocks 均带 WS 透传的 agent_id/agent_name，
    // 保证消息级 agent 信息与回显路径一致（extractAgentName 依赖 msg.agent_id/agent_name）
    const inferredAgentId = agentId || finalData.find(b => b.agent_id)?.agent_id;
    const inferredAgentName = agentName || finalData.find(b => b.agent_name)?.agent_name;
    // 去重（t6）：流式 commit 与回显 convertToMessages 共用统一构造器 buildLLMMessage
    return buildLLMMessage({
      id: msgId,
      content: '',
      data: finalData,
      timestamp: new Date().toISOString(),
      status: messageStatus,
      // 后端聚合改造（4.4-8）：token_totals 透传后端 agent_usage 聚合 5 字段
      //（agentUsageMap[rootAgentId].totals），使流式 commit 消息头 hover 与回显
      //（loadMessagesWithFileChanges token_totals: msg.token_usage）完全一致。
      token_totals: tokenTotals,
      // 统一修复：流式 commit 注入消息级 token_usage_history（= mainagent 全部阶段块 history
      // 去重拼接，与回显 loadMessagesWithFileChanges allHistory 合并同构），
      // 使消息头 TokenBadge hover 详情与回显完全一致。
      token_usage_history: tokenHistory,
      tokens: totalTokens,
      agent_id: inferredAgentId,
      agent_name: inferredAgentName,
    });
  }, []);

  const createSystemMessage = useCallback((
    errorMessage: string,
  ): SystemMessage => {
    return {
      id: `msg_error_${Date.now()}`,
      role: 'error',
      error: errorMessage,
      timestamp: new Date().toISOString(),
    };
  }, []);

  /**
   * 统一消息提交 - 唯一入口
   * 与历史回显同构：有LLM创建LLM块，有error创建SystemMessage块
   * hasLLM 必填，不允许默认值（防止"忘算 hasLLM"导致兜底 push LLMMessage）
   *
   * 〇·6 解耦修复：全部参数改为命名 options 对象——此前 11 个位置参数导致
   * handleStopExecution 调用时把第 7 位（isCompaction）误写为 true（意图是 force），
   * 造成暂停消息被渲染为「上下文已压缩」气泡、流式内容被折叠隐藏的 bug。
   * 压缩标记 isCompaction 与提交控制完全解耦，杜绝位置错位。
   * 路径合并剪枝：force（恒 false）与 commit 路径 isCompaction（恒 false）已删除——
   * 防重复提交由 messageAddedRef 单一守卫承担，暂停/完成/错误全部走 finalizeExecution。
   */
  const commitExecutionMessages = useCallback((options: {
    assistantBlocks: DataBlock[];
    messageStatus: 'completed' | 'stopped' | 'error' | 'compacted';
    hasLLM: boolean;
    errorMessage?: string;
    totalTokens?: number;
    agentId?: string;
    agentName?: string;
    tokenHistory?: any[];
    tokenTotals?: TokenTotals;
  }) => {
    const { assistantBlocks, messageStatus, hasLLM, errorMessage, totalTokens, agentId, agentName, tokenHistory, tokenTotals } = options;
    if (messageAddedRef.current) return;
    const newMessages: Message[] = [];

    // 有 LLM → 创建 LLMMessage
    if (hasLLM) {
      newMessages.push(createLLMMessage({ finalData: assistantBlocks, messageStatus, totalTokens, agentId, agentName, tokenHistory, tokenTotals }));
    }

    // 有 error → 创建 SystemMessage
    if (errorMessage) {
      newMessages.push(createSystemMessage(errorMessage));
    }

    if (newMessages.length > 0) {
      setMessages(prev => [...prev, ...newMessages]);
      messageAddedRef.current = true;
    }
  }, [setMessages, createLLMMessage, createSystemMessage]);

  /**
   * 统一执行终态收尾（路径合并核心，替代原 handleExecutionEnd）：
   * 正常完成（execution_complete）/ 用户暂停（execution_stopped）/ 执行错误
   * （execution_error）/ 重连终态 / 暂停 3s 兜底，全部只走本函数。
   * 暂停与完成唯一区别 = TERMINAL_MAP 中的 status 字符串，其余完全一致。
   *
   * 关键修复（R1/R2/R4）：
   * - 消息归属用轮次级 roundRootAgentIdRef（独立于流式状态机，finalizeStream 清空
   *   rootAgentIdRef 不影响归属）——暂停路径提前 finalize 后 token 不再丢失；
   * - commit 必传 totalTokens/tokenTotals/tokenHistory；
   * - token 更新仅在"新值可用"时覆盖，不把 undefined 写回已设好的值。
   */
  const finalizeExecution = useCallback(({
    terminal,
    tokenData,
    errorMessage,
  }: {
    terminal: TerminalEvent;
    tokenData: any;
    errorMessage?: string;
  }) => {
    setIsWaitingReply(false);

    // 清除安全计时器，防止安全计时器在真实事件处理完成后再次触发
    if (safetyTimerRef.current) {
      clearTimeout(safetyTimerRef.current);
      safetyTimerRef.current = null;
    }

    const streamingHook = streamingDataHookRef.current;
    // 消息级 agent 归属 = 轮次级 rootAgentId（roundRootAgentIdRef，组件职责）；
    // getRootAgentId 仅作无 agent_start 事件时的兜底。
    const rootAgentId = roundRootAgentIdRef.current ?? streamingHook.getRootAgentId();
    const finalData = streamingHook.finalizeStream();
    // 后端聚合改造（4.4-6）：消息级 token_usage_history / total 由后端 agent_usage 聚合
    //（agentUsageMap，agent_token_usage 推送 / agent_complete metadata.agent_usage 写入），
    // 前端不再 mergeTokenHistories(finalData.filter(agent_level===0)) 拼接。
    // 读取不到（重连/终态等无流式事件场景）时走回显路径（loadMessages 已在初始化调用）。
    const agentUsageMap = useRunPanelStore.getState().agentUsageMap;
    const rootUsage = rootAgentId ? agentUsageMap[rootAgentId] : undefined;
    const tokenHistory = rootUsage?.history || [];
    // B8 修复：优先用 mainagent（root）级 tokens（agent_complete agent_usage 累计，
    // 与回显 token_usage_history 求和同构）；tokenData（终态事件携带的会话级聚合）
    // 仅用于 agentUsageMap 为空的无流式事件兜底路径。
    const totalTokens =
      rootUsage?.tokens ??
      (tokenData?.total_tokens ||
        (tokenData?.prompt_tokens && tokenData?.completion_tokens
          ? tokenData.prompt_tokens + tokenData.completion_tokens
          : undefined));
    // R3：终态事件 token_totals（后端 5 字段视图）作为 agent 级数据缺失时的兜底
    const tokenTotals = rootUsage?.totals ?? tokenData?.token_totals;

    // 步骤1：消息创建（统一入口，messageAddedRef 单一守卫防重复提交）
    if (!messageAddedRef.current) {
      // 有LLM = 有数据 或 execution_start已收到
      const hasLLM = finalData.length > 0 || executionStartedRef.current;
      commitExecutionMessages({
        assistantBlocks: finalData,
        messageStatus: TERMINAL_MAP[terminal].messageStatus,
        hasLLM,
        errorMessage,
        totalTokens,
        tokenTotals,
        agentId: rootAgentId || undefined,
        tokenHistory,
      });
    }

    // 步骤2：Token 更新（有 tokenData 时始终执行，与正常/停止路径无关）
    if (currentSessionId) {
      setMessages(prev => {
        const lastAssistantIdx = prev.reduce((lastIdx, msg, idx) => {
          if (msg.role === 'assistant') {
            return idx;
          }
          return lastIdx;
        }, -1);
        if (lastAssistantIdx === -1) return prev;
        return prev.map((m, idx) => {
          if (idx !== lastAssistantIdx) return m;
          // B8 修复：totalTokens 为空时禁止覆盖消息 tokens——重复终态事件场景下，
          // 第二次 finalizeExecution 时若 rootUsage 取不到 → totalTokens=null，若直接
          // 写入会把首次已正确写入的消息头 token 清空（流式 mainagent 消息头 token 丢失根因）。
          // R4 修复：token_totals/token_usage_history 同样仅在新值可用时覆盖。
          return {
            ...m,
            ...(totalTokens != null ? { tokens: totalTokens } : {}),
            ...(tokenTotals != null ? { token_totals: tokenTotals } : {}),
            ...(tokenHistory.length > 0 ? { token_usage_history: tokenHistory } : {}),
          };
        });
      });

      setSessions(sessionsState => {
        const updated = sessionsState.map(s => {
          if (s.id !== currentSessionId) return s;
          const contentBlock = finalData.find((b: DataBlock) => b.type === 'content' && b.content);
          const firstAssistantContent = contentBlock?.content?.substring(0, 50) || undefined;
          const updatedSession: any = {
            ...s,
            status: TERMINAL_MAP[terminal].sessionStatus,
            firstAssistantContent: s.firstAssistantContent || firstAssistantContent,
            // fix-session-token 修复后 tokenData 是终态事件携带的**会话级完整聚合值**
            //（后端从全部消息 token_usage_history 聚合，含本次执行，字段全量），直接覆盖 session
            // token_usage。旧 accumulateTokenUsage 累加会把完整聚合值叠加到已有值上（双重计数，
            // 如 437.3k+444.5k=881.9k）。透传完整对象保留 system/user/assistant 各字段。
            token_usage: tokenData ? { ...tokenData } : s.token_usage,
            updated_at: new Date().toISOString(),
          };
          // 同步更新 session 内嵌 messages 的最后一条 assistant 消息的 tokens
          if (s.messages && s.messages.length > 0) {
            const lastMsgIdx = s.messages.reduce((lastIdx: number, msg: any, idx: number) => {
              if (msg.role === 'assistant') return idx;
              return lastIdx;
            }, -1);
            if (lastMsgIdx >= 0) {
              updatedSession.messages = s.messages.map((msg: any, idx: number) =>
                idx === lastMsgIdx
                  ? { ...msg, tokens: totalTokens }
                  : msg
              );
            }
          }
          return updatedSession;
        });
        updated.sort((a: any, b: any) =>
          new Date(b.updated_at || b.createdAt || '').getTime() - new Date(a.updated_at || a.createdAt || '').getTime()
        );
        return updated;
      });
    }

    stopRunning();
    clearTimeouts();
  }, [setIsWaitingReply, setMessages, setSessions, stopRunning, currentSessionId, clearTimeouts, commitExecutionMessages]);

  const handleExecutionEvent = useCallback((event: ExecutionEvent) => {
    const streamingHook = streamingDataHookRef.current;

    // 显式工具→面板映射（替代原 includes 模糊匹配，修复 RunCommand 等匹配不到的 bug）。
    // 联动方式（对齐「工具独立 + 事件关联」）：工具层零前端逻辑，react_core 统一发出
    // tool_call 事件（含完整 args），前端捕获后在此展示对应 agentic 操作区内容——
    // read/write 等文件工具经 handleFileClickByPath 打开对应文件（isCode 自动选择
    // 编辑器/文档面板），RunCommand 等命令工具切换到终端面板。
    const openPanelForTool = (toolName: string, toolArgs?: Record<string, any>) => {
      const name = (toolName || '').toLowerCase();
      // 打开对应文件：复用现有 handleFileClickByPath → handleFileSelect → openOrNavigateFile
      // 路径（打开 tab + 读取内容填充），不新建任何文件打开逻辑。
      const openLinkedFile = (argPath?: unknown) => {
        // 兼容 DeleteFile 等数组参数（file_paths）与单路径参数（file_path/path）
        const p = Array.isArray(argPath) ? argPath[0] : argPath;
        if (typeof p !== 'string' || !p.trim()) return;
        handleFileClickByPathRef.current?.(p.trim());
      };
      // 删除类联动：文件已被删除，无面板展示对象——不打开任何面板；
      // 若该文件 tab 已在编辑器/文档面板中打开，则关闭对应 tab（联动方向与"打开"相反）。
      const closeDeletedFileTabs = (filePath: string) => {
        const normalizedPath = filePath.replace(/\\/g, '/');
        const tabId = `tab_${normalizedPath}`;
        const store = useRunPanelStore.getState();
        if (store.editorTabs.some(t => t.id === tabId)) store.closeEditorTabs([tabId]);
        if (store.documentTabs.some(t => t.id === tabId)) store.closeDocumentTabs([tabId]);
      };
      if (['runcommand', 'stopcommand', 'checkcommandstatus', 'getdiagnostics'].includes(name)) {
        openAgenticPanel('terminal');
      } else if (['write', 'searchreplace', 'write_file', 'search_replace', 'create_file', 'edit_file'].includes(name)) {
        // 写入类：编辑器面板 + 对应文件（write 联动：显示编辑器 + 对应文件）
        openAgenticPanel('editor');
        openLinkedFile(toolArgs?.file_path ?? toolArgs?.file_paths ?? toolArgs?.path);
      } else if (name === 'deletefile' || name === 'delete_file') {
        // 删除类：文件已消失，不打开面板；已打开的对应 tab 关闭（见 closeDeletedFileTabs）
        const p = Array.isArray(toolArgs?.file_paths)
          ? toolArgs.file_paths[0]
          : (toolArgs?.file_path ?? toolArgs?.path);
        if (typeof p === 'string' && p.trim()) closeDeletedFileTabs(p.trim());
      } else if (['read', 'read_file'].includes(name)) {
        // 读取类：handleFileClickByPath 按 isCode 自动打开对应面板（代码文件→编辑器）
        // 与对应文件；参数缺失（stream 开始块，arguments 为流式增量）时兜底切文档面板，
        // 保证"调用 read 时 agentic 操作区立即展示对应面板"（文件由 tool_call 事件打开）。
        if (toolArgs?.file_path) {
          openLinkedFile(toolArgs.file_path);
        } else {
          openAgenticPanel('document');
        }
      } else if (name === 'ls') {
        // 目录浏览类：结果含文件路径列表，弱联动文档面板
        openAgenticPanel('document');
      } else if (['openpreview', 'browser_navigate', 'navigate', 'open_browser'].includes(name) || name.includes('preview')) {
        // OpenPreview：携带 preview_url 使浏览器面板导航到预览地址（browserUrl + 导航信号）
        openAgenticPanel('browser', toolArgs?.preview_url ?? toolArgs?.url);
      }
    };

    switch (event.event_type) {
      case 'execution_start': {
        // 生成新的 assistant message id，避免队列 drain 场景下复用上一次 id 导致 React key 冲突
        const newAssistantMsgId = `msg_asst_${Date.now()}`;
        setCurrentMsgId(newAssistantMsgId);
        currentMsgIdRef.current = newAssistantMsgId;
        streamingDataHookRef.current.setCurrentMsgIdRef(newAssistantMsgId);

        // 新一轮开始：清空轮次级归属（由 root agent_start 事件重新写入）
        roundRootAgentIdRef.current = null;
        setCallRecords([]);
        clearSubagentOutputs();
        streamingHook.resetStream();
        messageAddedRef.current = false;
        executionStartedRef.current = true;
        // 后端聚合改造（4.4-8）：执行开始清空 agent 级 token 状态（与 stream 重置同步）
        useRunPanelStore.getState().clearAgentUsage();
        startRunning();
        setIsWaitingReply(true);
        break;
      }

      case 'agent_start': {
        // 层级信息：parent_agent_id 为空 = mainagent（root），非空 = subagent。
        // 用 agent_start 事件驱动 agent 栈（enterRootAgent/enterSubAgent），
        // 不依赖「第一个 WS 块 = root」的流式顺序推断（mainagent 无流式输出时 subagent 不再误判为 root）
        // execution_key（〇·3）：栈元素为 executionKey（并发实例独立层级/出栈）
        const startParentAgentId = (event as any).metadata?.parent_agent_id;
        const startAgentId = (event as any).agent_id;
        const startExecutionKey = (event as any).metadata?.execution_key;
        if (startAgentId && startExecutionKey) {
          if (startParentAgentId) {
            streamingHook.enterSubAgent(startAgentId, (event as any).agent_name, startExecutionKey);
          } else {
            // root（mainagent）：同时记录轮次级归属（finalizeExecution 读取，
            // 与流式状态机解耦——finalizeStream 清空 rootAgentIdRef 不影响此归属）
            roundRootAgentIdRef.current = startAgentId;
            streamingHook.enterRootAgent(startAgentId, startExecutionKey);
          }
        }
        break;
      }

      case 'agent_complete': {
        const completeTokens = (event as any).metadata?.tokens || (event as any).tokens;
        const completeAgentId = (event as any).agent_id;
        const completeAgentName = (event as any).agent_name;
        const parentAgentId = (event as any).metadata?.parent_agent_id;
        const isCompactionRound = (event as any).metadata?.compaction_round === true;
        const completeExecutionKey = (event as any).metadata?.execution_key;
        const completeAgentUsage = (event as any).metadata?.agent_usage;
        // 压缩轮次与正常轮次完全相同：不打断流式、不 commit 独立消息（移除原 finalizeStream+commit），
        // 所有块持续累积，最终由 execution_complete / 用户 stop 统一 commit。
        // 此处仅将 token 注入流式块（供压缩气泡/组级 token 显示），与回显（后端注入）同构。
        if (completeTokens?.total_tokens && completeAgentId) {
          // 统一注入路径：agent_complete 的 tokens 与 agent_token_usage 同源
          //（后端 _accumulated_usage 快照，均携带 usage_phase），复用 updateAgentTokens
          // 完成块级 token 注入（含压缩轮 stop 拦截阶段——该阶段无迭代推送，仅由此补写，
          // 值含 intercepted_entry 与回显一致；不再需要独立的 injectAgentTokens）。
          // 后端聚合改造（4.4-3）：metadata.agent_usage（agent 级整轮）同步写入
          // agentUsageMap（消息头/组头整轮显示）；execution_key 用于块级 token 匹配。
          streamingHook.updateAgentTokens(completeAgentId, completeTokens, completeAgentUsage, completeExecutionKey);
          // B8 修复删除：mainagent 消息级 token 不再前端累计（rootAgentTokensRef 已删），
          // 由 agentUsageMap[rootAgentId] 提供整轮聚合（4.4-1/4.4-6）。
        }
        // subagent 完成（非压缩轮、status=completed、有 parent_agent_id）：pop 回父级层级
        // （〇·3：栈元素为 executionKey，按此出栈）
        if (!isCompactionRound && (event as any).status === 'completed' && parentAgentId && completeExecutionKey) {
          streamingHook.exitAgent(completeExecutionKey);
        }
        break;
      }

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
        
        // 工具执行完成事件：更新调用记录 + 打开对应面板（显式映射，时序兜底）
        // tool_args 为完整参数（flow_compiler 转发 call.args），文件类工具据此打开对应文件
        openPanelForTool(event.tool_name || '', event.tool_args);
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
          // 问题 1 修复：实时 token 更新事件（后端每次 LLM 迭代结束推送）。
          // 非消息块，仅更新该 agent 的流式 token 详情，不进入内容渲染路径。
          // 后端聚合改造（4.4-4）：delta.agent_usage（agent 级整轮）同步写 agentUsageMap；
          // delta.execution_key 用于块级 token 匹配（并发实例独立）。
          if ((delta as any).type === 'agent_token_usage' && (delta as any).usage) {
            streamingHook.updateAgentTokens(
              (event as any).agent_id,
              (delta as any).usage,
              (delta as any).agent_usage,
              (event as any).execution_key,
            );
            lastStreamActivityRef.current = Date.now();
            break;
          }
          // 面板联动（tool_calls_start）：工具调用开始时（stream 块 type=tool_calls 且 status=start）
          // 即打开对应面板——时序正确（区别于 tool_call 完成事件，避免"工具执行完才打开面板"的滞后）
          if ((delta as any).type === 'tool_calls' && Array.isArray((delta as any).tool_calls)) {
            const startedCall = (delta as any).tool_calls.find((tc: any) => tc && (tc.status === 'start' || tc.status === undefined));
            if (startedCall) {
              const fnName = startedCall?.function?.name || '';
              if (fnName) {
                openPanelForTool(fnName);
              }
            }
          }
          const hasContent = (delta as any).reasoning_content !== undefined && (delta as any).reasoning_content !== null
            || (delta as any).tool_calls !== undefined && (delta as any).tool_calls !== null
            || (delta as any).content !== undefined && (delta as any).content !== null
            || (delta as any).text !== undefined && (delta as any).text !== null;
          const hasLegacyContent = event.content !== undefined && event.content_type !== undefined;
          if (hasContent) {
            // 〇·3（4.4-5）：stream 块归属 execution_key（从 WS 消息 execution_key 读），
            // 注入块级 execution_key（并发栈/块级 token 匹配依据）
            streamingHook.processStreamChunk(delta, (event as any).agent_id, (event as any).agent_name, (event as any).execution_key);
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

        // 路径合并：正常完成与暂停/错误共用 finalizeExecution
        finalizeExecution({ terminal: 'execution_complete', tokenData });
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
                        content: (m as LLMMessage).content || '',
                        reasoning_content: (m as LLMMessage).reasoning_content,
                        data: (m as LLMMessage).data || [],
                        message_index: i,
                        timestamp: m.timestamp,
                        created_at: m.timestamp,
                        tokens: (m as LLMMessage).tokens,
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
        // 路径合并：用户暂停与正常完成共用 finalizeExecution，仅 status 不同
        finalizeExecution({ terminal: 'execution_stopped', tokenData });
        break;
      }

      case 'message_queued': {
        const queuedContent = (event as any).content || '';
        setQueueMessages(prev => [...prev, queuedContent]);
        break;
      }

      // 工具交互回答已被工具消费：从"排队消息"显示中移除该回答
      case 'interaction_answer_received': {
        const consumedContent = (event as any).content || '';
        setQueueMessages(prev => prev.filter(m => m !== consumedContent));
        break;
      }

      // Plan 模式状态变更（EnterPlanMode/ExitPlanMode 推送）：更新 RunPanel 顶部徽标
      case 'plan_mode_changed': {
        setPlanMode((event as any).plan_mode === true);
        break;
      }

      case 'queue_drained': {
        const drainedContent = (event as any).content || '';
        setQueueMessages([]);
        // 添加 user message 到消息列表
        const userMsg: LLMMessage = {
          id: `msg_user_${Date.now()}`,
          role: 'user',
          content: drainedContent,
          timestamp: new Date().toISOString(),
          status: 'completed',
        };
        setMessages(prev => [...prev, userMsg]);
        break;
      }

      case 'queue_returned': {
        setQueueMessages([]);
        setInputText((event as any).messages?.join('\n') || '');
        break;
      }

      // 执行错误（execution_cancelled 已剪枝：后端无生产者，删除该分支与 isCancelled 三元）
      case 'agent_error':
      case 'execution_error': {
        const tokenData = event.tokens || event.data?.tokens || event.data?.token_usage || null;
        finalizeExecution({ terminal: 'execution_error', tokenData, errorMessage: event.error || '执行失败' });
        message.error(event.error || '执行失败');
        break;
      }
    }
  }, [startRunning, stopRunning, setIsWaitingReply, setCallRecords, openAgenticPanel, setMessages, clearSubagentOutputs, setSubagentOutputs, currentSessionId, incrementFileChangeRefreshKey, clearTimeouts, finalizeExecution]);

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

  const { isConnected, executeFlow, stopFlow, send } = useRunWebSocket({
    agenticFlowId: agenticFlowId || null,
    sessionId: currentSessionId,
    runProjectId: currentProject?.id || null,
    onMessage: handleWebSocketMessage,
    onEvent: handleExecutionEvent,
    onError: handleWebSocketError,
    autoReconnect: true,
  });

  // 终端激活状态上报：前端持有"用户正在查看哪个终端"，经 WS 通知后端 run_context，
  // RunCommand 据此选择命令执行的 PTY 终端（前端与工具联动独立，工具不感知前端）
  const handleActiveTerminalChange = useCallback(
    (terminalId: string) => {
      send('terminal_attach', { terminal_id: terminalId || undefined });
    },
    [send],
  );

  useProjectWatcher(currentProject?.id || null, useCallback((changes: FileSystemChange[]) => {
    fileExplorerActionsRef.current?.applyIncrementalChanges(changes);
    handleExternalFileChanges(changes);
  }, [handleExternalFileChanges]));

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
        // 路径合并：重连终态与正常完成/暂停/错误共用 finalizeExecution
        //（stopRunning / setIsWaitingReply / clearTimeouts 均在 finalizeExecution 内完成）
        const terminalMap: Record<string, TerminalEvent> = {
          completed: 'execution_complete',
          failed: 'execution_error',
          stop: 'execution_stopped',
        };
        const terminal = terminalMap[sessionStatus] || 'execution_complete';
        const errorMessage = sessionStatus === 'failed' ? (sessionData?.error || '执行失败') : undefined;
        finalizeExecution({ terminal, tokenData: sessionData?.token_usage ?? null, errorMessage });

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
  }, [stopRunning, setIsWaitingReply, setMessages, setFileChangesMap, incrementFileChangeRefreshKey, clearTimeouts, finalizeExecution]);

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

    useRunPanelStore.getState().reset('session');
    streamingDataHookRef.current.resetStream();
    setCurrentSessionId(sessionId);

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
  }, [currentSessionId, setCurrentSessionId, setMessages, sessions, setSessions, setFileChangesMap]);

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

  const handleSelectFolder = useCallback(async () => {
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

      if (currentProject?.id && agenticFlowId) {
        if (saveContextTimerRef.current) { clearTimeout(saveContextTimerRef.current); saveContextTimerRef.current = null; }
        isResettingRef.current = true;
        useRunPanelStore.getState().saveContext(agenticFlowId, currentProject.id);
      }
      setCurrentProject({
        id: result.project_id,
        name: result.project_name,
        folder_path: result.folder_path,
      });
      useRunPanelStore.getState().reset('project');
      streamingDataHookRef.current.resetStream();

      await loadSessionsForProject(result.project_id);
    }
  }, [agenticFlowId, currentProject?.id, openNativeFolderDialog, setCurrentProject, loadSessionsForProject]);

  const handleSelectFromRecent = useCallback(async (project: RecentProjectInfo) => {
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

        if (currentProject?.id && agenticFlowId) {
          if (saveContextTimerRef.current) { clearTimeout(saveContextTimerRef.current); saveContextTimerRef.current = null; }
          isResettingRef.current = true;
          useRunPanelStore.getState().saveContext(agenticFlowId, currentProject.id);
        }
        setCurrentProject({
          id: result.project_id,
          name: result.project_name,
          folder_path: result.folder_path,
        });
        useRunPanelStore.getState().reset('project');
        streamingDataHookRef.current.resetStream();

        await loadSessionsForProject(result.project_id);
      }
    } finally {
      setSwitchingProjectId(null);
    }
  }, [agenticFlowId, currentProject?.id, selectOrCreateProject, setCurrentProject, loadSessionsForProject]);

  const handleSendMessage = async () => {
    if (!inputText.trim()) return;
    if (!agenticFlowId || !currentProject?.id) {
      message.error('请先选择项目和流程');
      return;
    }

    // 运行状态检查：LLM 运行时，消息入队（发送到后端，由后端 run.py 消息队列管理机制管理）
    if (isRunning || isWaitingReply) {
      const currentInputText = inputText;
      setInputText('');
      if (isConnectedRef.current) {
        await executeFlow(canvasData, currentInputText, agenticFlowId, currentSessionId || undefined, currentProject?.id);
      } else {
        message.warning('WebSocket 未连接，无法加入队列');
      }
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
    executionStartedRef.current = false;
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
            data: { name: 'Assistant', system_prompt: 'You are a helpful assistant.', tools: [] },
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
        // HITL 交互挂起判断：消息/流式数据中存在未完成（无 result）的 tool_calls 块。
        // AskUserQuestion / ExitPlanMode / RunCommand 审批 / DeleteFile 等待用户回答期间，
        // 后端不产生流式事件，且助手消息在交互完成前未 finalize 到 messages（交互卡片渲染自
        // streamingData），因此必须同时检查 messages + streamingData；firstChunkTimeout /
        // streamActivityCheck 的"超时自动停止"在交互挂起时豁免，否则用户未及时回答执行即被误取消。
        const hasPendingHITLInteraction = (): boolean => {
          const st = useRunPanelStore.getState();
          const allBlocks: any[] = [
            ...((st.messages || []).flatMap((m: any) => (m.data || [])) as any[]),
            ...(st.streamingData || []),
          ];
          return allBlocks.some((b: any) =>
            b.type === 'tool_calls' && Array.isArray(b.tool_calls) && b.tool_calls.some((tc: any) => !tc.result)
          );
        };

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
          // HITL 交互挂起时模型在等用户回答，无 chunk 属正常，不判"等待响应超时"
          if (currentIsWaiting && !hasPendingHITLInteraction()) {
            message.error('等待响应超时，请检查后端服务是否正常');
            stopFlow();
            stopRunning();
          }
        }, WEBSOCKET_CONFIG.RESPONSE_TIMEOUT * 1000);

        lastStreamActivityRef.current = Date.now();
        streamActivityCheckRef.current = setInterval(() => {
          const { isRunning: checkRunning } = useRunPanelStore.getState();
          // 交互等待期间后端无流式事件，不得触发"无活动自动停止"（否则用户 60s 内未回答即被取消）。
          // 普通工具执行中也有流式事件刷新 lastStreamActivityRef，不会误伤 60s 判定。
          if (checkRunning && !hasPendingHITLInteraction() && lastStreamActivityRef.current > 0) {
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

  // 工具交互回答：AskUserQuestion / ExitPlanMode 等待用户回答时，
  // 交互面板点击选项/批准后调用。复用执行通道（executeFlow → WS execute），
  // 后端在执行任务未完成时将回答消息入队，工具 await 消息队列拿到回答。
  const handleUserAnswer = useCallback(async (text: string) => {
    if (!text.trim()) return;
    if (!agenticFlowId || !currentProject?.id) {
      message.warning('请先选择项目和流程');
      return;
    }
    if (isConnectedRef.current) {
      await executeFlow(canvasData, text, agenticFlowId, currentSessionId || undefined, currentProject?.id);
    } else {
      message.warning('WebSocket 未连接，无法发送回答');
    }
  }, [agenticFlowId, currentProject?.id, canvasData, currentSessionId, executeFlow]);

  // 注入工具交互回答发送器（供 ToolCallsBlock 交互面板调用）
  useEffect(() => {
    useRunPanelStore.setState({ userAnswerSender: handleUserAnswer });
    return () => {
      useRunPanelStore.setState({ userAnswerSender: null });
    };
  }, [handleUserAnswer]);

  // 路径合并：暂停不再"提前 finalize + 独立 commit"（这是 R1/R2 根因——commit 缺 token、
  // finalize 清空归属导致 token_totals 丢失）。
  // 现在只做两件事：① 立即停止"正在思考"（纯 UI）；② 通知后端 stopFlow。
  // 收尾（finalize + commit + token）统一由 finalizeExecution 承担：
  // - execution_stopped 事件到达 → handleExecutionEvent → finalizeExecution（权威路径）
  // - 3s 内事件未到（后端慢/断连）→ safetyTimer → 同一 finalizeExecution（幂等，messageAddedRef 防重）
  const handleStopExecution = useCallback(async () => {
    if (isStoppingRef.current) return;
    isStoppingRef.current = true;

    // 立即停止 UI（隐藏"正在思考"、按钮立即恢复为发送按钮）
    setIsWaitingReply(false);
    setCallRecords([]);

    // 3s safetyTimer 兜底（后端迟迟未确认/断连时本地同一路径收尾；finalizeExecution 幂等防重）
    safetyTimerRef.current = setTimeout(() => {
      finalizeExecution({ terminal: 'execution_stopped', tokenData: null });
    }, 3000);

    try {
      const sent = await stopFlow();
      if (!sent) {
        finalizeExecution({ terminal: 'execution_stopped', tokenData: null });
      }
    } catch {
      finalizeExecution({ terminal: 'execution_stopped', tokenData: null });
    } finally {
      setTimeout(() => {
        isStoppingRef.current = false;
      }, 500);
    }
  }, [setIsWaitingReply, setCallRecords, finalizeExecution, stopFlow]);

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
      const response = await runProjectApi.readFile(resolvedPath, 'utf-8', agenticFlowId);
      if (response.code === 200) {
        if (isCode) {
          updateEditorTab(result.tab.id, { content: response.data.content, isLoading: false, fileSize: response.data.size });
        } else {
          updateDocumentTab(result.tab.id, { content: response.data.content, isLoading: false, fileSize: response.data.size });
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

  // 最新 handleFileClickByPath 引用（工具联动打开文件用）：handleExecutionEvent 为 useCallback，
  // 经 ref 取最新渲染闭包（currentProject 等依赖不随事件回调过期）。
  const handleFileClickByPathRef = useRef<(filePath: string) => void>(() => {});
  const handleFileClickByPath = (filePath: string) => {
    const name = filePath.split(/[\\/]/).pop() || filePath;
    const projectFolder = currentProject?.folder_path;
    const resolvedPath = resolveFilePath(filePath, projectFolder);
    handleFileSelect({ name, path: resolvedPath, is_dir: false, size: 0, modified: new Date().toISOString() });
  };
  handleFileClickByPathRef.current = handleFileClickByPath;

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
    useRunPanelStore.getState().setTabContent(tabId, content);
  };

  const handleDocumentContentChange = (tabId: string, content: string) => {
    useRunPanelStore.getState().setTabContent(tabId, content);
  };

  const handleAutoSave = async (tab: FileTab) => {
    if (!tab.isModified || tab.isBinary) return;
    try {
      const content = useRunPanelStore.getState().getTabContent(tab.id);
      await runProjectApi.writeFile(tab.path, content, 'utf-8', 'write', agenticFlowId);
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

  const projectMenuItems: MenuProps['items'] = useMemo(() => [
    { key: 'select', label: <><FolderOutlined style={{ marginRight: 8 }} />选择项目</>, onClick: handleSelectFolder },
    { key: 'recent', label: <><HistoryOutlined style={{ marginRight: 8 }} />历史项目</>, onClick: () => setRecentModalVisible(true) },
  ], [handleSelectFolder]);

  const totalRatio = panelRatios.reduce((a, b) => a + b, 0);

  const truncatePath = (path: string, maxLength = 40) => {
    if (path.length <= maxLength) return path;
    const parts = path.split(/[/\\]/);
    return parts.length <= 2 ? '...' + path.slice(-(maxLength - 3)) : '.../' + parts.slice(-2).join('/');
  };

  return (
    <RunPanelStoreContext.Provider value={store}>
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
            {/* Plan 模式状态徽标：plan_mode_changed 事件驱动（计划模式=紫色 / 执行模式=默认） */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 6, background: planMode ? 'rgba(168, 85, 247, 0.15)' : 'rgba(255, 255, 255, 0.04)', border: '1px solid rgba(255, 255, 255, 0.06)' }}>
              <Tag color={planMode ? 'purple' : 'default'} style={{ marginRight: 0, fontSize: 12, lineHeight: '18px' }}>
                {planMode ? '计划模式' : '执行模式'}
              </Tag>
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
            {queueMessages.length > 0 && (
              <QueueBar messages={queueMessages} onRemove={(index) => {
                send('queue_remove', { index });
                setQueueMessages(prev => prev.filter((_, i) => i !== index));
              }} />
            )}
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
              onActiveTerminalChange={handleActiveTerminalChange}
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
    </RunPanelStoreContext.Provider>
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
