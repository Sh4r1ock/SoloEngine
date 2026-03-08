/**
 * @file AgenticFlowList.tsx
 * @description AgenticFlow列表页面 - 显示用户的所有Agentic
 * @author SoloEngine Team
 * @date 2026-02-19
 */
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Row, Col, Button, Modal, Input, Typography, message, Empty, Spin } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { agenticFlowApi, AgenticFlow } from '../../services/agenticFlowApi';
import UnifiedCard from '../../components/common/UnifiedCard';

const { Title, Text } = Typography;
const { TextArea } = Input;

const AgenticFlowList: React.FC = () => {
  const navigate = useNavigate();
  const [flows, setFlows] = useState<AgenticFlow[]>([]);
  const [loading, setLoading] = useState(true);
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [newFlowName, setNewFlowName] = useState('');
  const [newFlowDescription, setNewFlowDescription] = useState('');
  const [creating, setCreating] = useState(false);

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

  const handleDelete = async (flowId: string) => {
    try {
      await agenticFlowApi.deleteFlow(flowId);
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
      });
      message.success('复制成功');
      loadFlows();
    } catch (error) {
      message.error('复制失败');
    }
  };

  return (
    <div style={{ padding: '24px' }}>
      <div style={{ 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center',
        marginBottom: '24px' 
      }}>
        <div>
          <Title level={3} style={{ margin: 0 }}>Agentic 管理</Title>
          <Text type="secondary" style={{ fontSize: 13 }}>
            创建和管理您的AI智能体
          </Text>
        </div>
        <Button 
          type="primary" 
          icon={<PlusOutlined />}
          onClick={() => setCreateModalVisible(true)}
        >
          新建 Agentic
        </Button>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '100px 0' }}>
          <Spin size="large" />
        </div>
      ) : flows.length === 0 ? (
        <Empty
          style={{ padding: '60px 20px' }}
          description={
            <span>
              暂无 Agentic
              <br />
              <Text type="secondary" style={{ fontSize: 13 }}>
                点击上方"新建 Agentic"按钮创建您的第一个智能体
              </Text>
            </span>
          }
        />
      ) : (
        <Row gutter={[16, 16]}>
          {flows.map(flow => (
            <Col xs={24} sm={12} md={8} lg={6} key={flow.id}>
              <UnifiedCard
                name={flow.name}
                description={flow.description || undefined}
                isTemplate={flow.is_template}
                updatedAt={flow.updated_at}
                onClick={(e?: React.MouseEvent) => {
                  // Ctrl+左键点击时在新标签页打开
                  if (e?.ctrlKey || e?.metaKey) {
                    window.open(`/editor/${flow.id}`, '_blank');
                  } else {
                    navigate(`/editor/${flow.id}`);
                  }
                }}
                onPlay={(e?: React.MouseEvent) => {
                  // Ctrl+左键点击时在新标签页打开
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
            </Col>
          ))}
        </Row>
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
          <Text>名称 <Text type="danger">*</Text></Text>
          <Input
            placeholder="请输入Agentic名称"
            value={newFlowName}
            onChange={e => setNewFlowName(e.target.value)}
            style={{ marginTop: '8px' }}
            maxLength={100}
            showCount
          />
        </div>
        <div>
          <Text>描述</Text>
          <TextArea
            placeholder="请输入Agentic描述（可选）"
            value={newFlowDescription}
            onChange={e => setNewFlowDescription(e.target.value)}
            rows={3}
            style={{ marginTop: '8px' }}
            maxLength={500}
            showCount
          />
        </div>
      </Modal>
    </div>
  );
};

export default AgenticFlowList;
