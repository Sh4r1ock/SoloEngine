/**
 * @file AgentNode.tsx
 * @description 智能体节点组件 - 工作流智能体节点渲染组件
 * @author SoloEngine Team
 * @date 2026-02-19
 * 
 * 功能描述：
 * - 展示智能体节点的可视化表示
 * - 包含节点图标、名称、端口等元素
 * - 处理节点选中状态
 * - 显示连接端口
 * - 显示LLM配置信息
 * 
 * 使用场景：
 * - 在画布中渲染智能体节点
 * - 作为ReactFlow的自定义节点类型使用
 * 
 * 注意事项：
 * - 支持四种智能体类型：orchestrator、planner、executor、custom
 * - 不同类型使用不同颜色区分
 * - 显示用户配置的模型名称
 */
import React from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { Typography, Tooltip } from 'antd';
import { useCanvasStore } from '../../store/canvasStore';

const { Text } = Typography;

const AgentNode: React.FC<NodeProps> = ({ data, selected }) => {
  const configMap = useCanvasStore((s) => s.configMap);
  const llmInfo = data.model_config?.llm_config_id
    ? configMap.get(data.model_config.llm_config_id)
    : undefined;

  const renderModelInfo = () => {
    const displayName = llmInfo?.name;
    const modelName = llmInfo?.model_name;
    const provider = llmInfo?.provider;

    const tagStyle: React.CSSProperties = {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 5,
      marginTop: 4,
      padding: '2px 10px',
      borderRadius: 6,
      fontSize: 12,
      fontWeight: 500,
      lineHeight: '20px',
      whiteSpace: 'nowrap',
      maxWidth: 196,
      overflow: 'hidden',
      textOverflow: 'ellipsis',
    };

    if (displayName || modelName) {
      return (
        <Tooltip title={provider ? `${provider} - ${modelName}` : modelName}>
          <span
            style={{
              ...tagStyle,
              background: '#EFF6FF',
              color: '#1D4ED8',
            }}
          >
            ● {displayName || modelName}
          </span>
        </Tooltip>
      );
    }

    return (
      <span
        style={{
          ...tagStyle,
          background: '#FEF2F2',
          color: '#DC2626',
        }}
      >
        ● 未配置模型
      </span>
    );
  };

  return (
    <div
      style={{
        width: 220,
        backgroundColor: '#FFFFFF',
        borderRadius: 12,
        border: `1px solid ${selected ? '#3F51B5' : '#cccccc'}`,
        boxShadow: selected
          ? '0 0 0 5px rgba(63, 81, 181, 0.2), 0 6px 20px rgba(63, 81, 181, 0.15)'
          : '0 4px 12px rgba(0, 0, 0, 0.05)',
        transition: 'all 0.2s ease-in-out',
      }}
    >
      <Handle
        type="target"
        position={Position.Top}
        style={{
          width: 14,
          height: 14,
          background: '#10B981',
          border: '3px solid #ffffff',
        }}
      />
      
      <div style={{ padding: 12, minHeight: 100 }}>
        <div style={{ marginBottom: 8 }}>
          <Text strong style={{ fontSize: 16, color: '#333333', display: 'block' }}>
            {data.name || '未命名节点'}
          </Text>
        </div>
        
        <div style={{ marginBottom: 8 }}>
          {renderModelInfo()}
        </div>
        
        <div style={{
          marginTop: 8,
          paddingTop: 8,
          borderTop: '1px solid #f0f0f0',
          minHeight: 20,
        }}>
          <Text style={{
            fontSize: 12,
            color: '#9ca3af',
            display: 'block',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            maxWidth: '196px',
            minHeight: 20,
            lineHeight: '20px',
          }}>
            {data.desc ? data.desc : '未配置简介'}
          </Text>
        </div>
      </div>
      
      <Handle
        type="source"
        position={Position.Bottom}
        style={{
          width: 14,
          height: 14,
          background: '#3F51B5',
          border: '3px solid #ffffff',
        }}
      />
    </div>
  );
};

export default AgentNode;
