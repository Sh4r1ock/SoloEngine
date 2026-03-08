import React, { useEffect, useState } from 'react';
import { Select, Button, message, Space, Typography, Card, Divider, Spin } from 'antd';
import { GlobalOutlined, ClockCircleOutlined } from '@ant-design/icons';
import { getTimezone, setTimezone, getTimezoneList, getCurrentTime, TimezoneListResponse, CurrentTimeResponse } from '../../services/settingsApi';
import { setUserTimezone, formatDateTime } from '../../utils/timezone';

const { Text, Title } = Typography;

const TimezoneSettings: React.FC = () => {
  const [timezone, setTimezoneState] = useState('Asia/Shanghai');
  const [timezones, setTimezones] = useState<string[]>([]);
  const [commonTimezones, setCommonTimezones] = useState<string[]>([]);
  const [currentTime, setCurrentTime] = useState<CurrentTimeResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [tzRes, listRes, timeRes] = await Promise.all([
        getTimezone(),
        getTimezoneList(),
        getCurrentTime(),
      ]);
      
      setTimezoneState(tzRes.timezone);
      setTimezones(listRes.timezones);
      setCommonTimezones(listRes.common_timezones);
      setCurrentTime(timeRes);
      setUserTimezone(tzRes.timezone);
    } catch (error) {
      console.error('Failed to load timezone settings:', error);
      message.error('加载时区设置失败');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const result = await setTimezone(timezone);
      if (result.success) {
        setUserTimezone(timezone);
        message.success('时区设置已保存');
        const timeRes = await getCurrentTime();
        setCurrentTime(timeRes);
      } else {
        message.error(result.message || '设置失败');
      }
    } catch (error) {
      console.error('Failed to save timezone:', error);
      message.error('保存时区设置失败');
    } finally {
      setSaving(false);
    }
  };

  const handleTimezoneChange = (value: string) => {
    setTimezoneState(value);
  };

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '40px' }}>
        <Spin />
      </div>
    );
  }

  const filterOption = (input: string, option?: { label: string; value: string }) =>
    (option?.label ?? '').toLowerCase().includes(input.toLowerCase());

  return (
    <div style={{ padding: '16px 0' }}>
      <Card size="small" style={{ marginBottom: 16 }}>
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          <div>
            <Text strong style={{ display: 'block', marginBottom: 8 }}>
              <GlobalOutlined style={{ marginRight: 8 }} />
              选择时区
            </Text>
            <Select
              value={timezone}
              onChange={handleTimezoneChange}
              showSearch
              filterOption={filterOption}
              style={{ width: '100%' }}
              placeholder="搜索或选择时区"
              options={[
                {
                  label: '常用时区',
                  options: commonTimezones.map(tz => ({ label: tz, value: tz })),
                },
                {
                  label: '所有时区',
                  options: timezones.map(tz => ({ label: tz, value: tz })),
                },
              ]}
            />
          </div>

          <Button type="primary" onClick={handleSave} loading={saving}>
            保存设置
          </Button>
        </Space>
      </Card>

      {currentTime && (
        <Card size="small" title={<><ClockCircleIcon /> 当前时间</>}>
          <Space direction="vertical" style={{ width: '100%' }}>
            <div>
              <Text type="secondary">用户时区时间：</Text>
              <Text strong>{currentTime.formatted_user}</Text>
            </div>
            <div>
              <Text type="secondary">UTC 时间：</Text>
              <Text>{currentTime.formatted_utc}</Text>
            </div>
            <div>
              <Text type="secondary">当前时区：</Text>
              <Text code>{currentTime.user_timezone}</Text>
            </div>
          </Space>
        </Card>
      )}

      <Divider style={{ margin: '16px 0' }} />

      <div style={{ color: '#666', fontSize: 12 }}>
        <Text type="secondary">
          时区设置会影响系统中所有时间的显示。选择正确的时区可以确保时间显示准确。
        </Text>
      </div>
    </div>
  );
};

const ClockCircleIcon: React.FC = () => <ClockCircleOutlined style={{ marginRight: 8 }} />;

export default TimezoneSettings;
