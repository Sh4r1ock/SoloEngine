import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Modal, Input, Typography, App, Empty, Spin } from 'antd';
import { AppstoreOutlined } from '@ant-design/icons';
import { agenticFlowApi, AgenticFlow } from '../../services/agenticFlowApi';
import UnifiedCard from '../../components/common/UnifiedCard';
import PageHeader from '../../components/common/PageHeader';
import { getDefaultIcon, getRandomIcon } from '../../utils/iconLibrary';

const { Text } = Typography;
const { TextArea } = Input;

const AgenticFlowList: React.FC = () => {
  const { message } = App.useApp();
  const navigate = useNavigate();
  const [flows, setFlows] = useState<AgenticFlow[]>([]);
  const [loading, setLoading] = useState(true);
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [newFlowName, setNewFlowName] = useState('');
  const [newFlowDescription, setNewFlowDescription] = useState('');
  const [creating, setCreating] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);

  useEffect(() => {
    loadFlows();
  }, []);

  const loadFlows = async () => {
    setLoading(true);
    try {
      const data = await agenticFlowApi.getFlows();
      setFlows(data);
    } catch (error) {
      message.error('加载Agentic列表失败');
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async () => {
    if (!newFlowName.trim()) {
      message.warning('请输入Agentic名称');
      return;
    }

    setCreating(true);
    
    try {
      const flow = await agenticFlowApi.createFlow({
        name: newFlowName,
        description: newFlowDescription,
        icon: getDefaultIcon('agenticFlow'),
      });
      
      setCreateModalVisible(false);
      setNewFlowName('');
      setNewFlowDescription('');
      
      message.success('创建成功');
      
      await loadFlows();
      
      if (flow && flow.id) {
        setTimeout(() => {
          navigate(`/editor/${flow.id}`);
        }, 500);
      }
    } catch (error: any) {
      const errorMessage = error?.response?.data?.message || error?.message || '创建失败，请重试';
      message.error(errorMessage);
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (agenticFlowId: string) => {
    try {
      await agenticFlowApi.deleteFlow(agenticFlowId);
      message.success('删除成功');
      loadFlows();
    } catch (error) {
      message.error('删除失败');
    }
  };

  const handleDuplicate = async (flow: AgenticFlow) => {
    try {
      await agenticFlowApi.createFlow({
        name: `${flow.name} (副本)`,
        description: flow.description ?? undefined,
        canvas_data: flow.canvas_data,
        icon: flow.icon || getDefaultIcon('agenticFlow'),
      });
      message.success('复制成功');
      loadFlows();
    } catch (error) {
      message.error('复制失败');
    }
  };

  const handleIconChange = async (flow: AgenticFlow, icon: string) => {
    try {
      await agenticFlowApi.updateFlow(flow.id, { icon });
      message.success('图标已更新');
      loadFlows();
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

  const allTags = Array.from(new Set(
    flows.flatMap(flow => [
      ...(flow.is_template ? ['system'] : []),
    ])
  )).sort();

  const filteredFlows = flows.filter(flow => {
    const matchesSearch = !searchQuery || 
      flow.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (flow.description?.toLowerCase().includes(searchQuery.toLowerCase()) || false);
    
    const matchesTags = selectedTags.length === 0 || 
      (flow.is_template && selectedTags.includes('system'));
    
    return matchesSearch && matchesTags;
  });

  return (
    <div style={{ padding: '24px', backgroundColor: 'var(--bg-secondary)', minHeight: '100%' }}>
      <PageHeader
        icon={<AppstoreOutlined />}
        title="AgenticFlow"
        subtitle="创建和管理您的AI智能体工作流"
        searchPlaceholder="搜索 AgenticFlow..."
        searchValue={searchQuery}
        onSearchChange={setSearchQuery}
        allTags={allTags}
        selectedTags={selectedTags}
        onTagToggle={handleTagToggle}
        primaryButton={{
          text: '新建 Agentic',
          icon: (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19"></line>
              <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
          ),
          onClick: () => setCreateModalVisible(true),
        }}
      />

      {loading ? (
        <div style={{ textAlign: 'center', padding: '100px 0' }}>
          <Spin size="large" />
        </div>
      ) : filteredFlows.length === 0 ? (
        <Empty
          style={{ padding: '60px 20px' }}
          description={
            <span>
              {searchQuery || selectedTags.length > 0 ? '没有找到匹配的 AgenticFlow' : '暂无 AgenticFlow'}
              <br />
              {!searchQuery && selectedTags.length === 0 && (
                <Text type="secondary" style={{ fontSize: 13 }}>
                  点击上方"新建 Agentic"按钮创建您的第一个智能体
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
          {filteredFlows.map(flow => {
            const isSystem = flow.user_id === 'system';
            const tags = flow.tags || [];
            return (
              <UnifiedCard
                key={flow.id}
                id={flow.id}
                name={flow.name}
                description={flow.description || undefined}
                icon={flow.icon || getDefaultIcon('agenticFlow')}
                tags={tags}
                isTemplate={flow.is_template}
                isSystem={isSystem}
                updatedAt={flow.updated_at}
                onIconChange={(icon: string) => handleIconChange(flow, icon)}
                onClick={(e?: React.MouseEvent) => {
                  if (e?.ctrlKey || e?.metaKey) {
                    window.open(`/editor/${flow.id}`, '_blank');
                  } else {
                    navigate(`/editor/${flow.id}`);
                  }
                }}
                onPlay={(e?: React.MouseEvent) => {
                  if (e?.ctrlKey || e?.metaKey) {
                    window.open(`/run/${flow.id}`, '_blank');
                  } else {
                    navigate(`/run/${flow.id}`);
                  }
                }}
                onCopy={() => handleDuplicate(flow)}
                onDelete={() => handleDelete(flow.id)}
                deleteConfirmText="确定要删除此Agentic吗？"
              />
            );
          })}
        </div>
      )}

      <Modal
        title="新建 Agentic"
        open={createModalVisible}
        onOk={handleCreate}
        onCancel={() => {
          setCreateModalVisible(false);
          setNewFlowName('');
          setNewFlowDescription('');
        }}
        okText="创建"
        cancelText="取消"
        confirmLoading={creating}
        okButtonProps={{ disabled: !newFlowName.trim() }}
      >
        <div style={{ marginBottom: '16px' }}>
          <div style={{ marginBottom: '8px' }}>
            <Text>名称 <Text type="danger">*</Text></Text>
          </div>
          <Input
            placeholder="请输入Agentic名称"
            value={newFlowName}
            onChange={e => setNewFlowName(e.target.value)}
            maxLength={100}
            showCount
          />
        </div>
        <div style={{ marginBottom: '16px' }}>
          <div style={{ marginBottom: '8px' }}>
            <Text>描述</Text>
          </div>
          <div style={{ position: 'relative' }}>
            <TextArea
              placeholder="请输入Agentic描述（可选）"
              value={newFlowDescription}
              onChange={e => setNewFlowDescription(e.target.value)}
              rows={3}
              maxLength={500}
              style={{ padding: '8px 12px 24px 12px' }}
            />
            <div
              style={{
                position: 'absolute',
                bottom: '8px',
                right: '12px',
                fontSize: '14px',
                color: 'rgba(0, 0, 0, 0.45)',
                pointerEvents: 'none',
              }}
            >
              {newFlowDescription.length} / 500
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
};

export default AgenticFlowList;
