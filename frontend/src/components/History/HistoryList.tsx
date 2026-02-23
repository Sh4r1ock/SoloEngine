import React, { useEffect, useState } from 'react';
import { List, Card, Tag, Typography, Space, Button, Empty, Spin, message } from 'antd';
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  ClockCircleOutlined,
  PlayCircleOutlined,
  EyeOutlined,
  DeleteOutlined,
} from '@ant-design/icons';
import { api } from '../../services/api';

const { Text, Title } = Typography;

interface ExecutionRecord {
  execution_id: string;
  project_name: string;
  status: string;
  start_time: string;
  end_time?: string;
  duration_ms?: number;
  input_message?: string;
  output_message?: string;
  error?: string;
}

interface HistoryListProps {
  projectName?: string;
  onSelect?: (record: ExecutionRecord) => void;
}

const HistoryList: React.FC<HistoryListProps> = ({ projectName, onSelect }) => {
  const [loading, setLoading] = useState(false);
  const [records, setRecords] = useState<ExecutionRecord[]>([]);

  const loadRecords = async () => {
    setLoading(true);
    try {
      const params: any = { limit: 50 };
      if (projectName) {
        params.project_name = projectName;
      }
      const response = await api.get('/api/v1/history/list', { params });
      if (response.code === 200) {
        setRecords(response.data);
      }
    } catch (error) {
      message.error('加载历史记录失败：' + String(error));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRecords();
  }, [projectName]);

  const getStatusTag = (status: string) => {
    switch (status) {
      case 'completed':
        return <Tag icon={<CheckCircleOutlined />} color="success">完成</Tag>;
      case 'failed':
        return <Tag icon={<CloseCircleOutlined />} color="error">失败</Tag>;
      case 'running':
        return <Tag icon={<PlayCircleOutlined />} color="processing">运行中</Tag>;
      default:
        return <Tag icon={<ClockCircleOutlined />} color="default">等待</Tag>;
    }
  };

  const handleDelete = async (executionId: string) => {
    try {
      const response = await api.delete(`/api/v1/history/${executionId}`);
      if (response.code === 200) {
        message.success('删除成功');
        loadRecords();
      }
    } catch (error) {
      message.error('删除失败：' + String(error));
    }
  };

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: 48 }}>
        <Spin size="large" />
      </div>
    );
  }

  if (records.length === 0) {
    return <Empty description="暂无执行历史" />;
  }

  return (
    <List
      dataSource={records}
      renderItem={(record) => (
        <List.Item
          actions={[
            <Button
              key="view"
              type="link"
              icon={<EyeOutlined />}
              onClick={() => onSelect?.(record)}
            >
              查看
            </Button>,
            <Button
              key="delete"
              type="link"
              danger
              icon={<DeleteOutlined />}
              onClick={() => handleDelete(record.execution_id)}
            >
              删除
            </Button>,
          ]}
        >
          <List.Item.Meta
            title={
              <Space>
                <Text strong>{record.project_name}</Text>
                {getStatusTag(record.status)}
              </Space>
            }
            description={
              <Space direction="vertical" size={0}>
                <Text type="secondary">
                  开始: {new Date(record.start_time).toLocaleString()}
                </Text>
                {record.duration_ms && (
                  <Text type="secondary">
                    耗时: {(record.duration_ms / 1000).toFixed(2)}s
                  </Text>
                )}
                {record.input_message && (
                  <Text ellipsis style={{ maxWidth: 300 }}>
                    输入: {record.input_message}
                  </Text>
                )}
              </Space>
            }
          />
        </List.Item>
      )}
    />
  );
};

export default HistoryList;
