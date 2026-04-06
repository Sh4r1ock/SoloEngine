import React, { useEffect, useState } from 'react';
import { Modal, Select, Input, Button, Spin, Empty, message, Typography, Tag, Card, Switch, InputNumber } from 'antd';
import { PlayCircleOutlined, LoadingOutlined, CheckCircleOutlined, ExclamationCircleOutlined } from '@ant-design/icons';
import { mcpApi, MCPServer, MCPTool } from '../../services/mcpApi';

const { Text, Paragraph } = Typography;

interface MCPTestRunModalProps {
  visible: boolean;
  server: MCPServer | null;
  onClose: () => void;
}

interface ToolCallResult {
  success: boolean;
  result?: any;
  error?: string;
  duration?: number;
}

const MCPTestRunModal: React.FC<MCPTestRunModalProps> = ({ visible, server, onClose }) => {
  const [tools, setTools] = useState<MCPTool[]>([]);
  const [loading, setLoading] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [selectedTool, setSelectedTool] = useState<string>('');
  const [formValues, setFormValues] = useState<Record<string, any>>({});
  const [calling, setCalling] = useState(false);
  const [callResult, setCallResult] = useState<ToolCallResult | null>(null);

  useEffect(() => {
    if (visible && server) {
      resetState();
      autoConnectAndLoadTools();
    }
  }, [visible, server?.id]);

  const resetState = () => {
    setSelectedTool('');
    setFormValues({});
    setCallResult(null);
    setTools([]);
  };

  const autoConnectAndLoadTools = async () => {
    if (!server) return;

    setLoading(true);
    setConnecting(true);
    setTools([]);
    setCallResult(null);

    try {
      const connectResponse = await mcpApi.connectServer(server.id);

      if (connectResponse.code !== 200) {
        message.error(`连接失败: ${connectResponse.message || '未知错误'}`);
        setCallResult({
          success: false,
          error: `连接失败: ${connectResponse.message || '未知错误'}`,
        });
        return;
      }

      const response = await mcpApi.getServerTools(server.id);
      if (response.code === 200 && response.data) {
        const toolList = response.data.tools || [];
        setTools(toolList);
        if (toolList.length > 0) {
          setSelectedTool(toolList[0].name);
        } else {
          message.info('该服务器没有可用工具');
        }
      } else {
        message.warning(`获取工具列表失败: ${response.message || '未知错误'}`);
        setCallResult({
          success: false,
          error: `获取工具列表失败: ${response.message || '未知错误'}`,
        });
      }
    } catch (error: any) {
      console.error('加载工具失败:', error);
      let errorMsg = '加载工具列表失败';
      if (error.response?.status === 500) {
        errorMsg = '无法连接到该MCP服务器，请检查配置是否正确';
        if (error.response?.data?.message) {
          errorMsg += ` (${error.response.data.message})`;
        }
      } else if (error.response?.data?.message) {
        errorMsg = error.response.data.message;
      } else if (error.message) {
        errorMsg = error.message;
      }
      message.warning(errorMsg);
      setCallResult({
        success: false,
        error: errorMsg,
      });
      setTools([]);
    } finally {
      setLoading(false);
      setConnecting(false);
    }
  };

  const selectedToolData = tools.find(t => t.name === selectedTool);

  useEffect(() => {
    if (selectedToolData?.input_schema?.properties) {
      const properties = selectedToolData.input_schema.properties;
      const defaults: Record<string, any> = {};
      Object.entries(properties).forEach(([key, prop]) => {
        defaults[key] = prop.default ??
          (prop.type === 'integer' || prop.type === 'number' ? 0 : '');
      });
      setFormValues(defaults);
    }
  }, [selectedTool]);

  const handleCallTool = async () => {
    if (!server || !selectedTool) return;

    setCalling(true);
    setCallResult(null);

    const startTime = Date.now();

    try {
      const response = await mcpApi.callServerTool(server.id, selectedTool, formValues);
      const duration = Date.now() - startTime;

      if (response.code === 200) {
        setCallResult({
          success: true,
          result: response.data,
          duration,
        });
        message.success('✅ 工具调用成功');
      } else {
        setCallResult({
          success: false,
          error: response.message || '调用失败',
          duration,
        });
        message.error(response.message || '工具调用失败');
      }
    } catch (error: any) {
      const duration = Date.now() - startTime;
      setCallResult({
        success: false,
        error: String(error),
        duration,
      });
      message.error('❌ 工具调用异常：' + String(error));
    } finally {
      setCalling(false);
    }
  };

  const renderFormField = (key: string, prop: any, isRequired: boolean) => {
    const value = formValues[key];

    const handleChange = (newValue: any) => {
      setFormValues(prev => ({ ...prev, [key]: newValue }));
    };

    if (prop.type === 'string' && !prop.enum) {
      return (
        <div key={key} style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
            <Text strong style={{ fontSize: 13 }}>{key}</Text>
            {isRequired && <Tag color="red" style={{ fontSize: 10, marginLeft: 4 }}>必填</Tag>}
          </div>
          <Input
            value={value || ''}
            onChange={(e) => handleChange(e.target.value)}
            placeholder={prop.description || `输入${key}`}
            size="middle"
          />
          {prop.description && (
            <Text type="secondary" style={{ fontSize: 11, marginTop: 2, display: 'block' }}>
              {prop.description}
            </Text>
          )}
        </div>
      );
    }

    if (prop.type === 'integer' || prop.type === 'number') {
      return (
        <div key={key} style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
            <Text strong style={{ fontSize: 13 }}>{key}</Text>
            {isRequired && <Tag color="red" style={{ fontSize: 10, marginLeft: 4 }}>必填</Tag>}
            {prop.type === 'integer' && <Text type="secondary" style={{ fontSize: 11 }}>（整数）</Text>}
          </div>
          <InputNumber
            value={value}
            onChange={(val) => handleChange(val)}
            placeholder={prop.description || `输入数字`}
            style={{ width: '100%' }}
            size="middle"
          />
          {prop.description && (
            <Text type="secondary" style={{ fontSize: 11, marginTop: 2, display: 'block' }}>
              {prop.description}
            </Text>
          )}
        </div>
      );
    }

    if (prop.type === 'boolean') {
      return (
        <div key={key} style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <Text strong style={{ fontSize: 13 }}>{key}</Text>
            {isRequired && <Tag color="red" style={{ fontSize: 10 }}>必填</Tag>}
          </div>
          <Switch
            checked={value || false}
            onChange={(checked) => handleChange(checked)}
            size="small"
          />
          {prop.description && (
            <Text type="secondary" style={{ fontSize: 11, flex: 1, textAlign: 'right' }}>
              {prop.description}
            </Text>
          )}
        </div>
      );
    }

    if (prop.enum) {
      return (
        <div key={key} style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
            <Text strong style={{ fontSize: 13 }}>{key}</Text>
            {isRequired && <Tag color="red" style={{ fontSize: 10, marginLeft: 4 }}>必填</Tag>}
          </div>
          <Select
            value={value}
            onChange={(val) => handleChange(val)}
            placeholder={`选择${key}`}
            style={{ width: '100%' }}
            size="middle"
            options={prop.enum.map((v: string) => ({
              label: v,
              value: v,
            }))}
          />
          {prop.description && (
            <Text type="secondary" style={{ fontSize: 11, marginTop: 2, display: 'block' }}>
              {prop.description}
            </Text>
          )}
        </div>
      );
    }

    return (
      <div key={key} style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
          <Text strong style={{ fontSize: 13 }}>{key}</Text>
          {isRequired && <Tag color="red" style={{ fontSize: 10, marginLeft: 4 }}>必填</Tag>}
          <Tag style={{ fontSize: 10, marginLeft: 4 }}>{prop.type || 'string'}</Tag>
        </div>
        <Input.TextArea
          value={typeof value === 'object' ? JSON.stringify(value, null, 2) : (value ?? '')}
          onChange={(e) => {
            try {
              const val = JSON.parse(e.target.value);
              handleChange(val);
            } catch {
              handleChange(e.target.value);
            }
          }}
          placeholder={prop.description || `输入JSON格式的${key}`}
          autoSize={{ minRows: 2, maxRows: 6 }}
          style={{ fontFamily: 'monospace', fontSize: 12 }}
        />
        {prop.description && (
          <Text type="secondary" style={{ fontSize: 11, marginTop: 2, display: 'block' }}>
            {prop.description}
          </Text>
        )}
      </div>
    );
  };

  return (
    <Modal
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <PlayCircleOutlined style={{ color: '#1890ff', fontSize: 18 }} />
          <span>MCP 试运行</span>
          {server && (
            <Tag color="blue" style={{ marginLeft: 8 }}>{server.name}</Tag>
          )}
        </div>
      }
      open={visible}
      onCancel={onClose}
      width={680}
      footer={null}
      destroyOnHidden
    >
      {!server ? (
        <Empty description="请选择一个 MCP 服务器" />
      ) : (
        <div>
          {connecting ? (
            <Card size="small" style={{ textAlign: 'center', marginBottom: 16, borderColor: '#1890ff' }}>
              <LoadingOutlined spin style={{ fontSize: 20, color: '#1890ff' }} />
              <div style={{ marginTop: 8 }}>
                <Text type="secondary">正在连接到 {server.name}...</Text>
              </div>
            </Card>
          ) : (
            <>
              <Card
                size="small"
                title={
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>1. 选择工具</span>
                    {tools.length > 0 && (
                      <Tag color="blue">{tools.length} 个可用工具</Tag>
                    )}
                  </div>
                }
                style={{ marginBottom: 16 }}
              >
                <Spin spinning={loading}>
                  {tools.length === 0 ? (
                    <Empty description={loading ? '加载中...' : '该服务器没有可用工具'} />
                  ) : (
                    <Select
                      value={selectedTool}
                      onChange={setSelectedTool}
                      style={{ width: '100%' }}
                      placeholder="选择要测试的工具"
                      size="large"
                    >
                      {tools.map(tool => (
                        <Select.Option key={tool.name} value={tool.name}>
                          <div>
                            <Text strong>{tool.name}</Text>
                            <br />
                            <Text type="secondary" style={{ fontSize: 11 }}>
                              {tool.description?.substring(0, 50)}{tool.description && tool.description.length > 50 ? '...' : ''}
                            </Text>
                          </div>
                        </Select.Option>
                      ))}
                    </Select>
                  )}
                </Spin>
              </Card>

              {selectedToolData?.description && (
                <div style={{
                  background: '#f6ffed',
                  padding: '8px 12px',
                  borderRadius: 6,
                  marginBottom: 16,
                  border: '1px solid #b7eb8f',
                }}>
                  <Text type="secondary">
                    <strong>📝 描述：</strong>{selectedToolData.description}
                  </Text>
                </div>
              )}

              {selectedToolData && selectedToolData.input_schema?.properties && Object.keys(selectedToolData.input_schema.properties).length > 0 && (
                <Card
                  size="small"
                  title={<span>2. 参数配置</span>}
                  style={{ marginBottom: 16 }}
                >
                  {Object.entries(selectedToolData.input_schema.properties).map(([key, prop]) => {
                    const required = new Set(selectedToolData.input_schema.required || []).has(key);
                    return (
                      <div key={key}>
                        {renderFormField(key, prop, required)}
                      </div>
                    );
                  })}
                </Card>
              )}

              <Button
                type="primary"
                icon={<PlayCircleOutlined />}
                onClick={handleCallTool}
                loading={calling}
                disabled={!selectedTool || tools.length === 0}
                block
                size="large"
                style={{ marginBottom: 16 }}
              >
                执行调用
              </Button>

              {callResult && (
                <Card
                  size="small"
                  title={
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {callResult.success ? (
                        <>
                          <CheckCircleOutlined style={{ color: '#52c41a' }} />
                          <Text style={{ color: '#52c41a' }}>调用成功</Text>
                        </>
                      ) : (
                        <>
                          <ExclamationCircleOutlined style={{ color: '#ff4d4f' }} />
                          <Text style={{ color: '#ff4d4f' }}>调用失败</Text>
                        </>
                      )}
                      {callResult.duration && (
                        <Tag style={{ marginLeft: 'auto' }} color={callResult.success ? 'green' : 'red'}>
                          {callResult.duration}ms
                        </Tag>
                      )}
                    </div>
                  }
                  style={{
                    borderColor: callResult.success ? '#52c41a' : '#ff4d4f',
                  }}
                >
                  {callResult.success ? (
                    typeof callResult.result === 'object' ? (
                      <pre style={{
                        background: '#f6ffed',
                        padding: 12,
                        borderRadius: 6,
                        fontSize: 12,
                        maxHeight: 350,
                        overflow: 'auto',
                        border: '1px solid #b7eb8f',
                        margin: 0,
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-all',
                      }}>
                        {JSON.stringify(callResult.result, null, 2)}
                      </pre>
                    ) : (
                      <Paragraph
                        style={{
                          background: '#f6ffed',
                          padding: 12,
                          borderRadius: 6,
                          maxHeight: 350,
                          overflow: 'auto',
                          border: '1px solid #b7eb8f',
                          margin: 0,
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-all',
                          fontSize: 13,
                        }}
                      >
                        {String(callResult.result)}
                      </Paragraph>
                    )
                  ) : (
                    <pre style={{
                      background: '#fff2f0',
                      padding: 12,
                      borderRadius: 6,
                      fontSize: 12,
                      maxHeight: 350,
                      overflow: 'auto',
                      border: '1px solid #ffccc7',
                      color: '#cf1322',
                      margin: 0,
                    }}>
                      {callResult.error}
                    </pre>
                  )}
                </Card>
              )}

              {calling && (
                <Card size="small" style={{ textAlign: 'center', borderColor: '#1890ff' }}>
                  <LoadingOutlined spin style={{ fontSize: 24, color: '#1890ff' }} />
                  <div style={{ marginTop: 8 }}>
                    <Text type="secondary">正在调用工具: {selectedTool}</Text>
                  </div>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    请稍候...
                  </Text>
                </Card>
              )}
            </>
          )}
        </div>
      )}
    </Modal>
  );
};

export default MCPTestRunModal;
