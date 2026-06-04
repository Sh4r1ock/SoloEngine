import { useEffect, useRef } from 'react';
import { WEBSOCKET_CONFIG } from '../config/websocket';

export interface FileSystemChange {
  file_path: string;
  operation: 'created' | 'deleted' | 'modified' | 'moved';
  is_directory: boolean;
  dest_path?: string;
}

/**
 * 项目级文件监听 Hook
 *
 * 当 projectId 非空时，连接到后端项目监听 WebSocket 端点，
 * 实时接收文件系统变化事件（创建、删除、修改、移动）。
 *
 * 复用 WEBSOCKET_CONFIG 中的心跳参数，projectId 变化或组件卸载时自动断开重连。
 */
export const useProjectWatcher = (
  projectId: string | null,
  onFileChange: (changes: FileSystemChange[]) => void
) => {
  const wsRef = useRef<WebSocket | null>(null);
  const onChangeRef = useRef(onFileChange);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptsRef = useRef(0);
  const intentionalCloseRef = useRef(false);
  const projectIdRef = useRef(projectId);

  useEffect(() => {
    onChangeRef.current = onFileChange;
  }, [onFileChange]);

  useEffect(() => {
    projectIdRef.current = projectId;
  }, [projectId]);

  useEffect(() => {
    if (!projectId) return;

    intentionalCloseRef.current = false;
    attemptsRef.current = 0;

    const connect = () => {
      if (intentionalCloseRef.current) return;
      if (projectIdRef.current !== projectId) return;

      const token = localStorage.getItem('access_token');
      if (!token) return;

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const host = window.location.host;
      const isDev = host.includes(':8991');
      const wsHost = isDev ? 'localhost:8990' : host;
      const wsUrl = `${protocol}//${wsHost}/api/v1/run-project/ws/watch/${projectId}?token=${token}`;

      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        attemptsRef.current = 0;
        ws.send(JSON.stringify({ type: 'ping' }));

        if (heartbeatRef.current) clearInterval(heartbeatRef.current);
        heartbeatRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'ping' }));
          }
        }, WEBSOCKET_CONFIG.HEARTBEAT_INTERVAL_MS);
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'file_system_event' && msg.changes) {
            onChangeRef.current(msg.changes);
          }
        } catch {
          // ignore parse errors
        }
      };

      ws.onclose = () => {
        if (heartbeatRef.current) {
          clearInterval(heartbeatRef.current);
          heartbeatRef.current = null;
        }
        if (!intentionalCloseRef.current && projectIdRef.current === projectId) {
          attemptsRef.current += 1;
          if (attemptsRef.current <= WEBSOCKET_CONFIG.MAX_RECONNECT_ATTEMPTS) {
            const delay = Math.min(
              WEBSOCKET_CONFIG.RECONNECT_INTERVAL_MS * Math.pow(2, attemptsRef.current - 1),
              WEBSOCKET_CONFIG.MAX_RECONNECT_DELAY_MS
            );
            reconnectRef.current = setTimeout(connect, delay);
          }
        }
      };

      ws.onerror = () => {
        // onclose will handle reconnection
      };
    };

    connect();

    return () => {
      intentionalCloseRef.current = true;
      if (heartbeatRef.current) {
        clearInterval(heartbeatRef.current);
        heartbeatRef.current = null;
      }
      if (reconnectRef.current) {
        clearTimeout(reconnectRef.current);
        reconnectRef.current = null;
      }
      if (wsRef.current) {
        wsRef.current.close(1000, 'Component unmounted');
        wsRef.current = null;
      }
    };
  }, [projectId]);
};
