import React, { useEffect, useState } from 'react';
import { Card, Button, message, Space, DatePicker, Row, Col, Statistic, Popconfirm, Tooltip } from 'antd';
import { BarChartOutlined, ReloadOutlined, DownloadOutlined, DeleteOutlined } from '@ant-design/icons';
import ReactECharts from 'echarts-for-react';
import dayjs, { Dayjs } from 'dayjs';
import { api } from '../../services/api';

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
  const [loading, setLoading] = useState(false);
  const [usageData, setUsageData] = useState<DailyUsageData | null>(null);
  const [dateRange, setDateRange] = useState<[Dayjs, Dayjs]>([
    dayjs().subtract(6, 'day'),
    dayjs(),
  ]);

  useEffect(() => {
    loadUsage();
  }, []);

  const loadUsage = async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = {};
      if (dateRange[0] && dateRange[1]) {
        params.start_date = dateRange[0].format('YYYY-MM-DD');
        params.end_date = dateRange[1].format('YYYY-MM-DD');
      }

      const response = await api.get('/llm/usage/daily', { params });

      if (response.code === 200 && response.data) {
        setUsageData(response.data);
      } else {
        setUsageData({
          daily: [],
          summary: {
            total_requests: 0,
            total_tokens: 0,
            avg_tokens_per_request: 0,
            avg_time_per_request: 0,
          },
          date_range: { start: null, end: null },
        });
      }
    } catch (error) {
      setUsageData({
        daily: [],
        summary: {
          total_requests: 0,
          total_tokens: 0,
          avg_tokens_per_request: 0,
          avg_time_per_request: 0,
        },
        date_range: { start: null, end: null },
      });
    } finally {
      setLoading(false);
    }
  };

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
      const response = await api.get('/llm/usage/export', {
        params: { format },
      });

      if (response.code === 200) {
        message.success('使用数据已导出');
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
        message.success(`已清除 ${response.data?.removed_count || 0} 条历史记录`);
        loadUsage();
      } else {
        message.error('清除历史数据失败：' + response.message);
      }
    } catch (error) {
      message.error('清除历史数据失败：' + String(error));
    }
  };

  const getRequestsChartOption = () => {
    const dates = usageData?.daily.map(d => dayjs(d.date).format('MM-DD')) || [];
    const requests = usageData?.daily.map(d => d.requests) || [];

    return {
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
      },
      grid: {
        left: '3%',
        right: '3%',
        bottom: '3%',
        top: 30,
        containLabel: true,
      },
      xAxis: {
        type: 'category',
        data: dates,
        axisLabel: { rotate: 45, fontSize: 11, margin: 8 },
        boundaryGap: true,
      },
      yAxis: {
        type: 'value',
        name: '请求数',
      },
      series: [{
        name: '请求数',
        type: 'bar',
        data: requests,
        itemStyle: {
          color: '#5470c6',
          borderRadius: [4, 4, 0, 0],
        },
        barWidth: 30,
        barMaxWidth: 30,
        barMinWidth: 30,
      }],
      barCategoryGap: '80%',
    };
  };

  const getTokensChartOption = () => {
    const dates = usageData?.daily.map(d => dayjs(d.date).format('MM-DD')) || [];
    const tokens = usageData?.daily.map(d => d.tokens) || [];

    return {
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
      },
      grid: {
        left: '3%',
        right: '3%',
        bottom: '3%',
        top: 30,
        containLabel: true,
      },
      xAxis: {
        type: 'category',
        data: dates,
        axisLabel: { rotate: 45, fontSize: 11, margin: 8 },
        boundaryGap: true,
      },
      yAxis: {
        type: 'value',
        name: 'Token数',
      },
      series: [{
        name: 'Token数',
        type: 'bar',
        data: tokens,
        itemStyle: {
          color: '#5470c6',
          borderRadius: [4, 4, 0, 0],
        },
        barWidth: 30,
        barMaxWidth: 30,
        barMinWidth: 30,
      }],
      barCategoryGap: '80%',
    };
  };

  const summary = usageData?.summary || {
    total_requests: 0,
    total_tokens: 0,
    avg_tokens_per_request: 0,
    avg_time_per_request: 0,
  };

  return (
    <div style={{ height: '100%' }}>
      <Card
        title={
          <Space>
            <BarChartOutlined />
            <span>使用统计</span>
          </Space>
        }
        extra={
          <Space>
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
            <Tooltip title="导出 JSON">
              <Button icon={<DownloadOutlined />} onClick={() => handleExport('json')}>
                导出
              </Button>
            </Tooltip>
            <Popconfirm
              title="确定要清除历史数据吗？"
              onConfirm={handleClearHistory}
              okText="确定"
              cancelText="取消"
            >
              <Button danger icon={<DeleteOutlined />}>
                清除历史
              </Button>
            </Popconfirm>
          </Space>
        }
        style={{ height: '100%', display: 'flex', flexDirection: 'column' }}
        styles={{ body: { flex: 1, overflow: 'auto', padding: 16 } }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 16 }}>
          <Row gutter={16} style={{ flex: 1, minHeight: 250 }}>
            <Col span={12} style={{ height: '100%' }}>
              <div style={{ height: '100%', border: '1px solid #f0f0f0', borderRadius: 8, padding: 12 }}>
                <div style={{ fontWeight: 500, marginBottom: 8 }}>请求数统计</div>
                <div style={{ height: 'calc(100% - 30px)' }}>
                  <ReactECharts
                    option={getRequestsChartOption()}
                    style={{ height: '100%', width: '100%' }}
                    opts={{ renderer: 'canvas' }}
                  />
                </div>
              </div>
            </Col>
            <Col span={12} style={{ height: '100%' }}>
              <div style={{ height: '100%', border: '1px solid #f0f0f0', borderRadius: 8, padding: 12 }}>
                <div style={{ fontWeight: 500, marginBottom: 8 }}>Token 数统计</div>
                <div style={{ height: 'calc(100% - 30px)' }}>
                  <ReactECharts
                    option={getTokensChartOption()}
                    style={{ height: '100%', width: '100%' }}
                    opts={{ renderer: 'canvas' }}
                  />
                </div>
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
