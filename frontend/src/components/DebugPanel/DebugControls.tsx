import React, { useState, useMemo } from 'react';
import { Card, Typography, Space, Tag, Button, Row, Col, Empty, Switch, Select, Modal, message } from 'antd';
import {
  RobotOutlined,
  ThunderboltOutlined,
  ExperimentOutlined,
  PlusOutlined,
  DeleteOutlined,
} from '@ant-design/icons';
import { useDebugStore } from '../../store/debugStore';
import { useCanvasStore } from '../../store/canvasStore';

const { Title, Text, Paragraph } = Typography;

const DebugControls: React.FC = () => {
  const {
    currentAgentId,
    currentAgentName,
    currentThought,
    currentAction,
    breakpoints,
    addBreakpoint,
    removeBreakpoint,
    toggleBreakpoint,
  } = useDebugStore();
  
  const { nodes } = useCanvasStore();
  
  const [addBreakpointModalVisible, setAddBreakpointModalVisible] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedStepType, setSelectedStepType] = useState<string>('before_thought');

  const agentNodes = useMemo(() => {
    return nodes.filter(node => node.type === 'agent');
  }, [nodes]);

  const handleAddBreakpoint = () => {
    if (agentNodes.length === 0) {
      message.warning('没有可用的Agent节点，请先在画布上添加节点');
      return;
    }
    setAddBreakpointModalVisible(true);
  };

  const handleConfirmAddBreakpoint = () => {
    if (!selectedNodeId) {
      message.warning('请选择一个节点');
      return;
    }
    addBreakpoint({
      nodeId: selectedNodeId,
      stepType: selectedStepType,
      enabled: true,
    });
    setAddBreakpointModalVisible(false);
    setSelectedNodeId(null);
    setSelectedStepType('before_thought');
    message.success('断点添加成功');
  };

  return (
    <div style={{ padding: '16px', background: '#fafafa', borderBottom: '1px solid #f0f0f0' }}>
      <Row gutter={16}>
        {/* 当前智能体 */}
        <Col span={12}>
          <Card
            size="small"
            title={
              <Space size={4}>
                <RobotOutlined style={{ color: 'var(--primary-100)' }} />
                <Text strong>当前智能体</Text>
              </Space>
            }
            style={{ height: '100%' }}
          >
            {!currentAgentId ? (
              <Empty
                description="暂无运行的智能体"
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                style={{ padding: '8px 0' }}
              />
            ) : (
              <Space direction="vertical" size={8} style={{ width: '100%' }}>
                <div>
                  <Text type="secondary" style={{ fontSize: 12 }}>ID：</Text>
                  <Tag style={{ marginLeft: 4 }}>{currentAgentId}</Tag>
                </div>
                <div>
                  <Text type="secondary" style={{ fontSize: 12 }}>名称：</Text>
                  <Text strong>{currentAgentName}</Text>
                </div>
              </Space>
            )}
          </Card>
        </Col>

        {/* 当前思考 */}
        <Col span={12}>
          <Card
            size="small"
            title={
              <Space size={4}>
                <ThunderboltOutlined style={{ color: '#fa8c16' }} />
                <Text strong>当前思考</Text>
              </Space>
            }
            style={{ height: '100%' }}
          >
            {!currentThought ? (
              <Empty
                description="等待思考输出..."
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                style={{ padding: '8px 0' }}
              />
            ) : (
              <Paragraph
                ellipsis={{ rows: 3, tooltip: currentThought }}
                style={{ margin: 0, fontSize: 13 }}
              >
                {currentThought}
              </Paragraph>
            )}
          </Card>
        </Col>

        {/* 当前行动 */}
        <Col span={12}>
          <Card
            size="small"
            title={
              <Space size={4}>
                <ExperimentOutlined style={{ color: 'var(--success)' }} />
                <Text strong>当前行动</Text>
              </Space>
            }
            style={{ height: '100%', marginTop: 16 }}
          >
            {!currentAction ? (
              <Empty
                description="等待行动决策..."
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                style={{ padding: '8px 0' }}
              />
            ) : (
              <Paragraph
                ellipsis={{ rows: 3, tooltip: currentAction }}
                style={{ margin: 0, fontSize: 13 }}
              >
                {currentAction}
              </Paragraph>
            )}
          </Card>
        </Col>

        {/* 断点管理 */}
        <Col span={12}>
          <Card
            size="small"
            title={
              <Space>
                <Text strong>断点</Text>
                <Tag>{breakpoints.length}</Tag>
                <Button
                  size="small"
                  type="primary"
                  icon={<PlusOutlined />}
                  onClick={handleAddBreakpoint}
                >
                  添加断点
                </Button>
              </Space>
            }
            style={{ height: '100%', marginTop: 16 }}
          >
            {breakpoints.length === 0 ? (
              <Empty
                description="暂无断点"
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                style={{ padding: '8px 0' }}
              />
            ) : (
              <Space direction="vertical" size={4} style={{ width: '100%' }}>
                {breakpoints.map(bp => (
                  <div
                    key={bp.id}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '4px 8px',
                      background: '#f5f5f5',
                      borderRadius: 4,
                    }}
                  >
                    <Space size={8}>
                      <Switch
                        size="small"
                        checked={bp.enabled}
                        onChange={() => toggleBreakpoint(bp.id)}
                      />
                      <Text style={{ fontSize: 12 }}>
                        {bp.node_id}
                      </Text>
                      <Tag style={{ margin: 0, fontSize: 10 }}>
                        {bp.step_type === 'before_thought' ? '思考前' :
                         bp.step_type === 'before_action' ? '行动前' : '行动后'}
                      </Tag>
                    </Space>
                    <Button
                      type="text"
                      size="small"
                      danger
                      icon={<DeleteOutlined />}
                      onClick={() => removeBreakpoint(bp.id)}
                    />
                  </div>
                ))}
              </Space>
            )}
          </Card>
        </Col>
      </Row>

      <Modal
        title="添加断点"
        open={addBreakpointModalVisible}
        onOk={handleConfirmAddBreakpoint}
        onCancel={() => {
          setAddBreakpointModalVisible(false);
          setSelectedNodeId(null);
          setSelectedStepType('before_thought');
        }}
        okText="添加"
        cancelText="取消"
      >
        <Space direction="vertical" style={{ width: '100%' }} size={16}>
          <div>
            <Text strong style={{ display: 'block', marginBottom: 8 }}>选择节点</Text>
            <Select
              style={{ width: '100%' }}
              placeholder="选择要设置断点的节点"
              value={selectedNodeId}
              onChange={setSelectedNodeId}
              options={agentNodes.map(node => ({
                value: node.id,
                label: `${node.data?.name || node.id} (${node.data?.agentType || 'agent'})`,
              }))}
            />
          </div>
          <div>
            <Text strong style={{ display: 'block', marginBottom: 8 }}>断点类型</Text>
            <Select
              style={{ width: '100%' }}
              value={selectedStepType}
              onChange={setSelectedStepType}
              options={[
                { value: 'before_thought', label: '思考前 (before_thought)' },
                { value: 'before_action', label: '行动前 (before_action)' },
                { value: 'after_action', label: '行动后 (after_action)' },
              ]}
            />
          </div>
        </Space>
      </Modal>
    </div>
  );
};

export default DebugControls;
