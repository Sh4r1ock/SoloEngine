import React, { useState } from 'react';
import { Modal, Input, Button, Space, Alert, Spin, Typography } from 'antd';
import { PlayCircleOutlined, StopOutlined } from '@ant-design/icons';
import { useCanvasStore } from '../../store/canvasStore';
import { projectApi } from '../../services/api';
import { wsService } from '../../services/websocket';
import { WebSocketEvent } from '../../types/canvas';

const { TextArea } = Input;
const { Text, Paragraph } = Typography;

interface PreviewProps {
  visible: boolean;
  onClose: () => void;
}

const Preview: React.FC<PreviewProps> = ({ visible, onClose }) => {
  const { currentProject } = useCanvasStore();
  const [input, setInput] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [logs, setLogs] = useState<WebSocketEvent[]>([]);
  const [showLogs, setShowLogs] = useState(false);

  const handleStart = async () => {
    if (!currentProject) {
      return;
    }

    setIsRunning(true);
    setLogs([]);
    setShowLogs(true);

    try {
      const result = await projectApi.runProject(currentProject.id, input);
      const newSessionId = result.session_id;

      await wsService.connect(newSessionId);

      wsService.onMessage((event: WebSocketEvent) => {
        setLogs((prev) => [...prev, event]);

        if (event.type === 'execution-complete' || event.type === 'error') {
          setIsRunning(false);
          wsService.disconnect();
        }
      });

      wsService.startExecution(currentProject.id, input);
    } catch (error) {
      console.error('Execution error:', error);
      setIsRunning(false);
    }
  };

  const handleStop = () => {
    setIsRunning(false);
    wsService.disconnect();
  };

  const handleClear = () => {
    setLogs([]);
  };

  return (
    <Modal
      title="实时预览与调试"
      open={visible}
      onCancel={onClose}
      width={800}
      footer={null}
    >
      <Space direction="vertical" style={{ width: '100%' }}>
        <div>
          <Text strong>用户输入：</Text>
          <TextArea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="请输入任务描述..."
            rows={3}
            disabled={isRunning}
          />
        </div>

        <Space>
          <Button
            type="primary"
            icon={<PlayCircleOutlined />}
            onClick={handleStart}
            disabled={isRunning || !currentProject}
          >
            开始执行
          </Button>
          <Button
            icon={<StopOutlined />}
            onClick={handleStop}
            disabled={!isRunning}
          >
            停止执行
          </Button>
          <Button onClick={handleClear} disabled={isRunning}>
            清空日志
          </Button>
        </Space>

        {showLogs && (
          <div style={{ 
            maxHeight: 400, 
            overflowY: 'auto', 
            border: '1px solid #cccccc', 
            borderRadius: 8, 
            padding: 12,
            backgroundColor: '#f5f5f5'
          }}>
            {isRunning && (
              <div style={{ textAlign: 'center', marginBottom: 16 }}>
                <Spin tip="执行中...">
                  <div style={{ padding: 20 }} />
                </Spin>
              </div>
            )}

            {logs.length === 0 && !isRunning && (
              <Text type="secondary">暂无日志</Text>
            )}

            {logs.map((log, index) => (
              <Alert
                key={index}
                message={
                  <div>
                    <Text strong>{log.type}</Text>
                    {log.node_id && <Text type="secondary"> - 节点: {log.node_id}</Text>}
                    {log.status && <Text type="secondary"> - 状态: {log.status}</Text>}
                  </div>
                }
                description={
                  <div>
                    {log.message && <Paragraph>{log.message}</Paragraph>}
                    {log.result && (
                      <pre style={{ fontSize: 12, maxHeight: 200, overflow: 'auto', backgroundColor: '#f5f5f5', padding: 8, borderRadius: 4 }}>
                        {JSON.stringify(log.result, null, 2)}
                      </pre>
                    )}
                  </div>
                }
                type={
                  log.type === 'error'
                    ? 'error'
                    : log.type === 'execution-complete'
                    ? 'success'
                    : 'info'
                }
                style={{ marginBottom: 8 }}
              />
            ))}
          </div>
        )}
      </Space>
    </Modal>
  );
};

export default Preview;
