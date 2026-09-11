import React, { useEffect, useState } from 'react';
import { Card, Button, App, Space, DatePicker, Row, Col, Statistic, Tooltip, Select, Table } from 'antd';
import { BarChartOutlined, ReloadOutlined, DownloadOutlined } from '@ant-design/icons';
import ReactECharts from 'echarts-for-react';
import dayjs, { Dayjs } from 'dayjs';
import { api } from '../../services/api';
import { llmApi, LLMConfig as LLMConfigType } from '../../services/llmApi';
import { downloadBlob } from '../../utils/download';

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
  const [usageRecords, setUsageRecords] = useState<any[]>([]);

  const buildQueryParams = (): Record<string, string> => {
    const params: Record<string, string> = {};
    if (dateRange[0] && dateRange[1]) {
      params.start_date = dateRange[0].format('YYYY-MM-DD');
      params.end_date = dateRange[1].format('YYYY-MM-DD');
    }
    if (selectedModel && selectedModel !== '') {
      params.model_name = selectedModel;
    }
    return params;
  };

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
      const params = buildQueryParams();
      const [usageResp, exportResp] = await Promise.all([
        api.get('/llm/usage', { params }),
        api.get('/llm/usage/export', { params: { ...params, format: 'json' } }),
      ]);

      if (usageResp.code === 200 && usageResp.data) {
        setUsageData(usageResp.data);
      } else {
        setUsageData(emptyData());
      }
      if (exportResp.code === 200) {
        setUsageRecords(exportResp.data || []);
      } else {
        setUsageRecords([]);
      }
    } catch (error) {
      setUsageData(emptyData());
      setUsageRecords([]);
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
      const params = buildQueryParams();
      params.format = format;
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

  const recordColumns = [
    { title: '序号', dataIndex: 'num', width: 70 },
    { title: '时间', dataIndex: 'timestamp', width: 170, render: (v: string) => dayjs(v).format('YYYY-MM-DD HH:mm:ss') },
    { title: '提供商', dataIndex: 'provider', width: 110 },
    { title: '模型', dataIndex: 'model_name', width: 150 },
    { title: '输入 Token', dataIndex: 'input_tokens', width: 110, align: 'right' as const },
    { title: '输出 Token', dataIndex: 'output_tokens', width: 110, align: 'right' as const },
    { title: '总 Token', dataIndex: 'total_tokens', width: 110, align: 'right' as const },
    { title: '耗时 (秒)', dataIndex: 'duration_ms', width: 100, align: 'right' as const, render: (v: number) => (v / 1000).toFixed(2) },
  ];

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

          <div style={{ border: '1px solid #f0f0f0', borderRadius: 8, padding: 12 }}>
            <div style={{ fontWeight: 500, marginBottom: 8 }}>使用明细</div>
            <Table
              columns={recordColumns}
              dataSource={usageRecords}
              rowKey="request_id"
              size="small"
              loading={loading}
              pagination={{ pageSize: 10, showSizeChanger: false, showTotal: (t) => `共 ${t} 条` }}
              scroll={{ x: 'max-content' }}
            />
          </div>
        </div>
      </Card>
    </div>
  );
};

export default LLMConfig;
