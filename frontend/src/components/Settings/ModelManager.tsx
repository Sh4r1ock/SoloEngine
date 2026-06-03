/**
 * @file ModelManager.tsx
 * @description 模型管理组件 - 支持多模型配置管理
 * @author SoloEngine Team
 * @date 2026-02-20
 */
import React, { useEffect, useState } from 'react';
import {
  Card,
  Table,
  Button,
  Space,
  Modal,
  Form,
  Input,
  Select,
  InputNumber,
  Switch,
  message,
  Tag,
  Tooltip,
  Divider,
  Row,
  Col,
  Alert,
  Pagination,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  StarOutlined,
  StarFilled,
  ApiOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import { llmApi, LLMConfig, ProviderConfig, CreateLLMConfigRequest } from '../../services/llmApi';
import { formatDateTime } from '../../utils/timezone';
import { LLM_DEFAULTS } from '../../config/llmDefaults';

const { Option } = Select;

const MASKED_API_KEY = '••••••••';

const ModelManager: React.FC = () => {
  const [configs, setConfigs] = useState<LLMConfig[]>([]);
  const [providers, setProviders] = useState<ProviderConfig[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingConfig, setEditingConfig] = useState<LLMConfig | null>(null);
  const [testLoading, setTestLoading] = useState(false);
  const [testResult, setTestResult] = useState<{
    status: 'idle' | 'success' | 'error';
    message: string;
  }>({ status: 'idle', message: '' });
  const [apiKeyModified, setApiKeyModified] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [form] = Form.useForm();

  useEffect(() => {
    loadProviders();
    loadConfigs();
  }, []);

  const loadProviders = async () => {
    try {
      const data = await llmApi.getProviders();
      setProviders(data);
    } catch (error) {
      message.error('加载提供商列表失败');
    }
  };

  const loadConfigs = async () => {
    setLoading(true);
    try {
      const data = await llmApi.getConfigs();
      setConfigs(data);
    } catch (error) {
      message.error('加载配置列表失败');
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = () => {
    setEditingConfig(null);
    setApiKeyModified(false);
    form.resetFields();
    form.setFieldsValue({
      temperature: LLM_DEFAULTS.TEMPERATURE,
      max_tokens: LLM_DEFAULTS.MAX_TOKENS,
      top_p: LLM_DEFAULTS.TOP_P,
      frequency_penalty: LLM_DEFAULTS.FREQUENCY_PENALTY,
      presence_penalty: LLM_DEFAULTS.PRESENCE_PENALTY,
      timeout: LLM_DEFAULTS.TIMEOUT,
      is_default: false,
    });
    setModalVisible(true);
    setTestResult({ status: 'idle', message: '' });
  };

  const handleEdit = (record: LLMConfig) => {
    setEditingConfig(record);
    setApiKeyModified(false);
    form.resetFields();
    form.setFieldsValue({
      name: record.name,
      provider: record.provider,
      model_name: record.model_name,
      base_url: record.base_url,
      api_key: record.has_api_key ? MASKED_API_KEY : undefined,
      temperature: record.temperature,
      max_tokens: record.max_tokens,
      top_p: record.top_p,
      frequency_penalty: record.frequency_penalty,
      presence_penalty: record.presence_penalty,
      timeout: record.timeout,
      is_default: record.is_default,
      version: record.version,
    });
    setModalVisible(true);
    setTestResult({ status: 'idle', message: '' });
  };

  const handleDelete = async (configId: string) => {
    const config = configs.find(c => c.id === configId);
    
    if (config?.is_default) {
      Modal.confirm({
        title: '删除默认配置',
        content: '您正在删除默认模型配置。删除后，新创建的节点将不会自动应用模型配置。确定要删除吗？',
        okText: '确定删除',
        cancelText: '取消',
        onOk: async () => {
          try {
            await llmApi.deleteConfig(configId);
            message.success('删除成功');
            loadConfigs();
          } catch (error) {
            message.error('删除失败');
          }
        },
      });
    } else {
      try {
        await llmApi.deleteConfig(configId);
        message.success('删除成功');
        loadConfigs();
      } catch (error) {
        message.error('删除失败');
      }
    }
  };

  const handleSetDefault = async (configId: string) => {
    try {
      await llmApi.setDefaultConfig(configId);
      message.success('已设为默认');
      loadConfigs();
    } catch (error) {
      message.error('设置失败');
    }
  };

  const handleTest = async () => {
    try {
      const values = await form.validateFields();
      if (values.api_key === MASKED_API_KEY) {
        message.warning('API密钥使用星号掩码显示，请输入实际的API密钥后再测试');
        return;
      }
      setTestLoading(true);
      const result = await llmApi.testConfig({
        name: values.name,
        provider: values.provider,
        model_name: values.model_name,
        api_key: values.api_key,
        base_url: values.base_url,
      });
      
      if (result.status === 'success') {
        setTestResult({ status: 'success', message: '连接测试成功' });
      } else {
        setTestResult({ status: 'error', message: result.error || '连接测试失败' });
      }
    } catch (error) {
      setTestResult({ status: 'error', message: '测试失败: ' + String(error) });
    } finally {
      setTestLoading(false);
    }
  };

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      
      if (editingConfig) {
        const submitValues = { ...values };
        if (submitValues.api_key === MASKED_API_KEY) {
          delete submitValues.api_key;
        }
        await llmApi.updateConfig(editingConfig.id, {
          ...submitValues,
          version: editingConfig.version,
        });
        message.success('更新成功');
      } else {
        await llmApi.createConfig(values);
        message.success('创建成功');
      }
      
      setModalVisible(false);
      loadConfigs();
    } catch (error) {
      message.error('保存失败');
    }
  };

  const getProviderDisplayName = (providerName: string) => {
    const provider = providers.find(p => p.name === providerName);
    return provider?.display_name || providerName;
  };

  const getProviderColor = (providerName: string) => {
    const provider = providers.find(p => p.name === providerName);
    return provider?.color || undefined;
  };

  const columns: ColumnsType<LLMConfig> = [
    {
      title: '名称',
      dataIndex: 'name',
      key: 'name',
      align: 'center',
      render: (text: string, record: LLMConfig) => (
        <Space>
          {text}
          {record.is_default && (
            <Tag color="gold" icon={<StarFilled />}>默认</Tag>
          )}
        </Space>
      ),
    },
    {
      title: '提供商',
      dataIndex: 'provider',
      key: 'provider',
      align: 'center',
      render: (provider: string) => (
        <Tag color={getProviderColor(provider)}>
          {getProviderDisplayName(provider)}
        </Tag>
      ),
    },
    {
      title: '模型',
      dataIndex: 'model_name',
      key: 'model_name',
      align: 'center',
    },
    {
      title: 'Base URL',
      dataIndex: 'base_url',
      key: 'base_url',
      align: 'center',
      render: (url: string) => url ? (
        <Tooltip title={url}>
          <span style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>
            {url.length > 30 ? url.slice(0, 30) + '...' : url}
          </span>
        </Tooltip>
      ) : '-',
    },
    {
      title: '温度',
      dataIndex: 'temperature',
      key: 'temperature',
      align: 'center',
      render: (v: number) => v.toFixed(2),
    },
    {
      title: '更新时间',
      dataIndex: 'updated_at',
      key: 'updated_at',
      align: 'center',
      render: (date: string) => formatDateTime(date),
    },
    {
      title: '操作',
      key: 'actions',
      align: 'center',
      render: (_: any, record: LLMConfig) => (
        <Space>
          <Tooltip title="编辑">
            <Button
              type="text"
              icon={<EditOutlined />}
              onClick={() => handleEdit(record)}
            />
          </Tooltip>
          {!record.is_default && (
            <Tooltip title="设为默认">
              <Button
                type="text"
                icon={<StarOutlined />}
                onClick={() => handleSetDefault(record.id)}
              />
            </Tooltip>
          )}
          <Tooltip title="删除">
            <Button 
              type="text" 
              danger 
              icon={<DeleteOutlined />} 
              onClick={() => handleDelete(record.id)}
            />
          </Tooltip>
        </Space>
      ),
    },
  ];

  const selectedProvider = Form.useWatch('provider', form);
  const currentProvider = providers.find(p => p.name === selectedProvider);

  return (
    <div style={{ height: '100%' }}>
      <Card
        title={
          <Space>
            <ApiOutlined />
            <span>模型配置管理</span>
          </Space>
        }
        extra={
          <Space>
            <Button icon={<ReloadOutlined />} onClick={loadConfigs}>
              刷新
            </Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={handleCreate}>
              新建配置
            </Button>
          </Space>
        }
        style={{ height: '100%', display: 'flex', flexDirection: 'column' }}
        styles={{ body: { flex: 1, padding: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' } }}
      >
        <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
          <Table
            columns={columns}
            dataSource={configs.slice((currentPage - 1) * pageSize, currentPage * pageSize)}
            rowKey="id"
            loading={loading}
            sticky
            pagination={false}
            locale={{
              emptyText: (
                <div style={{ 
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'center',
                  height: '100%',
                  minHeight: 200,
                  color: 'rgba(0, 0, 0, 0.45)',
                }}>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 48, marginBottom: 8 }}>📭</div>
                    <div>暂无数据</div>
                  </div>
                </div>
              )
            }}
          />
        </div>
        <div style={{ 
          padding: '8px 16px', 
          borderTop: '1px solid #f0f0f0',
          display: 'flex',
          justifyContent: 'flex-end',
          flexShrink: 0,
        }}>
          <Pagination
            current={currentPage}
            pageSize={pageSize}
            total={configs.length}
            showSizeChanger
            pageSizeOptions={['5', '10', '20', '50']}
            onChange={(page, size) => {
              setCurrentPage(page);
              setPageSize(size);
            }}
            showTotal={(total) => `共 ${total} 条`}
          />
        </div>
      </Card>

      <Modal
        title={editingConfig ? '编辑模型配置' : '新建模型配置'}
        open={modalVisible}
        onCancel={() => setModalVisible(false)}
        onOk={handleSubmit}
        width={720}
        okText="保存"
        cancelText="取消"
      >
        <Form form={form} layout="vertical" requiredMark="optional" autoComplete="off">
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                name="name"
                label="配置名称"
                rules={[{ required: true, message: '请输入配置名称' }]}
              >
                <Input placeholder="例如: GPT-4 生产环境" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name="provider"
                label="提供商"
                rules={[{ required: true, message: '请选择提供商' }]}
              >
                <Select
                placeholder="选择提供商"
                onChange={(value: string) => {
                  const provider = providers.find(p => p.name === value);
                  if (provider) {
                    form.setFieldsValue({
                      base_url: provider.default_base_url,
                      model_name: provider.default_model,
                    });
                  }
                }}
              >
                {providers.map(p => (
                  <Option key={p.name} value={p.name}>
                    {p.display_name}
                  </Option>
                ))}
              </Select>
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                name="model_name"
                label="模型名称"
                rules={[{ required: true, message: '请输入模型名称' }]}
              >
                <Select
                  showSearch
                  allowClear
                  placeholder="选择或搜索模型名称"
                  optionFilterProp="label"
                  options={(currentProvider?.models || []).map(m => ({ label: m, value: m }))}
                  autoComplete="off"
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name="api_key"
                label="API密钥"
                rules={[{
                  required: currentProvider?.requires_api_key && !editingConfig,
                  message: '请输入API密钥'
                }]}
              >
                <Input.Password placeholder="输入API密钥" autoComplete="new-password" />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item
            name="base_url"
            label="Base URL"
            extra="支持自定义OpenAI兼容的API地址，如DeepSeek、智谱AI等"
          >
            <Input placeholder="例如: https://api.deepseek.com/v1" />
          </Form.Item>

          {selectedProvider && (
            <Alert
              message={
                <span>
                  提示：如果您使用的是OpenAI兼容的API（如DeepSeek、智谱AI等），请在上方填写对应的Base URL，
                  并在模型名称中输入实际使用的模型ID。
                </span>
              }
              type="info"
              showIcon
              style={{ marginBottom: 16 }}
            />
          )}

          <Divider>高级参数</Divider>

          <Row gutter={16}>
            <Col span={8}>
              <Form.Item name="temperature" label="温度">
                <InputNumber min={0} max={2} step={0.1} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="max_tokens" label="最大Token">
                <InputNumber min={1} max={LLM_DEFAULTS.MAX_TOKENS_LIMIT} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="top_p" label="Top P">
                <InputNumber min={0} max={1} step={0.1} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col span={8}>
              <Form.Item name="frequency_penalty" label="频率惩罚">
                <InputNumber min={-2} max={2} step={0.1} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="presence_penalty" label="存在惩罚">
                <InputNumber min={-2} max={2} step={0.1} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="timeout" label="超时时间(秒)">
                <InputNumber min={1} max={600} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item 
            name="is_default" 
            label="设为默认" 
            valuePropName="checked"
            extra="设为默认后，新创建的节点将自动使用此模型配置。每个用户只能有一个默认配置。"
          >
            <Switch />
          </Form.Item>

          <Space>
            <Button onClick={handleTest} loading={testLoading}>
              测试连接
            </Button>
            {testResult.status !== 'idle' && (
              <Alert
                message={testResult.message}
                type={testResult.status === 'success' ? 'success' : 'error'}
                showIcon
                style={{ display: 'inline-block' }}
              />
            )}
          </Space>
        </Form>
      </Modal>
    </div>
  );
};

export default ModelManager;
