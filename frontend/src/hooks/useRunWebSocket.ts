/**
 * @file useRunWebSocket.ts
 * @description WebSocket Hook - 运行面板实时通信
 * @author SoloEngine Team
 * @date 2026-02-24
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import { useRunStore } from '../store/runStore';

export type ExecutionEventType =
  | 'execution_start'
  | 'execution_complete'
  | 'execution_error'
  | 'agent_start'
  | 'agent_complete'
  | 'agent_error'
  | 'tool_call'
  | 'tool_result'
  | 'skill_call'
  | 'skill_result'
  | 'mcp_call'
  | 'mcp_result'
  | 'child_agent_start'
  | 'child_agent_complete'
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
  child_agent_id?: string;
  child_agent_name?: string;
  child_agent_type?: string;
  child_agent_input?: string;
  child_agent_output?: string;
  status?: 'pending' | 'running' | 'success' | 'error' | 'completed';
  error?: string;
  timestamp: string;
  start_time?: string;
  end_time?: string;
  duration_ms?: number;
  metadata?: Record<string, any>;
}

export interface WebSocketMessage {
  type: string;
  data: any;
  session_id: string;
  timestamp: number;
}

interface UseRunWebSocketOptions {
  sessionId: string | null;
  onMessage?: (message: WebSocketMessage) => void;
  onEvent?: (event: ExecutionEvent) => void;
  onStream?: (content: string) => void;
  onError?: (error: Event) => void;
  onClose?: (event: CloseEvent) => void;
  autoReconnect?: boolean;
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
}

export const useRunWebSocket = (options: UseRunWebSocketOptions) => {
  const {
    sessionId,
    autoReconnect = true,
    reconnectInterval = 3000,
    maxReconnectAttempts = 5,
  } = options;

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'disconnected' | 'connecting' | 'connected' | 'error'>('disconnected');
  
  const onMessageRef = useRef(options.onMessage);
  const onEventRef = useRef(options.onEvent);
  const onStreamRef = useRef(options.onStream);
  const onErrorRef = useRef(options.onError);
  const onCloseRef = useRef(options.onClose);

  useEffect(() => {
    onMessageRef.current = options.onMessage;
    onEventRef.current = options.onEvent;
    onStreamRef.current = options.onStream;
    onErrorRef.current = options.onError;
    onCloseRef.current = options.onClose;
  });

  const { addSession } = useRunStore();

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    reconnectAttemptsRef.current = maxReconnectAttempts;
    
    if (wsRef.current) {
      wsRef.current.close(1000, 'User disconnected');
      wsRef.current = null;
    }
    setIsConnected(false);
    setConnectionStatus('disconnected');
  }, [maxReconnectAttempts]);

  const connect = useCallback(() => {
    if (!sessionId) return;

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      return;
    }

    const token = localStorage.getItem('access_token');
    if (!token) {
      console.error('No access token found');
      return;
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const wsUrl = `${protocol}//${host}/api/v1/run/ws/${sessionId}?token=${token}`;

    setConnectionStatus('connecting');

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('WebSocket connected');
        setIsConnected(true);
        setConnectionStatus('connected');
        reconnectAttemptsRef.current = 0;

        ws.send(JSON.stringify({ type: 'ping' }));
      };

      ws.onmessage = (event) => {
        try {
          const message: WebSocketMessage = JSON.parse(event.data);

          if (message.type === 'pong') {
            return;
          }

          if (message.type === 'execution_result') {
            onMessageRef.current?.(message);
          } else if (message.type === 'execution_event') {
            const execEvent: ExecutionEvent = message.data;
            onEventRef.current?.(execEvent);

            if (execEvent.event_type === 'stream') {
              onStreamRef.current?.(execEvent.content || '');
            }
          } else if (message.type === 'stream') {
            onStreamRef.current?.(message.data);
          } else {
            onMessageRef.current?.(message);
          }
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

        onCloseRef.current?.(event);

        if (autoReconnect && reconnectAttemptsRef.current < maxReconnectAttempts) {
          reconnectAttemptsRef.current++;
          console.log(`Reconnecting... Attempt ${reconnectAttemptsRef.current}/${maxReconnectAttempts}`);
          reconnectTimeoutRef.current = setTimeout(() => {
            connect();
          }, reconnectInterval);
        }
      };
    } catch (error) {
      console.error('Failed to create WebSocket:', error);
      setConnectionStatus('error');
    }
  }, [sessionId, autoReconnect, maxReconnectAttempts, reconnectInterval]);

  const send = useCallback((type: string, data: any) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type, ...data }));
      return true;
    }
    return false;
  }, []);

  const executeFlow = useCallback((canvasData: any, inputMessage: string, flowId?: string) => {
    return send('execute', {
      canvas_data: canvasData,
      input_message: inputMessage,
      flow_id: flowId,
    });
  }, [send]);

  useEffect(() => {
    if (sessionId) {
      connect();
    }

    return () => {
      disconnect();
    };
  }, [sessionId]);

  return {
    isConnected,
    connectionStatus,
    connect,
    disconnect,
    send,
    executeFlow,
  };
};

export default useRunWebSocket;
