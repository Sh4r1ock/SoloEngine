import React, { useState, useRef } from 'react';
import { Modal, Input, Button, Space, Alert, Spin, Typography } from 'antd';
import { PlayCircleOutlined, StopOutlined } from '@ant-design/icons';
import { useCanvasStore } from '../../store/canvasStore';
import { agenticFlowApi } from '../../services/agenticFlowApi';
import { runApi } from '../../services/runApi';

const { TextArea } = Input;
const { Text, Paragraph } = Typography;

interface PreviewProps {
  visible: boolean;
  onClose: () => void;
}

interface PreviewLog {
  type: 'stream' | 'execution_complete' | 'error' | 'status';
  delta?: any;
  result?: any;
  message?: string;
  status?: string;
  timestamp: string;
}

const Preview: React.FC<PreviewProps> = ({ visible, onClose }) => {
  const { currentProject } = useCanvasStore();
  const [input, setInput] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [logs, setLogs] = useState<PreviewLog[]>([]);
  const [showLogs, setShowLogs] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  const handleStart = async () => {
    if (!currentProject) {
      return;
    }

    setIsRunning(true);
    setLogs([]);
    setShowLogs(true);
    // 每次开始执行前创建新的 AbortController
    abortControllerRef.current = new AbortController();

    try {
      const canvasData = await agenticFlowApi.getCanvas(currentProject.id);

      await runApi.executeWorkflowStream(
        canvasData,
        input,
        (delta) => {
          setLogs((prev) => [...prev, {
            type: 'stream',
            delta,
            timestamp: new Date().toISOString()
          }]);
        },
        (result) => {
          setLogs((prev) => [...prev, {
            type: 'execution_complete',
            result,
            timestamp: new Date().toISOString()
          }]);
          setIsRunning(false);
        },
        (error) => {
          setLogs((prev) => [...prev, {
            type: 'error',
            message: error,
            timestamp: new Date().toISOString()
          }]);
          setIsRunning(false);
        },
        currentProject.id,
        undefined,
        undefined,
        abortControllerRef.current?.signal,
      );
    } catch (error) {
      // 用户主动停止（AbortController.abort）时不显示错误日志
      if (error instanceof DOMException && error.name === 'AbortError') {
        setIsRunning(false);
        return;
      }
      console.error('Execution error:', error);
      setLogs((prev) => [...prev, {
        type: 'error',
        message: error instanceof Error ? error.message : '执行失败',
        timestamp: new Date().toISOString()
      }]);
      setIsRunning(false);
    }
  };

  const handleStop = () => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setIsRunning(false);
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
                    {log.status && <Text type="secondary"> - 状态: {log.status}</Text>}
                  </div>
                }
                description={
                  <div>
                    {log.message && <Paragraph>{log.message}</Paragraph>}
                    {log.delta && (
                      <pre style={{ fontSize: 12, maxHeight: 200, overflow: 'auto', backgroundColor: '#f5f5f5', padding: 8, borderRadius: 4 }}>
                        {JSON.stringify(log.delta, null, 2)}
                      </pre>
                    )}
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
                    : log.type === 'execution_complete'
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
