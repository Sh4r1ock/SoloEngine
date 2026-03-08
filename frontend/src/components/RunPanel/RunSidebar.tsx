import React, { useEffect } from 'react';
import { List, Typography, Tag, Input, Space, Empty, Spin } from 'antd';
import { SearchOutlined, HistoryOutlined } from '@ant-design/icons';
import { useRunStore, ExtendedRunSession } from '../../store/runStore';
import { runApi } from '../../services/runApi';
import { formatTimeShort } from '../../utils/timezone';

const { Search } = Input;
const { Text, Title } = Typography;

const RunSidebar: React.FC = () => {
  const {
    sessions,
    activeSessionId,
    setActiveSession,
    searchQuery,
    setSearchQuery,
  } = useRunStore();

  const [loading, setLoading] = React.useState(false);

  useEffect(() => {
    loadSessions();
  }, []);

  const loadSessions = async () => {
    setLoading(true);
    try {
      const response = await runApi.getSessions({ limit: 50 });
      console.log('Loaded sessions:', response.length);
    } catch (error) {
      console.error('加载会话失败：', error);
    } finally {
      setLoading(false);
    }
  };

  const filteredSessions = sessions.filter((session: ExtendedRunSession) => {
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      return (
        (session.agentName?.toLowerCase().includes(query)) ||
        session.id.toLowerCase().includes(query)
      );
    }
    return true;
  });

  const formatTime = (timestamp: number) => {
    return formatTimeShort(new Date(timestamp).toISOString());
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'running': return 'green';
      case 'completed': return 'blue';
      case 'error': return 'red';
      default: return 'default';
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'running': return '运行中';
      case 'completed': return '已完成';
      case 'error': return '错误';
      default: return status;
    }
  };

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '16px', borderBottom: '1px solid var(--bg-300)' }}>
        <Title level={5} style={{ marginBottom: 12 }}>
          <HistoryOutlined /> 运行会话
        </Title>
        <Search
          placeholder="搜索会话..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          prefix={<SearchOutlined />}
          style={{ marginBottom: 8 }}
          allowClear
        />
      </div>

      <div style={{ flex: 1, overflow: 'auto' }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: '24px' }}>
            <Spin />
          </div>
        ) : filteredSessions.length === 0 ? (
          <Empty
            description="暂无运行会话"
            style={{ padding: '24px' }}
          />
        ) : (
          <List
            dataSource={filteredSessions}
            renderItem={(session: ExtendedRunSession) => (
              <List.Item
                key={session.id}
                onClick={() => setActiveSession(session.id)}
                style={{
                  cursor: 'pointer',
                  background: activeSessionId === session.id ? 'var(--primary-50)' : 'transparent',
                  padding: '12px 16px',
                  transition: 'background 0.2s',
                }}
              >
                <List.Item.Meta
                  title={
                    <Space size={4}>
                      <Text strong style={{ fontSize: 13 }}>
                        {session.agentName || 'Unknown Agent'}
                      </Text>
                      <Tag color={getStatusColor(session.status)} style={{ margin: 0, fontSize: 11 }}>
                        {getStatusText(session.status)}
                      </Tag>
                    </Space>
                  }
                  description={
                    <div>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {formatTime(session.startTime || Date.now())}
                      </Text>
                      <div style={{ marginTop: 4 }}>
                        <Text type="secondary" style={{ fontSize: 11 }}>
                          {(session.messages?.length || 0)} 条消息 · {(session.toolCalls?.length || 0)} 次工具调用
                        </Text>
                      </div>
                    </div>
                  }
                />
              </List.Item>
            )}
          />
        )}
      </div>
    </div>
  );
};

export default RunSidebar;
