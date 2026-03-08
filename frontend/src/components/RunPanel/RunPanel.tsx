import React, { useEffect, useState, useRef, useCallback } from 'react';
import { Layout, Button, Typography, message, Input, Spin, List, Tag, Modal, Tooltip, Dropdown, Empty } from 'antd';
import {
  RobotOutlined,
  SendOutlined,
  ClearOutlined,
  FolderOutlined,
  FolderOpenOutlined,
  HistoryOutlined,
  CheckOutlined,
  CodeOutlined,
  GlobalOutlined,
  FileTextOutlined,
  EditOutlined,
  DesktopOutlined,
  FileOutlined,
  PlusOutlined,
  LockOutlined,
} from '@ant-design/icons';
import type { MenuProps } from 'antd';
import { useRunStore } from '../../store/runStore';
import { useRunProjectStore } from '../../store/runProjectStore';
import { agentToolsApi } from '../../services/agentToolsApi';
import { runApi } from '../../services/runApi';
import { runProjectApi, RecentProjectInfo } from '../../services/runProjectApi';
import { useRunWebSocket, ExecutionEvent } from '../../hooks/useRunWebSocket';
import FileExplorer from './FileExplorer';
import { useNavigate } from 'react-router-dom';

const { Header } = Layout;
const { Text } = Typography;
const { TextArea } = Input;

const generateId = () => `id_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

interface LLMMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  tokens?: number;
}

interface AgenticStep {
  id: string;
  type: 'thinking' | 'action' | 'observation' | 'result';
  content: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  timestamp: string;
}

interface Task {
  id: string;
  name: string;
  createdAt: string;
  messages: LLMMessage[];
}

interface AgenticPanel {
  id: string;
  type: 'editor' | 'terminal' | 'browser' | 'document' | 'changes';
  title: string;
  isOpen: boolean;
  content?: string;
}

type CallType = 'tool' | 'skill' | 'mcp' | 'child_agent';

interface CallRecord {
  id: string;
  type: CallType;
  name: string;
  status: 'success' | 'error' | 'pending' | 'running';
  duration?: number;
  arguments?: Record<string, any>;
  result?: any;
  error?: string;
  timestamp: string;
  startTime?: number;
  endTime?: number;
  output?: string;
  callId?: string;
  metadata?: Record<string, any>;
  childCalls?: CallRecord[];
}

interface ChildAgentOutput {
  id: string;
  name: string;
  output: string;
  status: string;
  calls: CallRecord[];
  startTime?: number;
  endTime?: number;
  duration?: number;
  input?: string;
  agentType?: string;
}

const RunPanel: React.FC = () => {
  const navigate = useNavigate();
  const {
    activeSessionId,
    sessions,
    isRunning,
    startRunning,
    stopRunning,
    addSession,
    setActiveSession,
  } = useRunStore();

  const {
    currentProject,
    recentProjects,
    loading: projectLoading,
    loadCurrentProject,
    loadRecentProjects,
    switchProject,
    openNativeFolderDialog,
  } = useRunProjectStore();

  const [tasks, setTasks] = useState<Task[]>([]);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  
  const [llmMessages, setLlmMessages] = useState<LLMMessage[]>([]);
  const [llmInput, setLlmInput] = useState('');
  const [llmLoading, setLlmLoading] = useState(false);
  
  const [agenticSteps, setAgenticSteps] = useState<AgenticStep[]>([]);
  
  const [agenticPanels, setAgenticPanels] = useState<AgenticPanel[]>([
    { id: 'editor', type: 'editor', title: '编辑器', isOpen: false },
    { id: 'terminal', type: 'terminal', title: '终端', isOpen: false },
    { id: 'browser', type: 'browser', title: '浏览器', isOpen: false },
    { id: 'document', type: 'document', title: '文档', isOpen: false },
    { id: 'changes', type: 'changes', title: '文档变更', isOpen: false },
  ]);
  
  const [activeAgenticTab, setActiveAgenticTab] = useState<string | null>(null);
  const [verticalSplitRatio, setVerticalSplitRatio] = useState(0.5);
  const [isVerticalDragging, setIsVerticalDragging] = useState(false);
  const [verticalDragStartY, setVerticalDragStartY] = useState(0);
  const [verticalDragStartRatio, setVerticalDragStartRatio] = useState(0.5);
  
  const [recentModalVisible, setRecentModalVisible] = useState(false);
  const [switchingProjectId, setSwitchingProjectId] = useState<string | null>(null);
  
  const [panelRatios, setPanelRatios] = useState([1, 4, 4, 1]);
  const [isDragging, setIsDragging] = useState<number | null>(null);
  const [dragStartX, setDragStartX] = useState(0);
  const [dragStartRatios, setDragStartRatios] = useState<number[]>([]);
  
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [callRecords, setCallRecords] = useState<CallRecord[]>([]);
  const [childAgentOutputs, setChildAgentOutputs] = useState<ChildAgentOutput[]>([]);
  const [streamingContent, setStreamingContent] = useState('');
  const [canvasData, setCanvasData] = useState<any>(null);
  const [flowId, setFlowId] = useState<string | null>(null);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const streamingRef = useRef<string>('');

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [llmMessages, streamingContent]);

  useEffect(() => {
    loadCurrentProject();
    loadRecentProjects();
  }, []);

  const handleExecutionEvent = useCallback((event: ExecutionEvent) => {
    console.log('Execution event:', event);

    switch (event.event_type) {
      case 'execution_start':
        setCallRecords([]);
        setChildAgentOutputs([]);
        setStreamingContent('');
        streamingRef.current = '';
        break;

      case 'agent_start':
        console.log(`Agent started: ${event.agent_name} (${event.agent_id})`);
        break;

      case 'agent_complete':
        if (event.content) {
          setLlmMessages(prev => [...prev, {
            id: `msg_${Date.now()}`,
            role: 'assistant',
            content: event.content || '',
            timestamp: new Date().toISOString(),
          }]);
        }
        break;

      case 'tool_call':
        setCallRecords(prev => {
          const callId = event.tool_call_id || event.tool_name || generateId();
          const existingIndex = prev.findIndex(r => r.callId === callId && r.type === 'tool');
          
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
            type: 'tool',
            name: event.tool_name || 'unknown',
            status: 'running',
            arguments: event.tool_args,
            result: event.tool_result,
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
        setCallRecords(prev => {
          const callId = event.tool_call_id || event.tool_name;
          const existingIndex = prev.findIndex(r => r.callId === callId && r.type === 'tool');
          const endTime = Date.now();
          
          if (existingIndex >= 0) {
            const updated = [...prev];
            const startTime = updated[existingIndex].startTime || endTime;
            updated[existingIndex] = {
              ...updated[existingIndex],
              status: event.error ? 'error' : 'success',
              result: event.tool_result,
              error: event.error,
              endTime,
              duration: endTime - startTime,
            };
            return updated;
          }
          
          return [...prev, {
            id: generateId(),
            callId,
            type: 'tool',
            name: event.tool_name || 'unknown',
            status: event.error ? 'error' : 'success',
            arguments: event.tool_args,
            result: event.tool_result,
            error: event.error,
            timestamp: event.timestamp,
            startTime: endTime,
            endTime,
            duration: 0,
          }];
        });
        break;

      case 'skill_call':
        setCallRecords(prev => {
          const callId = event.skill_call_id || event.skill_name || generateId();
          const existingIndex = prev.findIndex(r => r.callId === callId && r.type === 'skill');
          
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
            type: 'skill',
            name: event.skill_name || 'unknown',
            status: 'running',
            arguments: event.skill_args,
            result: event.skill_result,
            timestamp: event.timestamp,
            startTime: Date.now(),
            metadata: event.metadata,
          }];
        });
        break;

      case 'skill_result':
        setCallRecords(prev => {
          const callId = event.skill_call_id || event.skill_name;
          const existingIndex = prev.findIndex(r => r.callId === callId && r.type === 'skill');
          const endTime = Date.now();
          
          if (existingIndex >= 0) {
            const updated = [...prev];
            const startTime = updated[existingIndex].startTime || endTime;
            updated[existingIndex] = {
              ...updated[existingIndex],
              status: event.error ? 'error' : 'success',
              result: event.skill_result,
              error: event.error,
              endTime,
              duration: endTime - startTime,
            };
            return updated;
          }
          
          return [...prev, {
            id: generateId(),
            callId,
            type: 'skill',
            name: event.skill_name || 'unknown',
            status: event.error ? 'error' : 'success',
            arguments: event.skill_args,
            result: event.skill_result,
            error: event.error,
            timestamp: event.timestamp,
            startTime: endTime,
            endTime,
            duration: 0,
          }];
        });
        break;

      case 'mcp_call':
        setCallRecords(prev => {
          const callId = event.mcp_call_id || event.mcp_name || generateId();
          const existingIndex = prev.findIndex(r => r.callId === callId && r.type === 'mcp');
          
          if (existingIndex >= 0) {
            const updated = [...prev];
            updated[existingIndex] = {
              ...updated[existingIndex],
              status: 'running',
              startTime: updated[existingIndex].startTime || Date.now(),
              metadata: { ...event.metadata, mcp_server: event.mcp_server },
            };
            return updated;
          }
          
          return [...prev, {
            id: generateId(),
            callId,
            type: 'mcp',
            name: event.mcp_name || 'unknown',
            status: 'running',
            arguments: event.mcp_args,
            result: event.mcp_result,
            timestamp: event.timestamp,
            startTime: Date.now(),
            metadata: { ...event.metadata, mcp_server: event.mcp_server },
          }];
        });
        break;

      case 'mcp_result':
        setCallRecords(prev => {
          const callId = event.mcp_call_id || event.mcp_name;
          const existingIndex = prev.findIndex(r => r.callId === callId && r.type === 'mcp');
          const endTime = Date.now();
          
          if (existingIndex >= 0) {
            const updated = [...prev];
            const startTime = updated[existingIndex].startTime || endTime;
            updated[existingIndex] = {
              ...updated[existingIndex],
              status: event.error ? 'error' : 'success',
              result: event.mcp_result,
              error: event.error,
              endTime,
              duration: endTime - startTime,
            };
            return updated;
          }
          
          return [...prev, {
            id: generateId(),
            callId,
            type: 'mcp',
            name: event.mcp_name || 'unknown',
            status: event.error ? 'error' : 'success',
            arguments: event.mcp_args,
            result: event.mcp_result,
            error: event.error,
            timestamp: event.timestamp,
            startTime: endTime,
            endTime,
            duration: 0,
          }];
        });
        break;

      case 'child_agent_start':
        setChildAgentOutputs(prev => {
          const existingIndex = prev.findIndex(ca => ca.id === event.child_agent_id);
          
          if (existingIndex >= 0) {
            const updated = [...prev];
            updated[existingIndex] = {
              ...updated[existingIndex],
              status: 'running',
              startTime: Date.now(),
              input: event.child_agent_input,
              agentType: event.child_agent_type,
            };
            return updated;
          }
          
          return [...prev, {
            id: event.child_agent_id || generateId(),
            name: event.child_agent_name || 'Unknown Agent',
            output: '',
            status: 'running',
            calls: [],
            startTime: Date.now(),
            input: event.child_agent_input,
            agentType: event.child_agent_type,
          }];
        });
        break;

      case 'child_agent_complete':
        setChildAgentOutputs(prev => {
          const endTime = Date.now();
          return prev.map(ca => {
            if (ca.id === event.child_agent_id) {
              const startTime = ca.startTime || endTime;
              return {
                ...ca,
                output: event.content || event.child_agent_output || '',
                status: event.error ? 'error' : 'completed',
                endTime,
                duration: endTime - startTime,
              };
            }
            return ca;
          });
        });
        break;

      case 'stream':
        streamingRef.current += event.content || '';
        setStreamingContent(streamingRef.current);
        break;

      case 'thinking':
        console.log(`Agent thinking: ${event.content}`);
        break;

      case 'action':
        console.log(`Agent action: ${event.content}`);
        break;

      case 'observation':
        console.log(`Agent observation: ${event.content}`);
        break;

      case 'execution_complete':
        stopRunning();
        if (streamingRef.current) {
          setLlmMessages(prev => [...prev, {
            id: `msg_${Date.now()}`,
            role: 'assistant',
            content: streamingRef.current,
            timestamp: new Date().toISOString(),
          }]);
          setStreamingContent('');
          streamingRef.current = '';
        }
        break;

      case 'agent_error':
      case 'execution_error':
        message.error(event.error || 'Execution failed');
        stopRunning();
        break;
    }
  }, [stopRunning]);

  const handleStream = useCallback((content: string) => {
    streamingRef.current += content;
    setStreamingContent(streamingRef.current);
  }, []);

  const handleWebSocketMessage = useCallback((msg: any) => {
    console.log('WebSocket message:', msg);
    if (msg.type === 'execution_result') {
      stopRunning();
      if (streamingRef.current) {
        setLlmMessages(prev => [...prev, {
          id: `msg_${Date.now()}`,
          role: 'assistant',
          content: streamingRef.current,
          timestamp: new Date().toISOString(),
        }]);
        setStreamingContent('');
        streamingRef.current = '';
      }
    }
  }, [stopRunning]);

  const { isConnected, connectionStatus, executeFlow } = useRunWebSocket({
    sessionId,
    onMessage: handleWebSocketMessage,
    onEvent: handleExecutionEvent,
    onStream: handleStream,
    onError: () => {
      message.error('WebSocket connection error');
    },
    autoReconnect: true,
  });

  const createNewTask = useCallback(async (name?: string) => {
    try {
      const sessionData = await runApi.createSession({
        flowId: flowId || undefined,
        canvasData: canvasData || undefined,
        projectName: currentProject?.name,
      });
      
      setSessionId(sessionData.session_id);
      
      const newTask: Task = {
        id: sessionData.session_id,
        name: name || `任务 ${tasks.length + 1}`,
        createdAt: new Date().toISOString(),
        messages: [],
      };
      setTasks(prev => [...prev, newTask]);
      setActiveTaskId(newTask.id);
      setLlmMessages([]);
      setCallRecords([]);
      setChildAgentOutputs([]);
      setStreamingContent('');
      streamingRef.current = '';
      addSession({ id: sessionData.session_id, status: 'running' });
      
      return newTask;
    } catch (error) {
      console.error('Failed to create session:', error);
      message.error('创建会话失败');
      return null;
    }
  }, [tasks.length, flowId, canvasData, currentProject, addSession]);

  const handleSwitchTask = (taskId: string) => {
    setActiveTaskId(taskId);
    const task = tasks.find(t => t.id === taskId);
    if (task) {
      setLlmMessages(task.messages);
    }
  };

  const handleDeleteTask = (taskId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const newTasks = tasks.filter(t => t.id !== taskId);
    setTasks(newTasks);
    if (activeTaskId === taskId) {
      setActiveTaskId(newTasks.length > 0 ? newTasks[0].id : null);
      setLlmMessages(newTasks.length > 0 ? newTasks[0].messages : []);
    }
  };

  const handleGoHome = () => {
    navigate('/mainmenu');
  };

  const handleSelectFolder = async () => {
    const result = await openNativeFolderDialog();
    if (result) {
      message.success(`已选择项目: ${result.project_name}`);
    }
  };

  const handleSelectFromRecent = async (project: RecentProjectInfo) => {
    setSwitchingProjectId(project.project_id);
    try {
      const success = await switchProject(project.project_id);
      if (success) {
        message.success(`已切换到工作区: ${project.project_name}`);
        setRecentModalVisible(false);
      }
    } finally {
      setSwitchingProjectId(null);
    }
  };

  const handleSendLLMMessage = async () => {
    if (!llmInput.trim()) return;
    
    let currentSessionId = sessionId;
    let currentTaskId = activeTaskId;
    let needWaitConnection = false;
    
    if (!currentSessionId) {
      try {
        const sessionData = await runApi.createSession({
          flowId: flowId || undefined,
          canvasData: canvasData || undefined,
          projectName: currentProject?.name,
        });
        currentSessionId = sessionData.session_id;
        setSessionId(currentSessionId);
        addSession({ id: currentSessionId, status: 'running' });
        needWaitConnection = true;
      } catch (error) {
        console.error('Failed to create session:', error);
        message.error('创建会话失败');
        return;
      }
    }

    if (!currentTaskId) {
      const newTask: Task = {
        id: currentSessionId || `task_${Date.now()}`,
        name: `任务 ${tasks.length + 1}`,
        createdAt: new Date().toISOString(),
        messages: [],
      };
      setTasks(prev => [...prev, newTask]);
      currentTaskId = newTask.id;
      setActiveTaskId(currentTaskId);
    }

    const userMessage: LLMMessage = {
      id: `msg_${Date.now()}`,
      role: 'user',
      content: llmInput,
      timestamp: new Date().toISOString(),
    };

    setLlmMessages(prev => [...prev, userMessage]);
    
    setTasks(prev => prev.map(t => 
      t.id === currentTaskId 
        ? { ...t, messages: [...t.messages, userMessage] }
        : t
    ));
    
    const userInput = llmInput;
    setLlmInput('');
    setLlmLoading(true);
    startRunning();

    try {
      let currentCanvasData = canvasData;
      if (!currentCanvasData || !currentCanvasData.nodes || currentCanvasData.nodes.length === 0) {
        currentCanvasData = {
          nodes: [{
            id: 'default_agent',
            type: 'executor',
            data: {
              name: 'Assistant',
              system_prompt: 'You are a helpful assistant.',
              tools: [],
            },
          }],
          edges: [],
        };
        setCanvasData(currentCanvasData);
      }

      if (needWaitConnection) {
        await new Promise<void>((resolve) => {
          const checkConnection = () => {
            if (isConnected) {
              resolve();
            } else {
              setTimeout(checkConnection, 100);
            }
          };
          setTimeout(() => {
            if (!isConnected) {
              resolve();
            }
          }, 3000);
          checkConnection();
        });
      }

      if (isConnected) {
        const sent = executeFlow(currentCanvasData, userInput, flowId || undefined);
        if (!sent) {
          throw new Error('WebSocket发送消息失败');
        }
      } else {
        const response = await runApi.executeWorkflow(
          currentCanvasData,
          userInput,
          currentProject?.name
        );
        
        if (response.output) {
          const assistantMessage: LLMMessage = {
            id: `msg_${Date.now()}`,
            role: 'assistant',
            content: response.output,
            timestamp: new Date().toISOString(),
          };
          setLlmMessages(prev => [...prev, assistantMessage]);
          
          setTasks(prev => prev.map(t => 
            t.id === currentTaskId 
              ? { ...t, messages: [...t.messages, assistantMessage] }
              : t
          ));
        } else if (response.error) {
          throw new Error(response.error);
        }
      }
    } catch (error: any) {
      let errorMessage = '未知错误';
      if (error.response?.data?.detail) {
        errorMessage = error.response.data.detail;
      } else if (error.response?.data?.message) {
        errorMessage = error.response.data.message;
      } else if (error.message) {
        errorMessage = error.message;
      }
      message.error('发送消息失败: ' + errorMessage);
      setLlmMessages(prev => prev.filter(m => m.id !== userMessage.id));
    } finally {
      setLlmLoading(false);
      stopRunning();
    }
  };

  const clearLLMMessages = () => {
    setLlmMessages([]);
    setCallRecords([]);
    setChildAgentOutputs([]);
    if (activeTaskId) {
      setTasks(prev => prev.map(t => 
        t.id === activeTaskId 
          ? { ...t, messages: [] }
          : t
      ));
    }
  };

  const clearAgenticSteps = () => {
    setAgenticSteps([]);
  };

  const openAgenticPanel = (panelType: string) => {
    setAgenticPanels(prev => prev.map(p => 
      p.type === panelType ? { ...p, isOpen: true } : p
    ));
    setActiveAgenticTab(panelType);
  };

  const closeAgenticPanel = (panelId: string) => {
    const panel = agenticPanels.find(p => p.id === panelId);
    setAgenticPanels(prev => prev.map(p => 
      p.id === panelId ? { ...p, isOpen: false } : p
    ));
    if (activeAgenticTab === panel?.type) {
      const remainingOpen = agenticPanels.filter(p => p.isOpen && p.id !== panelId);
      setActiveAgenticTab(remainingOpen.length > 0 ? remainingOpen[0].type : null);
    }
  };

  const handleVerticalMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsVerticalDragging(true);
    setVerticalDragStartY(e.clientY);
    setVerticalDragStartRatio(verticalSplitRatio);
  }, [verticalSplitRatio]);

  const handleVerticalMouseMove = useCallback((e: MouseEvent) => {
    if (!isVerticalDragging) return;

    const agenticPanel = document.getElementById('agentic-panel-content');
    if (!agenticPanel) return;

    const rect = agenticPanel.getBoundingClientRect();
    const deltaY = e.clientY - verticalDragStartY;
    const deltaRatio = deltaY / rect.height;

    let newRatio = verticalDragStartRatio + deltaRatio;
    newRatio = Math.max(0.2, Math.min(0.8, newRatio));

    setVerticalSplitRatio(newRatio);
  }, [isVerticalDragging, verticalDragStartY, verticalDragStartRatio]);

  const handleVerticalMouseUp = useCallback(() => {
    setIsVerticalDragging(false);
  }, []);

  useEffect(() => {
    if (isVerticalDragging) {
      document.addEventListener('mousemove', handleVerticalMouseMove);
      document.addEventListener('mouseup', handleVerticalMouseUp);
    } else {
      document.removeEventListener('mousemove', handleVerticalMouseMove);
      document.removeEventListener('mouseup', handleVerticalMouseUp);
    }

    return () => {
      document.removeEventListener('mousemove', handleVerticalMouseMove);
      document.removeEventListener('mouseup', handleVerticalMouseUp);
    };
  }, [isVerticalDragging, handleVerticalMouseMove, handleVerticalMouseUp]);

  const getStepIcon = (type: string) => {
    switch (type) {
      case 'thinking': return '🧠';
      case 'action': return '⚡';
      case 'observation': return '👁️';
      case 'result': return '✅';
      default: return '📝';
    }
  };

  const truncatePath = (path: string, maxLength: number = 40) => {
    if (path.length <= maxLength) return path;
    const parts = path.split(/[/\\]/);
    if (parts.length <= 2) return '...' + path.slice(-(maxLength - 3));
    return '.../' + parts.slice(-2).join('/');
  };

  const formatTime = (dateStr?: string) => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    
    if (diff < 60000) return '刚刚';
    if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;
    if (diff < 604800000) return `${Math.floor(diff / 86400000)} 天前`;
    
    return date.toLocaleDateString('zh-CN');
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
    const containerWidth = containerRect.width;
    const deltaX = e.clientX - dragStartX;
    const deltaRatio = (deltaX / containerWidth) * 10;

    const newRatios = [...dragStartRatios];
    const leftIndex = isDragging;
    const rightIndex = isDragging + 1;

    const minRatio = 0.5;
    const maxTotal = 10 - minRatio * 2;

    let leftNew = dragStartRatios[leftIndex] + deltaRatio;
    let rightNew = dragStartRatios[rightIndex] - deltaRatio;

    if (leftNew < minRatio) {
      leftNew = minRatio;
      rightNew = dragStartRatios[leftIndex] + dragStartRatios[rightIndex] - minRatio;
    }
    if (rightNew < minRatio) {
      rightNew = minRatio;
      leftNew = dragStartRatios[leftIndex] + dragStartRatios[rightIndex] - minRatio;
    }

    newRatios[leftIndex] = leftNew;
    newRatios[rightIndex] = rightNew;

    setPanelRatios(newRatios);
  }, [isDragging, dragStartX, dragStartRatios]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(null);
  }, []);

  useEffect(() => {
    if (isDragging !== null) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    } else {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, handleMouseMove, handleMouseUp]);

  const getAgenticPanelIcon = (type: string) => {
    switch (type) {
      case 'editor': return <EditOutlined />;
      case 'terminal': return <CodeOutlined />;
      case 'browser': return <GlobalOutlined />;
      case 'document': return <FileTextOutlined />;
      case 'changes': return <FileOutlined />;
      default: return <DesktopOutlined />;
    }
  };

  const unopenedPanels = agenticPanels.filter(p => !p.isOpen);
  
  const panelMenuItems: MenuProps['items'] = unopenedPanels.map(panel => ({
    key: panel.id,
    label: (
      <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {getAgenticPanelIcon(panel.type)}
        {panel.title}
      </span>
    ),
    onClick: () => openAgenticPanel(panel.type),
  }));

  const projectMenuItems: MenuProps['items'] = [
    {
      key: 'select',
      label: (
        <span onClick={handleSelectFolder}>
          <FolderOutlined style={{ marginRight: 8 }} />
          选择项目
        </span>
      ),
    },
    {
      key: 'recent',
      label: (
        <span onClick={() => setRecentModalVisible(true)}>
          <HistoryOutlined style={{ marginRight: 8 }} />
          历史项目
        </span>
      ),
    },
  ];

  const totalRatio = panelRatios.reduce((a, b) => a + b, 0);

  const dividerStyle: React.CSSProperties = {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 6,
    cursor: 'col-resize',
    zIndex: 20,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  };

  const dividerLineStyle: React.CSSProperties = {
    width: 2,
    height: 40,
    borderRadius: 1,
    background: isDragging !== null ? 'var(--primary-100)' : 'var(--bg-300)',
    transition: isDragging !== null ? 'none' : 'background 0.2s',
  };

  return (
    <Layout style={{ height: '100%', background: 'var(--bg-100)' }}>
      <Header style={{ 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'space-between', 
        background: 'linear-gradient(180deg, var(--sidebar-bg) 0%, rgba(15, 23, 42, 0.98) 100%)',
        borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
        padding: '0 20px',
        height: '52px',
        backdropFilter: 'blur(12px)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div 
            style={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: '10px', 
              cursor: 'pointer',
              padding: '6px 10px',
              borderRadius: 8,
              transition: 'background 0.2s',
            }}
            onClick={handleGoHome}
            onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.06)'}
            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
          >
            <div style={{
              width: '28px',
              height: '28px',
              background: 'linear-gradient(135deg, var(--primary-100) 0%, var(--primary-200) 100%)',
              borderRadius: 6,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'white',
              fontSize: '12px',
              fontWeight: 700,
              boxShadow: '0 2px 8px rgba(59, 130, 246, 0.3)',
            }}>
              SE
            </div>
            <div style={{ 
              color: '#fff', 
              fontSize: '15px', 
              fontWeight: 600,
              letterSpacing: '-0.02em',
            }}>
              SoloEngine
            </div>
          </div>
          
          <div style={{ 
            width: 1, 
            height: 20, 
            background: 'rgba(255, 255, 255, 0.1)',
            borderRadius: 1,
          }} />
          
          <div style={{ 
            display: 'flex', 
            alignItems: 'center', 
            gap: 6,
            padding: '4px 10px',
            borderRadius: 6,
            background: 'rgba(255, 255, 255, 0.04)',
            border: '1px solid rgba(255, 255, 255, 0.06)',
          }}>
            <LockOutlined style={{ fontSize: 12, color: 'var(--success)' }} />
            <Text style={{ fontSize: 12, color: 'rgba(255, 255, 255, 0.6)' }}>安全沙箱</Text>
          </div>
        </div>
        
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {currentProject ? (
            <Dropdown
              menu={{ items: projectMenuItems }}
              trigger={['click']}
              placement="bottomRight"
            >
              <Button
                type="text"
                icon={<FolderOpenOutlined style={{ color: 'var(--primary-100)' }} />}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '6px 14px',
                  height: 36,
                  borderRadius: 8,
                  background: 'rgba(59, 130, 246, 0.1)',
                  border: '1px solid rgba(59, 130, 246, 0.2)',
                  color: 'var(--primary-100)',
                  fontWeight: 500,
                }}
              >
                <Text style={{ 
                  maxWidth: 140, 
                  overflow: 'hidden', 
                  textOverflow: 'ellipsis', 
                  whiteSpace: 'nowrap', 
                  color: 'var(--primary-100)',
                  fontSize: 13,
                }}>
                  {currentProject.name}
                </Text>
              </Button>
            </Dropdown>
          ) : (
            <Button
              type="primary"
              icon={<FolderOutlined />}
              onClick={handleSelectFolder}
              loading={projectLoading}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                height: 36,
                borderRadius: 8,
                background: 'linear-gradient(135deg, var(--primary-100), var(--primary-200))',
                border: 'none',
                fontWeight: 500,
                boxShadow: '0 2px 8px rgba(59, 130, 246, 0.3)',
              }}
            >
              选择项目
            </Button>
          )}
        </div>
      </Header>

      <div ref={containerRef} style={{ 
        height: 'calc(100% - 52px)', 
        position: 'relative', 
        display: 'flex',
        flexDirection: 'row',
        background: 'var(--bg-100)',
      }}>
        
        <div style={{
          width: `${(panelRatios[0] / totalRatio) * 100}%`,
          background: 'var(--bg-200)',
          display: 'flex',
          flexDirection: 'column',
          position: 'relative',
          flexShrink: 0,
          borderRight: '1px solid var(--bg-300)',
        }}>
          <div style={{ padding: '12px 10px' }}>
            <Button 
              type="primary"
              block
              icon={<PlusOutlined />}
              onClick={() => createNewTask()}
              style={{
                height: 38,
                borderRadius: 8,
                background: 'linear-gradient(135deg, var(--primary-100), var(--primary-200))',
                border: 'none',
                fontWeight: 500,
                boxShadow: '0 2px 8px rgba(59, 130, 246, 0.25)',
              }}
            >
              新任务
            </Button>
          </div>
          
          <div style={{ flex: 1, overflow: 'auto', padding: '0 6px 8px' }}>
            {tasks.length === 0 ? (
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
                {tasks.map(task => (
                  <div
                    key={task.id}
                    onClick={() => handleSwitchTask(task.id)}
                    style={{
                      padding: '10px 12px',
                      borderRadius: 8,
                      cursor: 'pointer',
                      background: activeTaskId === task.id 
                        ? 'linear-gradient(135deg, var(--primary-100), var(--primary-200))' 
                        : 'transparent',
                      color: activeTaskId === task.id ? '#fff' : 'var(--text-100)',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      transition: 'all 0.15s ease',
                      border: activeTaskId === task.id ? 'none' : '1px solid transparent',
                    }}
                    onMouseEnter={(e) => {
                      if (activeTaskId !== task.id) {
                        e.currentTarget.style.background = 'var(--bg-300)';
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (activeTaskId !== task.id) {
                        e.currentTarget.style.background = 'transparent';
                      }
                    }}
                  >
                    <div style={{ overflow: 'hidden', flex: 1 }}>
                      <div style={{ 
                        fontWeight: activeTaskId === task.id ? 600 : 450,
                        fontSize: 13,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}>
                        {task.name}
                      </div>
                      <div style={{ 
                        fontSize: 11, 
                        opacity: 0.65, 
                        marginTop: 2,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}>
                        {task.messages.length > 0 
                          ? task.messages[task.messages.length - 1].content.slice(0, 18) + '...'
                          : '空对话'
                        }
                      </div>
                    </div>
                    <Button
                      type="text"
                      size="small"
                      icon={<ClearOutlined />}
                      onClick={(e) => handleDeleteTask(task.id, e)}
                      style={{ 
                        opacity: activeTaskId === task.id ? 0.9 : 0.5,
                        color: activeTaskId === task.id ? '#fff' : 'var(--text-300)',
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
          
          <div
            onMouseDown={(e) => handleMouseDown(e, 0)}
            style={{ ...dividerStyle, right: -3 }}
          >
            <div style={dividerLineStyle} />
          </div>
        </div>

        <div style={{
          width: `${(panelRatios[1] / totalRatio) * 100}%`,
          background: 'var(--bg-100)',
          display: 'flex',
          flexDirection: 'column',
          position: 'relative',
          flexShrink: 0,
          borderRight: '1px solid var(--bg-300)',
        }}>
          <div style={{ 
            flex: 1, 
            overflow: 'auto', 
            padding: '16px',
            paddingBottom: '130px',
            display: 'flex',
            flexDirection: 'column',
          }}>
            {llmMessages.length === 0 && !streamingContent ? (
              <div style={{ 
                flex: 1,
                display: 'flex', 
                flexDirection: 'column',
                justifyContent: 'center', 
                alignItems: 'center',
              }}>
                <div style={{
                  width: 72,
                  height: 72,
                  borderRadius: 24,
                  background: 'linear-gradient(135deg, var(--primary-100), var(--primary-200))',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginBottom: 20,
                  boxShadow: '0 10px 30px rgba(59, 130, 246, 0.3)',
                }}>
                  <RobotOutlined style={{ fontSize: 32, color: '#fff' }} />
                </div>
                <Text style={{ fontSize: 16, color: 'var(--text-100)', fontWeight: 600, marginBottom: 8 }}>
                  开始对话
                </Text>
                <Text style={{ fontSize: 13, color: 'var(--text-300)', textAlign: 'center', lineHeight: 1.6 }}>
                  在下方输入框输入内容开始对话
                </Text>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {llmMessages.map(msg => (
                  <div 
                    key={msg.id}
                    style={{
                      display: 'flex',
                      gap: 10,
                      alignItems: 'flex-start',
                    }}
                  >
                    <div style={{
                      width: 32,
                      height: 32,
                      borderRadius: 10,
                      background: msg.role === 'user' 
                        ? 'linear-gradient(135deg, var(--accent-100), var(--accent-200))' 
                        : 'linear-gradient(135deg, var(--primary-100), var(--primary-200))',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                      boxShadow: msg.role === 'user' 
                        ? '0 2px 8px rgba(16, 185, 129, 0.2)' 
                        : '0 2px 8px rgba(59, 130, 246, 0.2)',
                    }}>
                      {msg.role === 'user' 
                        ? <span style={{ color: '#fff', fontWeight: 600, fontSize: 12 }}>U</span>
                        : <RobotOutlined style={{ color: '#fff', fontSize: 14 }} />
                      }
                    </div>
                    
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ 
                        marginBottom: 4,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                      }}>
                        <Text strong style={{ fontSize: 12, color: 'var(--text-100)' }}>
                          {msg.role === 'user' ? '用户' : 'Assistant'}
                        </Text>
                        <Text style={{ fontSize: 11, color: 'var(--text-300)' }}>
                          {formatTime(msg.timestamp)}
                        </Text>
                      </div>
                      <div style={{
                        padding: '12px 14px',
                        borderRadius: 10,
                        background: msg.role === 'user' ? 'var(--bg-200)' : 'var(--bg-100)',
                        border: '1px solid var(--bg-300)',
                        boxShadow: '0 1px 3px rgba(0, 0, 0, 0.04)',
                      }}>
                        <div style={{ 
                          whiteSpace: 'pre-wrap', 
                          lineHeight: 1.65,
                          fontSize: 13,
                          color: 'var(--text-100)',
                        }}>
                          {msg.content}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
                {streamingContent && (
                  <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                    <div style={{
                      width: 32,
                      height: 32,
                      borderRadius: 10,
                      background: 'linear-gradient(135deg, var(--primary-100), var(--primary-200))',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}>
                      <RobotOutlined style={{ color: '#fff', fontSize: 14 }} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Text strong style={{ fontSize: 12, color: 'var(--text-100)' }}>Assistant</Text>
                        <Text style={{ fontSize: 11, color: 'var(--text-300)' }}>正在输出...</Text>
                      </div>
                      <div style={{
                        padding: '12px 14px',
                        borderRadius: 10,
                        background: 'var(--bg-100)',
                        border: '1px solid var(--bg-300)',
                      }}>
                        <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.65, fontSize: 13, color: 'var(--text-100)' }}>
                          {streamingContent}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>
            )}
          </div>
          
          <div style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            padding: '16px',
            background: 'linear-gradient(180deg, transparent 0%, var(--bg-100) 25%)',
          }}>
            <div style={{
              background: '#ffffff',
              borderRadius: 12,
              border: '1px solid #e0e0e0',
              boxShadow: '0 2px 12px rgba(0, 0, 0, 0.1)',
              overflow: 'hidden',
            }}>
              <TextArea
                value={llmInput}
                onChange={(e) => setLlmInput(e.target.value)}
                placeholder="请输入您的问题..."
                autoSize={{ minRows: 3, maxRows: 8 }}
                bordered={false}
                style={{
                  resize: 'none',
                  background: 'transparent',
                  fontSize: 14,
                  lineHeight: 1.6,
                  letterSpacing: '0.02em',
                  color: '#333333',
                  padding: '12px 14px',
                  border: 'none',
                  outline: 'none',
                  boxShadow: 'none',
                }}
                onPressEnter={(e) => {
                  if (!e.shiftKey) {
                    e.preventDefault();
                    handleSendLLMMessage();
                  }
                }}
              />

              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'flex-end',
                padding: '8px 12px',
              }}>
                <Button
                  type="primary"
                  size="small"
                  icon={<SendOutlined style={{ fontSize: 12 }} />}
                  onClick={handleSendLLMMessage}
                  loading={llmLoading || isRunning}
                  disabled={!llmInput.trim()}
                  style={{
                    borderRadius: 6,
                    background: llmInput.trim()
                      ? 'linear-gradient(135deg, var(--primary-100), var(--primary-200))'
                      : '#e0e0e0',
                    border: 'none',
                    width: 28,
                    height: 28,
                    minWidth: 28,
                    padding: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                />
              </div>
            </div>
          </div>
          
          <div
            onMouseDown={(e) => handleMouseDown(e, 1)}
            style={{ ...dividerStyle, right: -3 }}
          >
            <div style={dividerLineStyle} />
          </div>
        </div>

        <div style={{
          width: `${(panelRatios[2] / totalRatio) * 100}%`,
          background: 'var(--bg-100)',
          display: 'flex',
          flexDirection: 'column',
          position: 'relative',
          flexShrink: 0,
          borderRight: '1px solid var(--bg-300)',
        }}>
          <div style={{ 
            borderBottom: '1px solid var(--bg-300)',
            display: 'flex',
            alignItems: 'center',
            background: 'var(--bg-100)',
            height: 45,
            padding: '0 8px',
          }}>
            <Text strong style={{ fontSize: 13, color: 'var(--text-100)', padding: '0 8px', whiteSpace: 'nowrap' }}>Agentic操作区</Text>
            
            {agenticPanels.filter(p => p.isOpen).length > 0 && (
              <div style={{ 
                display: 'flex', 
                alignItems: 'center', 
                height: '100%',
                marginLeft: 8,
                borderLeft: '1px solid var(--bg-300)',
                paddingLeft: 8,
              }}>
                {agenticPanels.filter(p => p.isOpen).map(panel => (
                  <div
                    key={panel.id}
                    onClick={() => setActiveAgenticTab(panel.type)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      padding: '6px 12px',
                      cursor: 'pointer',
                      background: activeAgenticTab === panel.type ? 'var(--bg-200)' : 'transparent',
                      borderRadius: 6,
                      marginRight: 4,
                      transition: 'background 0.15s',
                    }}
                  >
                    {getAgenticPanelIcon(panel.type)}
                    <Text style={{ 
                      fontSize: 12, 
                      color: activeAgenticTab === panel.type ? 'var(--text-100)' : 'var(--text-300)',
                      fontWeight: activeAgenticTab === panel.type ? 500 : 400,
                    }}>
                      {panel.title}
                    </Text>
                    <ClearOutlined 
                      style={{ fontSize: 10, color: 'var(--text-300)' }}
                      onClick={(e) => {
                        e.stopPropagation();
                        closeAgenticPanel(panel.id);
                      }}
                    />
                  </div>
                ))}
              </div>
            )}
            
            <div style={{ flex: 1 }} />
            
            {unopenedPanels.length > 0 && (
              <Dropdown menu={{ items: panelMenuItems }} trigger={['click']} placement="bottomRight">
                <Button 
                  type="text" 
                  size="small" 
                  icon={<PlusOutlined />}
                  style={{ 
                    color: 'var(--primary-100)',
                    width: 28,
                    height: 28,
                    borderRadius: 6,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                />
              </Dropdown>
            )}
          </div>
          
          <div id="agentic-panel-content" style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            {agenticPanels.filter(p => p.isOpen).length === 0 ? (
              <div style={{ 
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
              }}>
                <div style={{
                  width: 48,
                  height: 48,
                  borderRadius: 12,
                  background: 'var(--bg-200)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginBottom: 10,
                }}>
                  <DesktopOutlined style={{ fontSize: 20, color: 'var(--text-300)' }} />
                </div>
                <Text style={{ fontSize: 11, color: 'var(--text-300)' }}>点击 + 打开操作面板</Text>
              </div>
            ) : (
              <>
                {(() => {
                  const openPanels = agenticPanels.filter(p => p.isOpen);
                  const hasEditor = openPanels.some(p => p.type === 'editor');
                  const hasTerminal = openPanels.some(p => p.type === 'terminal');
                  const showSplit = hasEditor && hasTerminal && (activeAgenticTab === 'editor' || activeAgenticTab === 'terminal');
                  
                  if (showSplit) {
                    return (
                      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', position: 'relative' }}>
                        <div style={{ 
                          height: `${verticalSplitRatio * 100}%`, 
                          overflow: 'auto',
                          borderBottom: '1px solid var(--bg-300)',
                          background: 'var(--bg-100)',
                        }}>
                          <div style={{ 
                            padding: '8px 12px', 
                            borderBottom: '1px solid var(--bg-300)',
                            background: 'var(--bg-200)',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 6,
                          }}>
                            <EditOutlined style={{ fontSize: 12, color: 'var(--primary-100)' }} />
                            <Text style={{ fontSize: 11, fontWeight: 500 }}>编辑器</Text>
                          </div>
                          <div style={{ padding: 12 }}>
                            <Text type="secondary" style={{ fontSize: 11 }}>代码编辑器区域</Text>
                          </div>
                        </div>
                        
                        <div
                          onMouseDown={handleVerticalMouseDown}
                          style={{
                            position: 'absolute',
                            left: 0,
                            right: 0,
                            top: `${verticalSplitRatio * 100}%`,
                            height: 6,
                            cursor: 'row-resize',
                            zIndex: 10,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            transform: 'translateY(-50%)',
                          }}
                        >
                          <div style={{
                            width: 40,
                            height: 4,
                            borderRadius: 2,
                            background: isVerticalDragging ? 'var(--primary-100)' : 'var(--bg-300)',
                            transition: isVerticalDragging ? 'none' : 'background 0.2s',
                          }} />
                        </div>
                        
                        <div style={{ 
                          height: `${(1 - verticalSplitRatio) * 100}%`, 
                          overflow: 'auto',
                          background: 'var(--bg-100)',
                        }}>
                          <div style={{ 
                            padding: '8px 12px', 
                            borderBottom: '1px solid var(--bg-300)',
                            background: 'var(--bg-200)',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 6,
                          }}>
                            <CodeOutlined style={{ fontSize: 12, color: 'var(--accent-100)' }} />
                            <Text style={{ fontSize: 11, fontWeight: 500 }}>终端</Text>
                          </div>
                          <div style={{ padding: 12 }}>
                            <Text type="secondary" style={{ fontSize: 11 }}>终端命令行区域</Text>
                          </div>
                        </div>
                      </div>
                    );
                  }
                  
                  const activePanel = agenticPanels.find(p => p.type === activeAgenticTab && p.isOpen);
                  if (!activePanel) {
                    const firstOpen = openPanels[0];
                    if (firstOpen) {
                      setActiveAgenticTab(firstOpen.type);
                    }
                    return null;
                  }
                  
                  return (
                    <div style={{ flex: 1, overflow: 'auto' }}>
                      <div style={{ padding: 12 }}>
                        <Text type="secondary" style={{ fontSize: 11 }}>
                          {activePanel.type === 'editor' && '代码编辑器区域'}
                          {activePanel.type === 'terminal' && '终端命令行区域'}
                          {activePanel.type === 'browser' && '浏览器预览区域'}
                          {activePanel.type === 'document' && '文档查看区域'}
                          {activePanel.type === 'changes' && '文档变更记录'}
                        </Text>
                      </div>
                    </div>
                  );
                })()}
              </>
            )}
          </div>
          
          <div
            onMouseDown={(e) => handleMouseDown(e, 2)}
            style={{ ...dividerStyle, right: -3 }}
          >
            <div style={dividerLineStyle} />
          </div>
        </div>

        <div style={{
          width: `${(panelRatios[3] / totalRatio) * 100}%`,
          background: 'var(--bg-100)',
          display: 'flex',
          flexDirection: 'column',
          position: 'relative',
          flexShrink: 0,
        }}>
          <div style={{ 
            padding: '0 14px', 
            borderBottom: '1px solid var(--bg-300)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            background: 'var(--bg-100)',
            height: 45,
          }}>
            <Text strong style={{ fontSize: 13, color: 'var(--text-100)' }}>资源管理器</Text>
            {currentProject ? (
              <Tooltip title={currentProject.folder_path}>
                <FolderOpenOutlined 
                  style={{ color: 'var(--primary-100)', cursor: 'pointer', fontSize: 14 }}
                  onClick={() => setRecentModalVisible(true)}
                />
              </Tooltip>
            ) : (
              <FolderOutlined 
                style={{ color: 'var(--text-300)', cursor: 'pointer', fontSize: 14 }}
                onClick={handleSelectFolder}
              />
            )}
          </div>
          
          <div style={{ flex: 1, overflow: 'auto' }}>
            {currentProject ? (
              <FileExplorer onFileEdit={() => {}} />
            ) : (
              <div style={{ 
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                padding: 32,
              }}>
                <div style={{
                  width: 48,
                  height: 48,
                  borderRadius: 12,
                  background: 'var(--bg-200)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginBottom: 10,
                }}>
                  <FolderOutlined style={{ fontSize: 20, color: 'var(--text-300)' }} />
                </div>
                <Text style={{ fontSize: 11, color: 'var(--text-300)' }}>请先选择项目</Text>
              </div>
            )}
          </div>
        </div>
      </div>

      <Modal
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <HistoryOutlined style={{ color: 'var(--primary-100)' }} />
            <span>历史项目</span>
          </div>
        }
        open={recentModalVisible}
        onCancel={() => setRecentModalVisible(false)}
        footer={null}
        width={480}
        styles={{
          content: { borderRadius: 12 },
          header: { borderBottom: '1px solid var(--bg-300)' },
        }}
      >
        <Spin spinning={projectLoading}>
          {recentProjects.length === 0 ? (
            <Empty
              description="暂无历史项目"
              style={{ padding: '40px 0' }}
            />
          ) : (
            <List
              dataSource={recentProjects}
              renderItem={(project) => (
                <List.Item
                  style={{
                    cursor: 'pointer',
                    padding: '12px 14px',
                    borderRadius: 10,
                    transition: 'background 0.15s',
                    border: 'none',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'var(--bg-200)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'transparent';
                  }}
                  onClick={() => handleSelectFromRecent(project)}
                >
                  <List.Item.Meta
                    avatar={
                      switchingProjectId === project.project_id ? (
                        <Spin size="small" />
                      ) : currentProject?.id === project.project_id ? (
                        <CheckOutlined style={{ color: 'var(--success)', fontSize: 16 }} />
                      ) : (
                        <FolderOutlined style={{ fontSize: 16, color: 'var(--text-200)' }} />
                      )
                    }
                    title={
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Text strong style={{ fontSize: 13 }}>{project.project_name}</Text>
                        {currentProject?.id === project.project_id && (
                          <Tag color="success" style={{ fontSize: 10, padding: '0 6px', margin: 0, borderRadius: 4 }}>
                            当前
                          </Tag>
                        )}
                      </div>
                    }
                    description={
                      <Tooltip title={project.folder_path}>
                        <Text type="secondary" style={{ fontSize: 11 }}>
                          {truncatePath(project.folder_path)}
                        </Text>
                      </Tooltip>
                    }
                  />
                  <Text type="secondary" style={{ fontSize: 11 }}>
                    {formatTime(project.accessed_at)}
                  </Text>
                </List.Item>
              )}
              style={{ maxHeight: 360, overflow: 'auto' }}
            />
          )}
        </Spin>
      </Modal>
    </Layout>
  );
};

export default RunPanel;
