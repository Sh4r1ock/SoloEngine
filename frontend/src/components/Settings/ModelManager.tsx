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
  Popconfirm,
  Tag,
  Tooltip,
  Divider,
  Row,
  Col,
  Alert,
} from 'antd';
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  StarOutlined,
  StarFilled,
  ApiOutlined,
  ReloadOutlined,
  GlobalOutlined,
} from '@ant-design/icons';
import { llmApi, LLMConfig, ProviderConfig, CreateLLMConfigRequest } from '../../services/llmApi';

const { Option } = Select;

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
    form.resetFields();
    form.setFieldsValue({
      temperature: 0.7,
      max_tokens: 2048,
      top_p: 1.0,
      frequency_penalty: 0.0,
      presence_penalty: 0.0,
      timeout: 60,
      is_default: false,
    });
    setModalVisible(true);
    setTestResult({ status: 'idle', message: '' });
  };

  const handleEdit = (record: LLMConfig) => {
    setEditingConfig(record);
    form.setFieldsValue({
      name: record.name,
      provider: record.provider,
      model_name: record.model_name,
      base_url: record.base_url,
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
    try {
      await llmApi.deleteConfig(configId);
      message.success('删除成功');
      loadConfigs();
    } catch (error) {
      message.error('删除失败');
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
        await llmApi.updateConfig(editingConfig.id, {
          ...values,
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

  const columns = [
    {
      title: '名称',
      dataIndex: 'name',
      key: 'name',
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
      render: (provider: string) => (
        <Tag color={
          provider === 'openai' ? 'blue' :
          provider === 'anthropic' ? 'orange' :
          provider === 'qwen' ? 'green' : 
          provider === 'deepseek' ? 'purple' : 'default'
        }>
          {getProviderDisplayName(provider)}
        </Tag>
      ),
    },
    {
      title: '模型',
      dataIndex: 'model_name',
      key: 'model_name',
    },
    {
      title: 'Base URL',
      dataIndex: 'base_url',
      key: 'base_url',
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
      render: (v: number) => v.toFixed(2),
    },
    {
      title: '更新时间',
      dataIndex: 'updated_at',
      key: 'updated_at',
      render: (date: string) => date ? new Date(date).toLocaleString() : '-',
    },
    {
      title: '操作',
      key: 'actions',
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
          <Popconfirm
            title="确定要删除此配置吗？"
            onConfirm={() => handleDelete(record.id)}
            okText="确定"
            cancelText="取消"
          >
            <Tooltip title="删除">
              <Button type="text" danger icon={<DeleteOutlined />} />
            </Tooltip>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const selectedProvider = Form.useWatch('provider', form);
  const currentProvider = providers.find(p => p.name === selectedProvider);

  return (
    <div>
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
      >
        <Table
          columns={columns}
          dataSource={configs}
          rowKey="id"
          loading={loading}
          pagination={{ pageSize: 10 }}
        />
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
        <Form form={form} layout="vertical">
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
                <Select placeholder="选择提供商">
                  {providers.map(p => (
                    <Option key={p.name} value={p.name}>
                      {p.display_name}
                      {!p.requires_api_key && ' (无需密钥)'}
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
                  placeholder="选择或输入模型名称" 
                  showSearch
                  optionFilterProp="children"
                  filterOption={(input, option) =>
                    (option?.children as unknown as string)?.toLowerCase().includes(input.toLowerCase())
                  }
                >
                  {currentProvider?.models.map(m => (
                    <Option key={m} value={m}>{m}</Option>
                  ))}
                </Select>
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
                <Input.Password placeholder="输入API密钥" />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item
            name="base_url"
            label={
              <Space>
                <GlobalOutlined />
                <span>自定义API地址 (Base URL)</span>
              </Space>
            }
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
              <Form.Item name="temperature" label="温度 (Temperature)">
                <InputNumber min={0} max={2} step={0.1} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="max_tokens" label="最大Token">
                <InputNumber min={1} max={128000} style={{ width: '100%' }} />
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

          <Form.Item name="is_default" label="设为默认" valuePropName="checked">
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
