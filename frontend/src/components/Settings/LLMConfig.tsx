import React, { useEffect, useState } from 'react';
import { Card, Select, Button, Divider, message, Typography, Input, Space, Tag, Row, Col, Statistic, Alert, Spin } from 'antd';
import { api } from '../../services/api';

const { Title, Text } = Typography;

interface ModelConfig {
  provider: string;
  displayName: string;
  requiresApiKey: boolean;
  defaultModel: string;
}

interface UsageStats {
  timeRangeHours: number;
  totalRequests: number;
  totalTokens: number;
  avgTokensPerRequest: number;
  avgTimePerRequest: number;
}

const MODEL_CONFIGS: Record<string, ModelConfig> = {
  openai: {
    provider: 'openai',
    displayName: 'OpenAI',
    requiresApiKey: true,
    defaultModel: 'gpt-4',
  },
  anthropic: {
    provider: 'anthropic',
    displayName: 'Anthropic Claude',
    requiresApiKey: true,
    defaultModel: 'claude-3-5-sonnet-20241022',
  },
  qwen: {
    provider: 'qwen',
    displayName: '通义千问',
    requiresApiKey: true,
    defaultModel: 'qwen-plus',
  },
  deepseek: {
    provider: 'deepseek',
    displayName: 'DeepSeek',
    requiresApiKey: true,
    defaultModel: 'deepseek-chat',
  },
  ollama: {
    provider: 'ollama',
    displayName: 'Ollama (本地)',
    requiresApiKey: false,
    defaultModel: 'llama2',
  },
};

const TIME_RANGES = [
  { label: '1 小时', value: 1 },
  { label: '6 小时', value: 6 },
  { label: '24 小时', value: 24 },
  { label: '72 小时', value: 72 },
  { label: '168 小时 (7 天)', value: 168 },
];

const LLMConfig: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [config, setConfig] = useState<{
    provider: string;
    model_name: string;
    api_key: string;
    base_url?: string;
    reasoning_effort?: string;
  }>({
    provider: 'openai',
    model_name: 'gpt-4',
    api_key: '',
    base_url: '',
    reasoning_effort: undefined,
  });
  const [models, setModels] = useState<string[]>([]);
  const [usage, setUsage] = useState<UsageStats | null>(null);
  const [saveLoading, setSaveLoading] = useState(false);
  const [testResult, setTestResult] = useState<{
    status: 'idle' | 'loading' | 'success' | 'error';
    message: string;
    provider?: string;
    model?: string;
  }>({
    status: 'idle',
    message: '',
  });
  const [timeRange, setTimeRange] = useState(TIME_RANGES[0].value);
  const [showApiKey, setShowApiKey] = useState(false);

  const getProviderInfo = (provider: string): ModelConfig => {
    return MODEL_CONFIGS[provider] || MODEL_CONFIGS.openai;
  };

  useEffect(() => {
    loadConfig();
  }, []);

  const loadConfig = async () => {
    setLoading(true);
    try {
      const response = await api.get('/llm/configs/default');
      if (response.code === 200 && response.data) {
        setConfig(response.data);
      } else {
        message.error('加载 LLM 配置失败');
      }
    } catch (error) {
      message.error('加载 LLM 配置失败：' + String(error));
    } finally {
      setLoading(false);
    }
  };

  const loadModels = async (provider?: string) => {
    try {
      let url = '/llm/providers';
      if (provider) {
        url = `/llm/providers/${provider}/models`;
      }

      const response = await api.get(url);
      if (response.code === 200 && response.data) {
        const providerData = response.data.find((p: any) => p.name === provider);
        if (providerData) {
          setModels(providerData.models || []);
        }
      } else {
        message.error('加载模型列表失败');
      }
    } catch (error) {
      message.error('加载模型列表失败：' + String(error));
    }
  };

  const loadUsage = async () => {
    try {
      const response = await api.get('/llm/usage', {
        params: {
          time_range_hours: timeRange,
          provider: config.provider,
          model_name: config.model_name,
        },
      });

      if (response.code === 200 && response.data) {
        setUsage(response.data);
      } else {
        message.error('加载使用统计失败');
      }
    } catch (error) {
      message.error('加载使用统计失败：' + String(error));
    }
  };

  const handleSave = async () => {
    setSaveLoading(true);
    try {
      const response = await api.post('/llm/configs', {
        name: `${config.provider}-${config.model_name}`,
        provider: config.provider,
        model_name: config.model_name,
        api_key: config.api_key || undefined,
        base_url: config.base_url || undefined,
      });

      if (response.code === 200) {
        message.success('LLM 配置已保存');
        await loadConfig();
      } else {
        message.error('保存 LLM 配置失败：' + response.message);
      }
    } catch (error) {
      message.error('保存 LLM 配置失败：' + String(error));
    } finally {
      setSaveLoading(false);
    }
  };

  const handleTest = async () => {
    setTestResult({ status: 'loading', message: '测试中...' });
    try {
      const response = await api.post('/llm/test', {
        name: `${config.provider}-${config.model_name}`,
        provider: config.provider,
        model_name: config.model_name,
        api_key: config.api_key || undefined,
        base_url: config.base_url || undefined,
      });

      if (response.code === 200) {
        setTestResult({
          status: response.data.status === 'error' ? 'error' : 'success',
          message: response.data.status === 'error'
            ? `测试失败: ${response.data.error}`
            : '测试成功',
          provider: response.data.provider,
          model: response.data.model_name,
        });
      } else {
        setTestResult({ status: 'error', message: '测试配置失败：' + response.message });
      }
    } catch (error) {
      setTestResult({ status: 'error', message: '测试配置失败：' + String(error) });
    }
  };

  const handleExport = async (format: string = 'json') => {
    try {
      const response = await api.get('/llm/usage/export', {
        params: { format },
      });

      if (response.code === 200) {
        message.success(`使用数据已导出到: ${response.data.path}`);
        const blob = new Blob([JSON.stringify(response.data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `llm_usage_export.${format}`;
        link.click();
        URL.revokeObjectURL(url);
      } else {
        message.error('导出使用数据失败：' + response.message);
      }
    } catch (error) {
      message.error('导出使用数据失败：' + String(error));
    }
  };

  const handleClearHistory = async () => {
    try {
      const response = await api.delete('/llm/usage', {
        params: { days_to_keep: 30 },
      });

      if (response.code === 200) {
        message.success(`已清除 ${response.data.removed_count} 条历史记录`);
        loadUsage();
      } else {
        message.error('清除历史数据失败：' + response.message);
      }
    } catch (error) {
      message.error('清除历史数据失败：' + String(error));
    }
  };

  const handleProviderChange = async (value: string) => {
    setConfig({
      provider: value,
      model_name: MODEL_CONFIGS[value]?.defaultModel,
      api_key: '',
      base_url: value === 'ollama' ? 'http://localhost:11434' : '',
      reasoning_effort: undefined,
    });
    setModels([]);
  };

  const handleModelChange = async (value: string) => {
    setConfig({ ...config, model_name: value });
  };

  const handleApiKeyChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setConfig({ ...config, api_key: e.target.value });
  };

  const handleBaseURLChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setConfig({ ...config, base_url: e.target.value });
  };

  useEffect(() => {
    if (config.provider) {
      loadModels(config.provider);
    }
  }, [config.provider]);

  return (
    <div style={{ padding: '24px' }}>
      <Title level={4}>LLM 使用统计</Title>
      <Divider />

      <Card title="使用统计" style={{ marginBottom: 24 }}>
        <div style={{ marginBottom: 16 }}>
          <Select
            defaultValue={TIME_RANGES[0].value}
            style={{ width: 200 }}
            onChange={(value) => {
              setTimeRange(value);
              loadUsage();
            }}
            options={TIME_RANGES}
          />

          {usage && (
            <>
              <Row gutter={16} style={{ marginTop: 16 }}>
                <Col span={6}>
                  <Statistic title="总请求数" value={usage.totalRequests} />
                </Col>
                <Col span={6}>
                  <Statistic title="总 Token 数" value={usage.totalTokens} />
                </Col>
                <Col span={6}>
                  <Statistic title="平均 Token/请求" value={usage.avgTokensPerRequest} precision={2} />
                </Col>
                <Col span={6}>
                  <Statistic title="平均耗时 (秒)" value={usage.avgTimePerRequest} precision={2} />
                </Col>
              </Row>
              <Divider style={{ margin: '24px 0' }} />
              <Space>
                <Button onClick={loadUsage}>刷新</Button>
                <Button danger onClick={handleClearHistory}>清除历史</Button>
              </Space>
              <Row gutter={8} style={{ marginTop: 16 }}>
                <Col>
                  <Button size="small" onClick={() => handleExport('json')}>
                    导出 JSON
                  </Button>
                </Col>
                <Col>
                  <Button size="small" onClick={() => handleExport('csv')}>
                    导出 CSV
                  </Button>
                </Col>
              </Row>
            </>
          )}
        </div>
      </Card>
    </div>
  );
};

export default LLMConfig;
