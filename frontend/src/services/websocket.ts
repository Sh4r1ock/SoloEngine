import { WebSocketEvent } from '../types/canvas';

export class WebSocketService {
  private ws: WebSocket | null = null;
  private messageHandlers: ((event: WebSocketEvent) => void)[] = [];
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 3;

  connect(taskId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        console.log('WebSocket already connected');
        resolve();
        return;
      }
      
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const host = window.location.host;
      const token = localStorage.getItem('access_token');
      const wsUrl = `${protocol}//${host}/api/v1/ws/${taskId}?token=${token}`;
      
      console.log('Connecting to WebSocket:', wsUrl);
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        console.log('WebSocket connected');
        this.reconnectAttempts = 0;
        resolve();
      };

      this.ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        console.log('WebSocket message received:', data.type);
        this.messageHandlers.forEach(handler => handler(data));
      };

      this.ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        reject(error);
      };

      this.ws.onclose = (event) => {
        console.log('WebSocket disconnected, code:', event.code, 'reason:', event.reason);
      };
    });
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.messageHandlers = [];
  }

  send(data: any) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      console.log('WebSocket sending:', data.type);
      this.ws.send(JSON.stringify(data));
    } else {
      console.error('WebSocket is not connected, readyState:', this.ws?.readyState);
    }
  }

  onMessage(handler: (event: WebSocketEvent) => void): () => void {
    this.messageHandlers.push(handler);
    
    return () => {
      this.offMessage(handler);
    };
  }

  offMessage(handler: (event: WebSocketEvent) => void) {
    const index = this.messageHandlers.indexOf(handler);
    if (index > -1) {
      this.messageHandlers.splice(index, 1);
    }
  }

  startExecution(projectId: string, input: string) {
    this.send({
      type: 'execution-start',
      project_id: projectId,
      input: input,
    });
  }

  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }
}

export const wsService = new WebSocketService();
