import React, { useEffect, useState } from 'react';
import { Typography, App, Empty, Spin, Modal } from 'antd';
import { ApiOutlined } from '@ant-design/icons';
import { mcpApi, MCPServer } from '../../services/mcpApi';
import MCPAddServerModal from './MCPAddServerModal';
import UnifiedCard from '../common/UnifiedCard';
import PageHeader from '../common/PageHeader';
import { getDefaultIcon } from '../../utils/iconLibrary';
import MCPTestRunModal from './MCPTestRunModal';

const { Text } = Typography;

const MCPManager: React.FC = () => {
  const { message } = App.useApp();
  const [loading, setLoading] = useState(false);
  const [servers, setServers] = useState<MCPServer[]>([]);
  const [filteredServers, setFilteredServers] = useState<MCPServer[]>([]);
  const [addModalVisible, setAddModalVisible] = useState(false);
  const [editingServer, setEditingServer] = useState<MCPServer | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [testRunServer, setTestRunServer] = useState<MCPServer | null>(null);

  const loadServerList = async () => {
    setLoading(true);
    try {
      const response = await mcpApi.getServers();
      if (response.code === 200) {
        setServers(response.data || []);
        setFilteredServers(response.data || []);
      }
    } catch (error) {
      message.error('加载 MCP 工具列表失败：' + String(error));
    } finally {
      setLoading(false);
    }
  };

  const handleAddServer = () => {
    setEditingServer(null);
    setAddModalVisible(true);
  };

  const handleEditServer = (server: MCPServer) => {
    setEditingServer(server);
    setAddModalVisible(true);
  };

  const handleDeleteServer = async (serverId: string) => {
    try {
      await mcpApi.deleteServer(serverId);
      message.success('MCP 工具已删除');
      loadServerList();
    } catch (error) {
      message.error('删除 MCP 工具失败：' + String(error));
    }
  };

  const handleToggleEnable = async (server: MCPServer, checked: boolean) => {
    try {
      await mcpApi.updateServer(server.id, { is_active: checked });
      message.success(checked ? 'MCP 工具已启用' : 'MCP 工具已停用');
      loadServerList();
    } catch (error) {
      message.error('操作失败：' + String(error));
    }
  };

  const handleTestRun = (server: MCPServer) => {
    setTestRunServer(server);
  };

  const handleRefresh = () => {
    loadServerList();
  };

  const handleSaveServer = () => {
    setAddModalVisible(false);
    setEditingServer(null);
    loadServerList();
  };

  const handleIconChange = async (server: MCPServer, icon: string) => {
    try {
      await mcpApi.updateServer(server.id, { icon });
      message.success('图标已更新');
      loadServerList();
    } catch (error) {
      message.error('更新图标失败');
    }
  };

  const handleTagToggle = (tag: string) => {
    setSelectedTags(prev => {
      if (prev.includes(tag)) {
        return prev.filter(t => t !== tag);
      } else {
        return [...prev, tag];
      }
    });
  };

  const getTransportType = (server: MCPServer) => {
    return server.source || server.transport || server.transport_type || 'stdio';
  };

  const allTags = Array.from(new Set(
    servers.flatMap(server => server.tags || [])
  )).sort();

  useEffect(() => {
    loadServerList();
  }, []);

  useEffect(() => {
    let result = servers;

    if (selectedTags.length > 0) {
      result = result.filter(server => {
        const serverTags = server.tags || [];
        return selectedTags.some(tag => serverTags.includes(tag));
      });
    }

    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter(server => {
        const matchesName = server.name.toLowerCase().includes(query);
        const matchesDesc = server.description?.toLowerCase().includes(query);
        const matchesTags = server.tags?.some(tag => tag.toLowerCase().includes(query));
        return matchesName || matchesDesc || matchesTags;
      });
    }

    setFilteredServers(result);
  }, [searchQuery, selectedTags, servers]);

  return (
    <div style={{ padding: '24px', backgroundColor: 'var(--bg-secondary)', minHeight: '100%' }}>
      <PageHeader
        icon={<ApiOutlined />}
        title="MCP 工具"
        subtitle="管理模型上下文协议（MCP）工具"
        searchPlaceholder="搜索 MCP..."
        searchValue={searchQuery}
        onSearchChange={setSearchQuery}
        allTags={allTags}
        selectedTags={selectedTags}
        onTagToggle={handleTagToggle}
        primaryButton={{
          text: '新建 MCP',
          icon: (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19"></line>
              <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
          ),
          onClick: handleAddServer,
        }}
        showRefresh={true}
        onRefresh={handleRefresh}
        refreshLoading={loading}
      />

      {loading && servers.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '48px' }}>
          <Spin size="large" />
        </div>
      ) : filteredServers.length === 0 ? (
        <Empty
          style={{ padding: '60px 20px' }}
          description={
            <span>
              {searchQuery || selectedTags.length > 0 ? '没有找到匹配的 MCP 工具' : '暂无 MCP 工具'}
              <br />
              {!searchQuery && selectedTags.length === 0 && (
                <Text type="secondary" style={{ fontSize: 13 }}>
                  点击上方"新建 MCP"按钮创建您的第一个工具
                </Text>
              )}
            </span>
          }
        />
      ) : (
        <div
          className="cards-grid"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(5, 1fr)',
            gap: '12px',
          }}
        >
          {filteredServers.map((server) => {
            const isSystem = server.user_id === 'system';
            // 只从数据库读取标签，不前端动态添加
            const allTags = server.tags || [];
            return (
              <UnifiedCard
                key={server.id}
                id={server.id}
                name={server.name}
                description={server.description || ''}
                icon={server.icon || getDefaultIcon('mcp')}
                tags={allTags}
                isActive={server.is_active}
                showSwitch={true}
                meta1={{ 
                  label: '超时', 
                  value: `${server.timeout || 30}s` 
                }}
                meta2={{ 
                  label: '传输', 
                  value: getTransportType(server).toUpperCase() 
                }}
                updatedAt={server.updated_at}
                isSystem={isSystem}
                onIconChange={(icon: string) => handleIconChange(server, icon)}
                onSwitchChange={(checked: boolean) => handleToggleEnable(server, checked)}
                onClick={() => handleEditServer(server)}
                onPlay={() => handleTestRun(server)}
                onDelete={() => handleDeleteServer(server.id)}
                deleteConfirmText="确定要删除此MCP工具吗？"
              />
            );
          })}
        </div>
      )}

      <MCPAddServerModal
        visible={addModalVisible}
        server={editingServer as any}
        onClose={() => {
          setAddModalVisible(false);
          setEditingServer(null);
        }}
        onSave={handleSaveServer}
      />

      <MCPTestRunModal
        visible={!!testRunServer}
        server={testRunServer}
        onClose={() => setTestRunServer(null)}
      />
    </div>
  );
};

export default MCPManager;
