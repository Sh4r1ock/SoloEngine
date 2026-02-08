import { WebSocketEvent } from '../types/canvas';

export class WebSocketService {
  private ws: WebSocket | null = null;
  private taskId: string | null = null;
  private messageHandlers: ((event: WebSocketEvent) => void)[] = [];

  connect(taskId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.taskId = taskId;
      const wsUrl = `ws://localhost:8000/api/v1/ws/${taskId}`;
      
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        console.log('WebSocket connected');
        resolve();
      };

      this.ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        this.messageHandlers.forEach(handler => handler(data));
      };

      this.ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        reject(error);
      };

      this.ws.onclose = () => {
        console.log('WebSocket disconnected');
      };
    });
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.taskId = null;
    this.messageHandlers = [];
  }

  send(data: any) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  onMessage(handler: (event: WebSocketEvent) => void) {
    this.messageHandlers.push(handler);
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
