import React, { useEffect, useState } from 'react';
import { Card, Button, App, Space, DatePicker, Row, Col, Statistic, Tooltip, Select } from 'antd';
import { BarChartOutlined, ReloadOutlined, DownloadOutlined } from '@ant-design/icons';
import ReactECharts from 'echarts-for-react';
import dayjs, { Dayjs } from 'dayjs';
import { api } from '../../services/api';
import { llmApi, LLMConfig as LLMConfigType } from '../../services/llmApi';

const { RangePicker } = DatePicker;

interface DailyStats {
  date: string;
  requests: number;
  tokens: number;
  avg_time: number;
}

interface UsageSummary {
  total_requests: number;
  total_tokens: number;
  avg_tokens_per_request: number;
  avg_time_per_request: number;
}

interface DailyUsageData {
  daily: DailyStats[];
  summary: UsageSummary;
  date_range: {
    start: string | null;
    end: string | null;
  };
}

const LLMConfig: React.FC = () => {
  const { message } = App.useApp();
  const [loading, setLoading] = useState(false);
  const [usageData, setUsageData] = useState<DailyUsageData | null>(null);
  const [dateRange, setDateRange] = useState<[Dayjs, Dayjs]>([
    dayjs().subtract(6, 'day'),
    dayjs(),
  ]);
  const [selectedModel, setSelectedModel] = useState<string>('');
  const [modelOptions, setModelOptions] = useState<{ label: string; value: string }[]>([]);

  useEffect(() => {
    loadModelOptions();
    loadUsage();
  }, []);

  const loadModelOptions = async () => {
    try {
      const configs = await llmApi.getConfigs();
      const uniqueModels = [...new Set(configs.map((c: LLMConfigType) => c.model_name).filter(Boolean))];
      setModelOptions([
        { label: '全部模型', value: '' },
        ...uniqueModels.map((m: string) => ({ label: m, value: m })),
      ]);
    } catch {
      setModelOptions([{ label: '全部模型', value: '' }]);
    }
  };

  const loadUsage = async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = {};
      if (dateRange[0] && dateRange[1]) {
        params.start_date = dateRange[0].format('YYYY-MM-DD');
        params.end_date = dateRange[1].format('YYYY-MM-DD');
      }
      if (selectedModel && selectedModel !== '') {
        params.model_name = selectedModel;
      }

      const response = await api.get('/llm/usage', { params });

      if (response.code === 200 && response.data) {
        setUsageData(response.data);
      } else {
        setUsageData(emptyData());
      }
    } catch (error) {
      setUsageData(emptyData());
    } finally {
      setLoading(false);
    }
  };

  const emptyData = (): DailyUsageData => ({
    daily: [],
    summary: { total_requests: 0, total_tokens: 0, avg_tokens_per_request: 0, avg_time_per_request: 0 },
    date_range: { start: null, end: null },
  });

  const handleDateChange = (dates: [Dayjs | null, Dayjs | null] | null) => {
    if (dates && dates[0] && dates[1]) {
      setDateRange([dates[0], dates[1]]);
    }
  };

  const handleSearch = () => {
    loadUsage();
  };

  const handleExport = async (format: string = 'json') => {
    try {
      const params: Record<string, string> = { format };
      if (selectedModel && selectedModel !== '') {
        params.model_name = selectedModel;
      }
      if (dateRange[0] && dateRange[1]) {
        params.start_date = dateRange[0].format('YYYY-MM-DD');
        params.end_date = dateRange[1].format('YYYY-MM-DD');
      }
      const response = await api.get('/llm/usage/export', { params });

      if (response.code === 200) {
        const data = response.data;
        if (format === 'csv') {
          const csvContent = data;
          const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8' });
          downloadBlob(blob, `llm_usage_export.csv`);
        } else {
          const jsonStr = JSON.stringify(data, null, 2);
          const blob = new Blob([jsonStr], { type: 'application/json' });
          downloadBlob(blob, `llm_usage_export.json`);
        }
        message.success('使用数据已导出');
      } else {
        message.error('导出使用数据失败：' + response.message);
      }
    } catch (error) {
      message.error('导出使用数据失败：' + String(error));
    }
  };

  const downloadBlob = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  };

  const getRequestsChartOption = () => {
    const dates = usageData?.daily.map(d => dayjs(d.date).format('MM-DD')) || [];
    const requests = usageData?.daily.map(d => d.requests) || [];

    return {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      grid: { left: '3%', right: '3%', bottom: '3%', top: 30, containLabel: true },
      xAxis: { type: 'category', data: dates, axisLabel: { rotate: 45, fontSize: 11, margin: 8 }, boundaryGap: true },
      yAxis: { type: 'value', name: '请求数' },
      series: [{ name: '请求数', type: 'bar', data: requests, itemStyle: { color: '#5470c6', borderRadius: [4, 4, 0, 0] }, barWidth: '40%', barMaxWidth: 50 }],
      barCategoryGap: '60%',
    };
  };

  const getTokensChartOption = () => {
    const dates = usageData?.daily.map(d => dayjs(d.date).format('MM-DD')) || [];
    const tokens = usageData?.daily.map(d => d.tokens) || [];

    return {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      grid: { left: '3%', right: '3%', bottom: '3%', top: 30, containLabel: true },
      xAxis: { type: 'category', data: dates, axisLabel: { rotate: 45, fontSize: 11, margin: 8 }, boundaryGap: true },
      yAxis: { type: 'value', name: 'Token数' },
      series: [{ name: 'Token数', type: 'bar', data: tokens, itemStyle: { color: '#5470c6', borderRadius: [4, 4, 0, 0] }, barWidth: '40%', barMaxWidth: 50 }],
      barCategoryGap: '60%',
    };
  };

  const summary = usageData?.summary || {
    total_requests: 0,
    total_tokens: 0,
    avg_tokens_per_request: 0,
    avg_time_per_request: 0,
  };

  return (
    <div>
      <Card
        title={
          <Space>
            <BarChartOutlined />
            <span>使用统计</span>
          </Space>
        }
        extra={
          <Space wrap>
            <Select
              placeholder="选择模型"
              value={selectedModel}
              onChange={(val) => setSelectedModel(val)}
              style={{ width: 180 }}
              options={modelOptions}
              allowClear
            />
            <RangePicker
              value={dateRange}
              onChange={handleDateChange}
              format="YYYY-MM-DD"
              allowClear={false}
              style={{ width: 240 }}
            />
            <Button type="primary" onClick={handleSearch} loading={loading}>
              查询
            </Button>
            <Tooltip title="刷新">
              <Button icon={<ReloadOutlined />} onClick={loadUsage} loading={loading}>
                刷新
              </Button>
            </Tooltip>
            <Tooltip title="导出 CSV">
              <Button icon={<DownloadOutlined />} onClick={() => handleExport('csv')}>
                导出
              </Button>
            </Tooltip>
          </Space>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Row gutter={16} style={{ minHeight: 300 }}>
            <Col span={12}>
              <div style={{ border: '1px solid #f0f0f0', borderRadius: 8, padding: 12 }}>
                <div style={{ fontWeight: 500, marginBottom: 8 }}>请求数统计</div>
                <ReactECharts
                  option={getRequestsChartOption()}
                  style={{ height: 280, width: '100%' }}
                  opts={{ renderer: 'canvas' }}
                />
              </div>
            </Col>
            <Col span={12}>
              <div style={{ border: '1px solid #f0f0f0', borderRadius: 8, padding: 12 }}>
                <div style={{ fontWeight: 500, marginBottom: 8 }}>Token 数统计</div>
                <ReactECharts
                  option={getTokensChartOption()}
                  style={{ height: 280, width: '100%' }}
                  opts={{ renderer: 'canvas' }}
                />
              </div>
            </Col>
          </Row>

          <Row gutter={24}>
            <Col span={6}>
              <Statistic title="总请求数" value={summary.total_requests} />
            </Col>
            <Col span={6}>
              <Statistic title="总 Token 数" value={summary.total_tokens} />
            </Col>
            <Col span={6}>
              <Statistic title="平均 Token/请求" value={summary.avg_tokens_per_request.toFixed(2)} />
            </Col>
            <Col span={6}>
              <Statistic title="平均耗时 (秒)" value={summary.avg_time_per_request.toFixed(2)} />
            </Col>
          </Row>
        </div>
      </Card>
    </div>
  );
};

export default LLMConfig;
