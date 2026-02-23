/**
 * @file DebugPanel.tsx
 * @description 调试面板主组件 - 工作流调试核心面板
 * @author SoloEngine Team
 * @date 2026-02-19
 */
import React, { useEffect, useState, useRef } from 'react';
import { Layout, Button, Space, Typography, Divider, message, Tabs, Card, Input, Select, Spin, List, Tag, Alert, Modal, Form, Switch, Slider } from 'antd';
import {
  PlayCircleOutlined,
  PauseCircleOutlined,
  StopOutlined,
  StepForwardOutlined,
  BugOutlined,
  RobotOutlined,
  MessageOutlined,
  CodeOutlined,
  FileTextOutlined,
  SendOutlined,
  ClearOutlined,
  GlobalOutlined,
  ReadOutlined,
  FolderOutlined,
} from '@ant-design/icons';
import { useDebugStore } from '../../store/debugStore';
import { debugApi } from '../../services/debugApi';
import { agentToolsApi } from '../../services/agentToolsApi';
import DebugSidebar from './DebugSidebar';
import ConversationHistory from './ConversationHistory';
import OperationRecords from './OperationRecords';
import DebugControls from './DebugControls';
import ProjectSelector from './ProjectSelector';
import FileExplorer from './FileExplorer';
import FileEditor from './FileEditor';
import { FileInfo } from '../../services/debugProjectApi';

const { Header, Content, Sider } = Layout;
const { Title, Text, Paragraph } = Typography;
const { TextArea } = Input;

interface LLMMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  tokens?: number;
}

interface BrowserAction {
  id: string;
  type: 'navigate' | 'click' | 'type' | 'scroll' | 'screenshot' | 'extract';
  description: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  result?: string;
  timestamp: string;
}

const DebugPanel: React.FC = () => {
  const {
    activeSessionId,
    sessions,
    isDebugging,
    isPaused,
    startDebugging,
    stopDebugging,
    pauseDebugging,
    resumeDebugging,
    stepOver,
    addSession,
  } = useDebugStore();

  const [ws, setWs] = useState<WebSocket | null>(null);
  const [activeTab, setActiveTab] = useState('files');
  
  const [llmMessages, setLlmMessages] = useState<LLMMessage[]>([]);
  const [llmInput, setLlmInput] = useState('');
  const [llmLoading, setLlmLoading] = useState(false);
  const [selectedModel, setSelectedModel] = useState('gpt-4');
  const [temperature, setTemperature] = useState(0.7);
  const [maxTokens, setMaxTokens] = useState(4096);
  
  const [browserActions, setBrowserActions] = useState<BrowserAction[]>([]);
  const [browserUrl, setBrowserUrl] = useState('');
  const [browserLoading, setBrowserLoading] = useState(false);
  
  const [editingFile, setEditingFile] = useState<FileInfo | null>(null);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const activeSession = activeSessionId
    ? sessions.find(s => s.id === activeSessionId)
    : null;

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [llmMessages]);

  const handleStartDebug = async () => {
    try {
      const response = await debugApi.startDebug({});
      if (response.code === 200) {
        const sessionId = response.data.session_id;
        addSession({
          id: sessionId,
          startTime: Date.now(),
          agentId: response.data.agent_id || 'default',
          agentName: response.data.agent_name || 'Default Agent',
          status: 'running',
        });
        startDebugging();
        message.success('调试会话已启动');

        const socket = debugApi.createDebugWebSocket(sessionId);
        setupWebSocket(socket);
      }
    } catch (error) {
      message.error('启动调试失败：' + String(error));
    }
  };

  const handleStopDebug = async () => {
    if (activeSessionId) {
      try {
        await debugApi.stopDebug(activeSessionId);
        stopDebugging();
        if (ws) {
          ws.close();
        }
        message.success('调试会话已停止');
      } catch (error) {
        message.error('停止调试失败：' + String(error));
      }
    }
  };

  const handlePauseResume = async () => {
    if (isPaused) {
      if (activeSessionId) {
        try {
          await debugApi.resumeDebug(activeSessionId);
          resumeDebugging();
        } catch (error) {
          message.error('继续调试失败：' + String(error));
        }
      }
    } else {
      if (activeSessionId) {
        try {
          await debugApi.pauseDebug(activeSessionId);
          pauseDebugging();
        } catch (error) {
          message.error('暂停调试失败：' + String(error));
        }
      }
    }
  };

  const handleStepOver = async () => {
    if (activeSessionId) {
      try {
        await debugApi.stepControl(activeSessionId, 'step_over');
        stepOver();
      } catch (error) {
        message.error('单步执行失败：' + String(error));
      }
    }
  };

  const setupWebSocket = (socket: WebSocket) => {
    socket.onopen = () => {
      console.log('调试 WebSocket 连接已建立');
    };

    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        handleMessage(data);
      } catch (error) {
        console.error('解析 WebSocket 消息失败：', error);
      }
    };

    socket.onerror = (error) => {
      console.error('WebSocket 错误：', error);
      message.error('调试连接错误');
    };

    socket.onclose = () => {
      console.log('调试 WebSocket 连接已关闭');
      stopDebugging();
    };

    setWs(socket);
  };

  const handleMessage = (data: any) => {
    const { type, message: msg, session_id, timestamp } = data;

    if (type === 'llm_message') {
      setLlmMessages(prev => [...prev, {
        id: `msg_${Date.now()}`,
        role: data.role,
        content: data.content,
        timestamp: timestamp || new Date().toISOString(),
        tokens: data.tokens,
      }]);
    }

    console.log('收到调试消息：', { type, msg, session_id, timestamp });
  };

  const handleSendLLMMessage = async () => {
    if (!llmInput.trim()) return;

    const userMessage: LLMMessage = {
      id: `msg_${Date.now()}`,
      role: 'user',
      content: llmInput,
      timestamp: new Date().toISOString(),
    };

    setLlmMessages(prev => [...prev, userMessage]);
    setLlmInput('');
    setLlmLoading(true);

    try {
      const conversationHistory = llmMessages.map(msg => ({
        role: msg.role,
        content: msg.content,
      }));

      const response = await agentToolsApi.llmChat({
        message: llmInput,
        model: selectedModel,
        temperature,
        max_tokens: maxTokens,
        conversation_history: conversationHistory,
      });

      if (response.code === 200) {
        const assistantMessage: LLMMessage = {
          id: `msg_${Date.now()}`,
          role: 'assistant',
          content: response.data.content,
          timestamp: new Date().toISOString(),
          tokens: response.data.tokens_used?.total_tokens || response.data.tokens_used?.completion_tokens,
        };
        setLlmMessages(prev => [...prev, assistantMessage]);
      } else {
        throw new Error('LLM请求失败');
      }
    } catch (error: any) {
      message.error('发送消息失败: ' + (error.message || '未知错误'));
      setLlmMessages(prev => prev.filter(m => m.id !== userMessage.id));
    } finally {
      setLlmLoading(false);
    }
  };

  const handleBrowserNavigate = async () => {
    if (!browserUrl.trim()) {
      message.warning('请输入URL');
      return;
    }

    setBrowserLoading(true);
    
    const action: BrowserAction = {
      id: `action_${Date.now()}`,
      type: 'navigate',
      description: `导航到: ${browserUrl}`,
      status: 'running',
      timestamp: new Date().toISOString(),
    };
    
    setBrowserActions(prev => [...prev, action]);

    try {
      const response = await agentToolsApi.browserNavigate({ url: browserUrl });
      
      if (response.code === 200) {
        setBrowserActions(prev => prev.map(a => 
          a.id === action.id 
            ? { 
                ...a, 
                status: 'completed', 
                result: `标题: ${response.data.title || '未知'}, URL: ${response.data.url}` 
              }
            : a
        ));
      } else {
        throw new Error(response.data?.error || '导航失败');
      }
    } catch (error: any) {
      setBrowserActions(prev => prev.map(a => 
        a.id === action.id 
          ? { ...a, status: 'failed', result: error.message || '导航失败' }
          : a
      ));
      message.error('浏览器导航失败: ' + (error.message || '未知错误'));
    } finally {
      setBrowserLoading(false);
    }
  };

  const clearLLMMessages = () => {
    setLlmMessages([]);
  };

  const clearBrowserActions = () => {
    setBrowserActions([]);
  };

  const handleFileEdit = (file: FileInfo) => {
    setEditingFile(file);
    setActiveTab('editor');
  };

  useEffect(() => {
    return () => {
      if (ws) {
        ws.close();
      }
    };
  }, [ws]);

  const modelOptions = [
    { value: 'gpt-4', label: 'GPT-4' },
    { value: 'gpt-4-turbo', label: 'GPT-4 Turbo' },
    { value: 'gpt-3.5-turbo', label: 'GPT-3.5 Turbo' },
    { value: 'claude-3-opus', label: 'Claude 3 Opus' },
    { value: 'claude-3-sonnet', label: 'Claude 3 Sonnet' },
    { value: 'qwen-max', label: '通义千问 Max' },
  ];

  return (
    <Layout style={{ height: '100%', background: '#fff' }}>
      <Header
        style={{
          background: 'var(--bg-100)',
          borderBottom: '1px solid var(--border-color-light)',
          padding: '0 16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          height: '52px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <ProjectSelector onProjectChange={(project) => {
            console.log('Project changed:', project);
          }} />
          <Divider type="vertical" style={{ height: 24, margin: '0 8px' }} />
          <BugOutlined style={{ fontSize: 18, color: 'var(--primary-100)' }} />
          <Title level={4} style={{ margin: 0, fontSize: 16 }}>
            调试面板
          </Title>
          {activeSession && (
            <span style={{ marginLeft: 12, color: 'var(--text-tertiary)', fontSize: 13 }}>
              会话：{activeSession.agentName}
              {activeSession.status === 'running' && (
                <span style={{ marginLeft: 8, color: 'var(--success)' }}>
                  ● 运行中
                </span>
              )}
              {activeSession.status === 'paused' && (
                <span style={{ marginLeft: 8, color: 'var(--warning)' }}>
                  ● 已暂停
                </span>
              )}
            </span>
          )}
        </div>

        <Space>
          <Button
            icon={<PlayCircleOutlined />}
            onClick={handleStartDebug}
            disabled={isDebugging}
            type="primary"
            size="small"
          >
            启动
          </Button>
          <Button
            icon={isPaused ? <PlayCircleOutlined /> : <PauseCircleOutlined />}
            onClick={handlePauseResume}
            disabled={!isDebugging}
            size="small"
          >
            {isPaused ? '继续' : '暂停'}
          </Button>
          <Button
            icon={<StepForwardOutlined />}
            onClick={handleStepOver}
            disabled={!isDebugging || !isPaused}
            size="small"
          >
            单步
          </Button>
          <Button
            icon={<StopOutlined />}
            onClick={handleStopDebug}
            disabled={!isDebugging}
            danger
            size="small"
          >
            停止
          </Button>
        </Space>
      </Header>

      <Layout>
        <Sider
          width={280}
          style={{
            background: '#fff',
            borderRight: '1px solid var(--border-color-light)',
          }}
        >
          <FileExplorer onFileEdit={handleFileEdit} />
        </Sider>

        <Content style={{ display: 'flex', flexDirection: 'column' }}>
          <Tabs
            activeKey={activeTab}
            onChange={setActiveTab}
            style={{ padding: '0 16px' }}
            items={[
              {
                key: 'files',
                label: (
                  <span>
                    <FolderOutlined />
                    文件浏览
                  </span>
                ),
                children: (
                  <div style={{ padding: 16, textAlign: 'center', color: 'var(--text-tertiary)' }}>
                    <Text>选择左侧文件查看内容，或双击文件进行编辑</Text>
                  </div>
                ),
              },
              {
                key: 'editor',
                label: (
                  <span>
                    <FileTextOutlined />
                    文件编辑
                  </span>
                ),
                children: (
                  <div style={{ height: 'calc(100vh - 180px)' }}>
                    <FileEditor file={editingFile} onClose={() => setActiveTab('files')} />
                  </div>
                ),
              },
              {
                key: 'conversation',
                label: (
                  <span>
                    <MessageOutlined />
                    对话记录
                  </span>
                ),
                children: (
                  <div style={{ height: 'calc(100vh - 200px)', overflow: 'auto' }}>
                    <ConversationHistory />
                  </div>
                ),
              },
              {
                key: 'operations',
                label: (
                  <span>
                    <CodeOutlined />
                    操作记录
                  </span>
                ),
                children: (
                  <div style={{ height: 'calc(100vh - 200px)', overflow: 'auto' }}>
                    <OperationRecords />
                  </div>
                ),
              },
              {
                key: 'llm',
                label: (
                  <span>
                    <RobotOutlined />
                    大模型操作
                  </span>
                ),
                children: (
                  <div style={{ padding: 16 }}>
                    <Card 
                      title="模型配置" 
                      size="small"
                      extra={
                        <Button size="small" icon={<ClearOutlined />} onClick={clearLLMMessages}>
                          清空
                        </Button>
                      }
                    >
                      <Space wrap>
                        <Select
                          value={selectedModel}
                          onChange={setSelectedModel}
                          options={modelOptions}
                          style={{ width: 180 }}
                        />
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <Text>温度:</Text>
                          <Slider
                            value={temperature}
                            onChange={setTemperature}
                            min={0}
                            max={2}
                            step={0.1}
                            style={{ width: 100 }}
                          />
                          <Text>{temperature}</Text>
                        </div>
                      </Space>
                    </Card>

                    <Card title="对话" size="small" style={{ marginTop: 16 }}>
                      <div 
                        style={{ 
                          height: 280, 
                          overflow: 'auto', 
                          border: '1px solid var(--border-color-light)',
                          borderRadius: 8,
                          padding: 8,
                          marginBottom: 16,
                        }}
                      >
                        {llmMessages.length === 0 ? (
                          <div style={{ textAlign: 'center', color: 'var(--text-tertiary)', padding: 20 }}>
                            暂无对话记录
                          </div>
                        ) : (
                          llmMessages.map(msg => (
                            <div 
                              key={msg.id}
                              style={{
                                marginBottom: 12,
                                textAlign: msg.role === 'user' ? 'right' : 'left',
                              }}
                            >
                              <Tag color={msg.role === 'user' ? 'blue' : msg.role === 'assistant' ? 'green' : 'default'}>
                                {msg.role === 'user' ? '用户' : msg.role === 'assistant' ? '助手' : '系统'}
                              </Tag>
                              <div 
                                style={{
                                  display: 'inline-block',
                                  maxWidth: '80%',
                                  padding: '8px 12px',
                                  borderRadius: 8,
                                  background: msg.role === 'user' ? 'var(--primary-50)' : 'var(--bg-200)',
                                  textAlign: 'left',
                                }}
                              >
                                <div style={{ whiteSpace: 'pre-wrap' }}>{msg.content}</div>
                                {msg.tokens && (
                                  <Text type="secondary" style={{ fontSize: 11 }}>
                                    Tokens: {msg.tokens}
                                  </Text>
                                )}
                              </div>
                            </div>
                          ))
                        )}
                        <div ref={messagesEndRef} />
                      </div>
                      
                      <div style={{ display: 'flex', gap: 8 }}>
                        <TextArea
                          value={llmInput}
                          onChange={(e) => setLlmInput(e.target.value)}
                          placeholder="输入消息..."
                          rows={2}
                          onPressEnter={(e) => {
                            if (!e.shiftKey) {
                              e.preventDefault();
                              handleSendLLMMessage();
                            }
                          }}
                        />
                        <Button 
                          type="primary" 
                          icon={<SendOutlined />}
                          onClick={handleSendLLMMessage}
                          loading={llmLoading}
                        >
                          发送
                        </Button>
                      </div>
                    </Card>
                  </div>
                ),
              },
              {
                key: 'browser',
                label: (
                  <span>
                    <GlobalOutlined />
                    浏览器操作
                  </span>
                ),
                children: (
                  <div style={{ padding: 16 }}>
                    <Card 
                      title="浏览器控制" 
                      size="small"
                      extra={
                        <Button size="small" icon={<ClearOutlined />} onClick={clearBrowserActions}>
                          清空记录
                        </Button>
                      }
                    >
                      <Space.Compact style={{ width: '100%', marginBottom: 16 }}>
                        <Input
                          placeholder="输入URL..."
                          value={browserUrl}
                          onChange={(e) => setBrowserUrl(e.target.value)}
                          prefix={<GlobalOutlined />}
                        />
                        <Button type="primary" onClick={handleBrowserNavigate} loading={browserLoading}>
                          导航
                        </Button>
                      </Space.Compact>
                    </Card>

                    <Card title="操作记录" size="small" style={{ marginTop: 16 }}>
                      <List
                        dataSource={browserActions}
                        renderItem={(action) => (
                          <List.Item>
                            <List.Item.Meta
                              title={
                                <Space>
                                  <Tag color={
                                    action.type === 'navigate' ? 'blue' :
                                    action.type === 'click' ? 'green' :
                                    action.type === 'screenshot' ? 'purple' : 'default'
                                  }>
                                    {action.type}
                                  </Tag>
                                  <span>{action.description}</span>
                                  <Tag color={
                                    action.status === 'completed' ? 'success' :
                                    action.status === 'running' ? 'processing' :
                                    action.status === 'failed' ? 'error' : 'default'
                                  }>
                                    {action.status}
                                  </Tag>
                                </Space>
                              }
                              description={action.result}
                            />
                          </List.Item>
                        )}
                        locale={{ emptyText: '暂无操作记录' }}
                        style={{ maxHeight: 300, overflow: 'auto' }}
                      />
                    </Card>
                  </div>
                ),
              },
            ]}
          />
        </Content>
      </Layout>
    </Layout>
  );
};

export default DebugPanel;
