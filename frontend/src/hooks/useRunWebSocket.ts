/**
 * @file useRunWebSocket.ts
 * @description WebSocket Hook - 运行面板实时通信
 * @author SoloEngine Team
 * @date 2026-02-24
 */

import { useEffect, useRef, useCallback, useState } from 'react';

export type ExecutionEventType =
  | 'execution_start'
  | 'execution_complete'
  | 'execution_error'
  | 'execution_cancelled'
  | 'agent_start'
  | 'agent_complete'
  | 'agent_error'
  | 'tool_call'
  | 'tool_result'
  | 'skill_call'
  | 'skill_result'
  | 'mcp_call'
  | 'mcp_result'
  | 'subagent_start'
  | 'subagent_complete'
  | 'stream'
  | 'thinking'
  | 'action'
  | 'observation';

export interface ExecutionEvent {
  event_type: ExecutionEventType;
  agent_id?: string;
  agent_name?: string;
  agent_type?: string;
  content?: string;
  content_type?: string;
  delta?: {
    content?: string;
    reasoning_content?: string;
  };
  message?:{
    role: string;
    content?: string;
    reasoning_content?: string;
  };
  tool_name?: string;
  tool_args?: Record<string, any>;
  tool_result?: string;
  tool_call_id?: string;
  skill_name?: string;
  skill_args?: Record<string, any>;
  skill_result?: string;
  skill_call_id?: string;
  mcp_name?: string;
  mcp_args?: Record<string, any>;
  mcp_result?: string;
  mcp_call_id?: string;
  mcp_server?: string;
  subagent_id?: string;
  subagent_name?: string;
  subagent_type?: string;
  subagent_input?: string;
  subagent_output?: string;
  status?:'pending' | 'running' | 'success' | 'error' | 'completed' | 'stopped' | 'cancelled';
  error?: string;
  timestamp: string;
  start_time?: string;
  end_time?: string;
  duration_ms?: number;
  metadata?: Record<string, any>;
  data?: Record<string, any>;
}

export interface WebSocketMessage {
  type: string;
  data: any;
  session_id: string;
  timestamp: number;
  message?: {
    role: string;
    content?: string;
    reasoning_content?: string;
  };
}

interface UseRunWebSocketOptions {
  agenticFlowId: string | null;
  sessionId: string | null;
  runProjectId: string | null;
  onMessage?: (message: WebSocketMessage) => void;
  onEvent?: (event: ExecutionEvent) => void;
  onError?: (error: Event) => void;
  onClose?: (event: CloseEvent) => void;
  autoReconnect?: boolean;
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
}

export const useRunWebSocket = (options: UseRunWebSocketOptions) => {
  const {
    agenticFlowId,
    sessionId,
    runProjectId,
    autoReconnect = true,
    reconnectInterval = 3000,
    maxReconnectAttempts = 10,
  } = options;

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heartbeatIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const heartbeatTimeoutRef = useRef<ReturnType<typeof setInterval> | null>(null);  // 心跳超时检测定时器
  const lastPongTimeRef = useRef<number>(Date.now());  // 最后一次收到pong的时间
  const connectionKeyRef = useRef<string>('');
  const messageQueueRef = useRef<Array<{
    type: string;
    data: any;
    resolve: (success: boolean) => void;
  }>>([]);
  const isReconnectingRef = useRef<boolean>(false);
  const [isConnected, setIsConnected] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'disconnected' | 'connecting' | 'connected' | 'error'>('disconnected');
  
  const onMessageRef = useRef(options.onMessage);
  const onEventRef = useRef(options.onEvent);
  const onErrorRef = useRef(options.onError);
  const onCloseRef = useRef(options.onClose);

  useEffect(() => {
    onMessageRef.current = options.onMessage;
    onEventRef.current = options.onEvent;
    onErrorRef.current = options.onError;
    onCloseRef.current = options.onClose;
  }, [options.onMessage, options.onEvent, options.onError, options.onClose]);

  const startHeartbeat = useCallback(() => {
    if (heartbeatIntervalRef.current) {
      clearInterval(heartbeatIntervalRef.current);
    }
    heartbeatIntervalRef.current = setInterval(() => {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'ping' }));
      }
    }, 15000);
    
    // 启动心跳超时检测（每10秒检查一次，如果45秒内没有收到pong则认为连接断开）
    if (heartbeatTimeoutRef.current) {
      clearInterval(heartbeatTimeoutRef.current);
    }
    lastPongTimeRef.current = Date.now();
    heartbeatTimeoutRef.current = setInterval(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        const timeSinceLastPong = Date.now() - lastPongTimeRef.current;
        const HEARTBEAT_TIMEOUT = 45000;  // 45秒超时（3倍心跳间隔）
        
        if (timeSinceLastPong > HEARTBEAT_TIMEOUT) {
          console.warn(`[WebSocket] Heartbeat timeout! Last pong was ${Math.round(timeSinceLastPong/1000)}s ago, reconnecting...`);
          // 关闭当前连接，触发重连机制
          if (wsRef.current) {
            wsRef.current.close(4000, 'Heartbeat timeout');
            wsRef.current = null;
          }
        }
      }
    }, 10000);  // 每10秒检查一次
  }, []);

  const stopHeartbeat = useCallback(() => {
    if (heartbeatIntervalRef.current) {
      clearInterval(heartbeatIntervalRef.current);
      heartbeatIntervalRef.current = null;
    }
    if (heartbeatTimeoutRef.current) {  // 停止心跳超时检测
      clearInterval(heartbeatTimeoutRef.current);
      heartbeatTimeoutRef.current = null;
    }
  }, []);

  const disconnect = useCallback((preventReconnect: boolean = false) => {
    stopHeartbeat();
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (preventReconnect) {
      reconnectAttemptsRef.current = maxReconnectAttempts;
    }
    
    isReconnectingRef.current = false;
    messageQueueRef.current = [];
    
    if (wsRef.current) {
      wsRef.current.close(1000, 'User disconnected');
      wsRef.current = null;
    }
    setIsConnected(false);
    setConnectionStatus('disconnected');
  }, [maxReconnectAttempts, stopHeartbeat]);

  const connect = useCallback(() => {
    if (!agenticFlowId || !sessionId || !runProjectId) {
      console.log('Missing required parameters for WebSocket connection:', {
        agenticFlowId,
        sessionId,
        runProjectId,
      });
      return;
    }

    const token = localStorage.getItem('access_token');
    if (!token) {
      console.error('No access token found');
      return;
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const wsUrl = `${protocol}//${host}/api/v1/run/ws/${agenticFlowId}/${sessionId}/${runProjectId}?token=${token}`;

    if (wsRef.current) {
      if (wsRef.current.readyState === WebSocket.OPEN) {
        const currentUrl = wsRef.current.url;
        if (currentUrl === wsUrl) {
          return;
        }
        wsRef.current.close(1000, 'Session changed');
        wsRef.current = null;
      } else if (wsRef.current.readyState === WebSocket.CONNECTING) {
        wsRef.current.close(1000, 'Session changed');
        wsRef.current = null;
      }
    }

    setConnectionStatus('connecting');

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('WebSocket connected');
        setIsConnected(true);
        setConnectionStatus('connected');
        reconnectAttemptsRef.current = 0;
        isReconnectingRef.current = false;

        ws.send(JSON.stringify({ type: 'ping' }));
        startHeartbeat();
        
        while (messageQueueRef.current.length > 0) {
          const item = messageQueueRef.current.shift();
          if (item && ws.readyState === WebSocket.OPEN) {
            try {
              ws.send(JSON.stringify({ type: item.type, ...item.data }));
              item.resolve(true);
            } catch (error) {
              console.error('Failed to send queued message:', error);
              item.resolve(false);
            }
          }
        }
      };

      ws.onmessage = (event) => {
        try {
          const message: WebSocketMessage = JSON.parse(event.data);

          if (message.type === 'pong') {
            lastPongTimeRef.current = Date.now();  // 更新最后收到pong的时间
            return;
          }

          if (message.type === 'stream') {
            const streamEvent: ExecutionEvent = {
              event_type: 'stream',
              delta: (message as any).delta,
              agent_id: (message as any).agent_id,
              agent_name: (message as any).agent_name,
              timestamp: (message as any).timestamp || new Date().toISOString(),
            };
            onEventRef.current?.(streamEvent);
            return;
          }

          if (message.type === 'execution_complete') {
            const completeEvent: ExecutionEvent = {
              event_type: 'execution_complete',
              message: (message as any).message,
              data: (message as any).data,
              timestamp: (message as any).timestamp || new Date().toISOString(),
            };
            onEventRef.current?.(completeEvent);
            return;
          }

          if (message.type === 'execution_event') {
            const execEvent: ExecutionEvent = message.data;
            onEventRef.current?.(execEvent);
            return;
          }

          if (message.type === 'execution_stopped') {
            const stoppedEvent: ExecutionEvent = {
              event_type: 'execution_error',
              status: 'stopped',
              error: 'Execution stopped by user',
              timestamp: (message as any).timestamp || new Date().toISOString(),
            };
            onEventRef.current?.(stoppedEvent);
            return;
          }

          if (message.type === 'execution_cancelled') {
            const cancelledEvent: ExecutionEvent = {
              event_type: 'execution_cancelled',
              status: 'cancelled',
              error: 'Execution cancelled',
              timestamp: (message as any).timestamp || new Date().toISOString(),
            };
            onEventRef.current?.(cancelledEvent);
            return;
          }

          onMessageRef.current?.(message);
        } catch (err) {
          console.error('Failed to parse WebSocket message:', err);
        }
      };

      ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        setConnectionStatus('error');
        onErrorRef.current?.(error);
      };

      ws.onclose = (event) => {
        console.log('WebSocket closed:', event.code, event.reason);
        setIsConnected(false);
        setConnectionStatus('disconnected');
        wsRef.current = null;
        stopHeartbeat();

        onCloseRef.current?.(event);

        if (autoReconnect && reconnectAttemptsRef.current < maxReconnectAttempts) {
          reconnectAttemptsRef.current++;
          
          let delay = 0;
          if (reconnectAttemptsRef.current > 1) {
            delay = Math.min(reconnectInterval * Math.pow(2, reconnectAttemptsRef.current - 2), 30000);
          }
          
          isReconnectingRef.current = true;
          console.log(`Reconnecting... Attempt ${reconnectAttemptsRef.current}/${maxReconnectAttempts} in ${delay}ms`);
          reconnectTimeoutRef.current = setTimeout(() => {
            connect();
          }, delay);
        } else {
          isReconnectingRef.current = false;
        }
      };
    } catch (error) {
      console.error('Failed to create WebSocket:', error);
      setConnectionStatus('error');
    }
  }, [agenticFlowId, sessionId, runProjectId, autoReconnect, maxReconnectAttempts, reconnectInterval, startHeartbeat, stopHeartbeat]);

  const send = useCallback((type: string, data: any) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type, ...data }));
      return true;
    }
    return false;
  }, []);

  const sendWithRetry = useCallback((
    type: string, 
    data: any, 
    maxRetries: number = 3,
    retryDelay: number = 500
  ): Promise<boolean> => {
    return new Promise((resolve) => {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        try {
          wsRef.current.send(JSON.stringify({ type, ...data }));
          resolve(true);
        } catch (error) {
          console.error('WebSocket send error:', error);
          resolve(false);
        }
        return;
      }
      
      if (wsRef.current && wsRef.current.readyState === WebSocket.CONNECTING) {
        messageQueueRef.current.push({ type, data, resolve });
        return;
      }
      
      messageQueueRef.current.push({ type, data, resolve });
      
      if (autoReconnect && !isReconnectingRef.current) {
        isReconnectingRef.current = true;
        connect();
      }
    });
  }, [autoReconnect, connect]);

  const executeFlow = useCallback(async (
    canvasData: any, 
    inputMessage: string, 
    agenticFlowId?: string,
    sessionId?: string,
    runProjectId?: string
  ) => {
    return sendWithRetry('execute', {
      canvas_data: canvasData,
      input_message: inputMessage,
      agentic_flow_id: agenticFlowId,
      session_id: sessionId,
      run_project_id: runProjectId,
    });
  }, [sendWithRetry]);

  const stopFlow = useCallback(async () => {
    console.log('[WebSocket] Sending stop request...');
    return sendWithRetry('stop', {});
  }, [sendWithRetry]);

  useEffect(() => {
    const connectionKey = `${agenticFlowId}:${sessionId}:${runProjectId}`;
    
    if (agenticFlowId && sessionId && runProjectId) {
      if (connectionKeyRef.current !== connectionKey) {
        if (connectionKeyRef.current) {
          disconnect(true);
        }
        connectionKeyRef.current = connectionKey;
        connect();
      }
    }

    return () => {
      if (connectionKeyRef.current) {
        disconnect(true);
        connectionKeyRef.current = '';
      }
    };
  }, [agenticFlowId, sessionId, runProjectId, connect, disconnect]);

  return {
    isConnected,
    connectionStatus,
    connect,
    disconnect,
    send,
    executeFlow,
    stopFlow,
  };
};

export default useRunWebSocket;
