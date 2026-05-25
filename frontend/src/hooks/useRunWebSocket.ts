import { useEffect, useRef, useCallback, useState } from 'react';
import { WEBSOCKET_CONFIG } from '../config/websocket';

export type ExecutionEventType =
  | 'execution_start'
  | 'execution_complete'
  | 'execution_error'
  | 'execution_cancelled'
  | 'execution_stopped'
  | 'message_ids_updated'
  | 'agent_start'
  | 'agent_complete'
  | 'agent_error'
  | 'tool_call'
  | 'tool_result'
  | 'subagent_start'
  | 'subagent_complete'
  | 'stream'
  | 'thinking'
  | 'action'
  | 'observation'
  | 'file_change_preview'
  | 'file_changes_ready'
  | 'file_system_event';

export interface FileChange {
  file_path: string;
  operation: 'created' | 'modified' | 'deleted';
  content_type: 'text' | 'binary';
  tool_call_id?: string;
  diff?: {
    lines_added: number;
    lines_removed: number;
  };
}

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
  tool_type?: 'tool' | 'skill' | 'mcp' | 'subagent';
  tool_args?: Record<string, any>;
  tool_result?: any;
  tool_call_id?: string;
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
  user_message_id?: string;
  file_changes?: FileChange[] | null;
  tokens?: Record<string, number> | null;
  message_ids?: Record<string, string>;
}

export interface WebSocketMessage {
  type: string;
  data: any;
  session_id: string;
  timestamp: number;
  user_message_id?: string;
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
  heartbeatInterval?: number;
  heartbeatTimeout?: number;
  heartbeatCheckInterval?: number;
  maxReconnectDelay?: number;
}

export const useRunWebSocket = (options: UseRunWebSocketOptions) => {
  const {
    agenticFlowId,
    sessionId,
    runProjectId,
    autoReconnect = true,
    reconnectInterval = WEBSOCKET_CONFIG.RECONNECT_INTERVAL_MS,
    maxReconnectAttempts = WEBSOCKET_CONFIG.MAX_RECONNECT_ATTEMPTS,
    heartbeatInterval = WEBSOCKET_CONFIG.HEARTBEAT_INTERVAL_MS,
    heartbeatTimeout = WEBSOCKET_CONFIG.HEARTBEAT_TIMEOUT_MS,
    heartbeatCheckInterval = WEBSOCKET_CONFIG.HEARTBEAT_CHECK_INTERVAL_MS,
    maxReconnectDelay = WEBSOCKET_CONFIG.MAX_RECONNECT_DELAY_MS,
  } = options;

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heartbeatIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const heartbeatTimeoutRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastPongTimeRef = useRef<number>(Date.now());
  const connectionKeyRef = useRef<string>('');
  const messageQueueRef = useRef<Array<{
    type: string;
    data: any;
    resolve: (success: boolean) => void;
  }>>([]);
  const isReconnectingRef = useRef<boolean>(false);
  const isIntentionalCloseRef = useRef<boolean>(false);
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
    }, heartbeatInterval);
    
    if (heartbeatTimeoutRef.current) {
      clearInterval(heartbeatTimeoutRef.current);
    }
    lastPongTimeRef.current = Date.now();
    heartbeatTimeoutRef.current = setInterval(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        const timeSinceLastPong = Date.now() - lastPongTimeRef.current;
        
        if (timeSinceLastPong > heartbeatTimeout) {
          console.warn(`[WebSocket] Heartbeat timeout! Last pong was ${Math.round(timeSinceLastPong/1000)}s ago, reconnecting...`);
          if (wsRef.current) {
            wsRef.current.close(4000, 'Heartbeat timeout');
            wsRef.current = null;
          }
        }
      }
    }, heartbeatCheckInterval);
  }, [heartbeatInterval, heartbeatTimeout, heartbeatCheckInterval]);

  const stopHeartbeat = useCallback(() => {
    if (heartbeatIntervalRef.current) {
      clearInterval(heartbeatIntervalRef.current);
      heartbeatIntervalRef.current = null;
    }
    if (heartbeatTimeoutRef.current) {
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
      isIntentionalCloseRef.current = true;
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

  const connect = useCallback((isReconnect: boolean = false) => {
    if (!isReconnect) {
      reconnectAttemptsRef.current = 0;
      isReconnectingRef.current = false;
    }

    if (!agenticFlowId || !sessionId || !runProjectId) {
      return;
    }

    const token = localStorage.getItem('access_token');
    if (!token) {
      console.error('No access token found');
      return;
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const isDev = host.includes(':8991');
    const wsHost = isDev ? 'localhost:8990' : host;
    const wsUrl = `${protocol}//${wsHost}/api/v1/run/ws/${agenticFlowId}/${sessionId}/${runProjectId}?token=${token}`;

    if (wsRef.current) {
      if (wsRef.current.readyState === WebSocket.OPEN) {
        const currentUrl = wsRef.current.url;
        if (currentUrl === wsUrl) {
          return;
        }
        isIntentionalCloseRef.current = true;
        wsRef.current.close(1000, 'Session changed');
        wsRef.current = null;
      } else if (wsRef.current.readyState === WebSocket.CONNECTING) {
        isIntentionalCloseRef.current = true;
        wsRef.current.close(1000, 'Session changed');
        wsRef.current = null;
      }
    }

    setConnectionStatus('connecting');

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setIsConnected(true);
        setConnectionStatus('connected');
        reconnectAttemptsRef.current = 0;
        isIntentionalCloseRef.current = false;
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
            lastPongTimeRef.current = Date.now();
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

          if (message.type === 'execution_event') {
            const eventData = (message as any).data;
            const executionEvent: ExecutionEvent = {
              ...eventData,
              timestamp: eventData?.timestamp || (message as any).timestamp || new Date().toISOString(),
            };
            onEventRef.current?.(executionEvent);
            return;
          }

          if (message.type === 'message_ids_updated') {
            const idsEvent: ExecutionEvent = {
              event_type: 'message_ids_updated' as ExecutionEventType,
              message_ids: (message as any).message_ids,
              timestamp: (message as any).timestamp || new Date().toISOString(),
            } as ExecutionEvent;
            onEventRef.current?.(idsEvent);
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
        if (!isReconnectingRef.current) {
          setConnectionStatus('error');
        }
        onErrorRef.current?.(error);
      };

      ws.onclose = (event) => {
        if (wsRef.current !== ws) {
          return;
        }

        setIsConnected(false);
        wsRef.current = null;
        stopHeartbeat();

        const isIntentional = isIntentionalCloseRef.current;
        isIntentionalCloseRef.current = false;

        const isNormalClose = event.code === 1000 || event.code === 1001 || event.code === 1005;

        if (!isIntentional && !isNormalClose && onEventRef.current) {
          onEventRef.current({
            event_type: 'execution_error',
            status: 'disconnected',
            error: `WebSocket连接断开 (code: ${event.code})`,
            timestamp: new Date().toISOString(),
          } as any);
        }

        if (autoReconnect && !isIntentional && !isNormalClose && reconnectAttemptsRef.current < maxReconnectAttempts) {
          setConnectionStatus('connecting');
          reconnectAttemptsRef.current++;
          
          let delay = reconnectInterval;
          if (reconnectAttemptsRef.current > 1) {
            delay = Math.min(reconnectInterval * Math.pow(2, reconnectAttemptsRef.current - 2), maxReconnectDelay);
          }
          if (event.code === 1006) {
            delay = Math.max(delay, 2000);
          }
          
          isReconnectingRef.current = true;
          reconnectTimeoutRef.current = setTimeout(() => {
            connect(true);
          }, delay);
        } else {
          setConnectionStatus('disconnected');
          isReconnectingRef.current = false;
        }

        onCloseRef.current?.(event);
      };
    } catch (error) {
      console.error('Failed to create WebSocket:', error);
      setConnectionStatus('error');
    }
  }, [agenticFlowId, sessionId, runProjectId, autoReconnect, maxReconnectAttempts, reconnectInterval, maxReconnectDelay, startHeartbeat, stopHeartbeat]);

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
      
      const totalTimeout = retryDelay * (maxRetries + 1);
      let timedOut = false;
      let queueItem: { type: string; data: any; resolve: (success: boolean) => void } | null = null;

      const timeoutId = setTimeout(() => {
        timedOut = true;
        if (queueItem) {
          const idx = messageQueueRef.current.indexOf(queueItem);
          if (idx >= 0) {
            messageQueueRef.current.splice(idx, 1);
          }
        }
        resolve(false);
      }, totalTimeout);

      const wrappedResolve = (success: boolean) => {
        if (timedOut) return;
        clearTimeout(timeoutId);
        resolve(success);
      };

      if (wsRef.current && wsRef.current.readyState === WebSocket.CONNECTING) {
        queueItem = { type, data, resolve: wrappedResolve };
        messageQueueRef.current.push(queueItem);
        return;
      }
      
      queueItem = { type, data, resolve: wrappedResolve };
      messageQueueRef.current.push(queueItem);
      
      if (autoReconnect && !isReconnectingRef.current) {
        isReconnectingRef.current = true;
        connect(true);
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
