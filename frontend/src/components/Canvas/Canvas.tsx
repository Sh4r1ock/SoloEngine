/**
 * SoloEngine : 画布主组件
 *
 * @file Canvas.tsx
 * @description 画布主组件 - 工作流画布核心组件
 * @author Sh4rlock
 * @date 2026-04-09
 *
 * 功能描述：
 * 本组件提供以下核心功能：
 *     - 基于ReactFlow实现工作流画布
 *     - 提供节点拖拽、连线、缩放、平移等画布操作
 *     - 渲染工作流节点和处理节点连线
 *     - 支持画布交互和网格对齐
 *     - 支持右键菜单添加节点
 *     - 支持节点多选
 *     - 支持画布注释
 *     - 支持复制粘贴节点
 *     - 支持删除节点
 *
 * 依赖:
 *     - react: React核心库
 *     - reactflow: 流程图库
 *     - antd: Ant Design组件
 *     - @ant-design/icons: Ant Design图标
 *     - ../../store/canvasStore: 画布状态管理
 *     - ../../types/canvas: 画布类型定义
 *
 * 使用示例:
 *     - <Canvas />
 *
 * 使用场景：
 *     - 在编辑器页面中作为核心画布组件使用
 *     - 工作流可视化编辑的主要交互区域
 */
import React, { useCallback, useRef, useState, useEffect } from 'react';
import ReactFlow, {
  Node,
  Connection,
  Controls,
  MiniMap,
  NodeTypes,
  ReactFlowInstance,
  OnNodesChange,
  OnEdgesChange,
  applyNodeChanges,
  applyEdgeChanges,
  NodeDragHandler,
  SelectionMode,
  Panel,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { Dropdown, Menu, Button, Input, Modal, App, Tooltip } from 'antd';
import { 
  PlusOutlined, 
  UserOutlined, 
  TeamOutlined, 
  ToolOutlined,
  CommentOutlined,
  DeleteOutlined,
  CopyOutlined,
  SelectOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import { useCanvasStore } from '../../store/canvasStore';
import { NodeData, EdgeData } from '../../types/canvas';
import AgentNode from './AgentNode';
import Toolbar from '../Toolbar/Toolbar';
import ScalableBackground from './ScalableBackground';
import SmartGridLines from './SmartGridLines';
import { toolsApi, AgentPreset } from '../../services/toolsApi';
import { getPresets } from '../../stores/presetsStore';

interface ContextMenuPosition {
  x: number;
  y: number;
  canvasX: number;
  canvasY: number;
}

interface Annotation {
  id: string;
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
}

interface AnnotationNodeData {
  text: string;
  color: string;
  editable?: boolean;
}

const getPresetIcon = (iconName: string) => {
  const iconMap: Record<string, React.ReactNode> = {
    'TeamOutlined': <TeamOutlined />,
    'UserOutlined': <UserOutlined />,
    'ToolOutlined': <ToolOutlined />,
    'SettingOutlined': <SettingOutlined />,
  };
  return iconMap[iconName] || <SettingOutlined />;
};

const AnnotationNode: React.FC<{ data: AnnotationNodeData; id: string }> = ({ data, id }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [text, setText] = useState(data.text);
  const { updateNode } = useCanvasStore();

  const handleDoubleClick = () => {
    setIsEditing(true);
  };

  const handleBlur = () => {
    setIsEditing(false);
    updateNode(id, { text, color: data.color });
  };

  return (
    <div
      style={{
        padding: '12px 16px',
        background: data.color || '#fff3cd',
        border: '1px solid #ffc107',
        borderRadius: 8,
        minWidth: 150,
        maxWidth: 300,
        boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
        cursor: 'move',
      }}
      onDoubleClick={handleDoubleClick}
    >
      {isEditing ? (
        <Input.TextArea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={handleBlur}
          autoFocus
          rows={3}
          style={{ border: 'none', background: 'transparent' }}
        />
      ) : (
        <div style={{ whiteSpace: 'pre-wrap', fontSize: 13, color: '#333' }}>
          {data.text || '双击编辑注释'}
        </div>
      )}
    </div>
  );
};

const nodeTypes: NodeTypes = {
  agent: AgentNode,
  annotation: AnnotationNode,
};

const Canvas: React.FC = () => {
  const { message } = App.useApp();
  const { 
    nodes, 
    edges, 
    setNodes, 
    setEdges, 
    addEdge: storeAddEdge, 
    addNode,
    addNodeWithDefaultConfig,
    snapToGrid, 
    setIsDragging, 
    pushHistory,
    selectedNode,
    setSelectedNode,
  } = useCanvasStore();
  
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const [reactFlowInstance, setReactFlowInstance] = useState<ReactFlowInstance | null>(null);
  const [draggingNodeInfo, setDraggingNodeInfo] = useState<{ id: string; position: { x: number; y: number } } | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuPosition | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [annotationModalVisible, setAnnotationModalVisible] = useState(false);
  const [annotationText, setAnnotationText] = useState('');
  const [annotationColor, setAnnotationColor] = useState('#fff3cd');

  const annotationColors = [
    { name: '黄色', color: '#fff3cd', border: '#ffc107' },
    { name: '蓝色', color: '#cce5ff', border: '#007bff' },
    { name: '绿色', color: '#d4edda', border: '#28a745' },
    { name: '红色', color: '#f8d7da', border: '#dc3545' },
    { name: '紫色', color: '#e2d5f1', border: '#6f42c1' },
  ];

  const onNodesChange: OnNodesChange = useCallback(
    (changes) => {
      const updatedNodes = applyNodeChanges(changes, nodes as any);
      const isDragging = changes.some(change => change.type === 'position' && change.dragging);
      
      const selectionChanges = changes.filter(c => c.type === 'select');
      if (selectionChanges.length > 0) {
        const newSelectedIds = selectionChanges
          .filter(c => c.selected)
          .map(c => c.id);
        setSelectedNodeIds(newSelectedIds);
      }
      
      setNodes(updatedNodes as NodeData[], isDragging);
    },
    [nodes, setNodes]
  );

  const onEdgesChange: OnEdgesChange = useCallback(
    (changes) => {
      const updatedEdges = applyEdgeChanges(changes, edges as any);
      setEdges(updatedEdges.map(edge => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        label: typeof edge.label === 'string' ? edge.label : undefined
      })) as EdgeData[]);
    },
    [edges, setEdges]
  );

  const onConnect = useCallback(
    (params: Connection) => {
      const newEdge = {
        id: `e_${params.source}_${params.target}`,
        source: params.source!,
        target: params.target!,
        label: '调用',
      };
      
      storeAddEdge(newEdge);
    },
    [storeAddEdge]
  );

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    useCanvasStore.getState().setSelectedNode(node as any);
    useCanvasStore.getState().setPropertyPanelOpen(true);
  }, []);

  const onSelectionChange = useCallback(({ nodes: selectedNodes }: { nodes: Node[] }) => {
    if (selectedNodes.length > 0) {
      setSelectedNodeIds(selectedNodes.map(n => n.id));
      if (selectedNodes.length === 1) {
        useCanvasStore.getState().setSelectedNode(selectedNodes[0] as any);
      }
    } else {
      setSelectedNodeIds([]);
    }
  }, []);

  const onPaneClick = useCallback(() => {
    useCanvasStore.getState().setSelectedNode(null);
    setContextMenu(null);
    setSelectedNodeIds([]);
  }, []);

  const onContextMenu = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    
    const reactFlowBounds = reactFlowWrapper.current?.getBoundingClientRect();
    if (!reactFlowBounds || !reactFlowInstance) return;

    const position = reactFlowInstance.project({
      x: event.clientX - reactFlowBounds.left,
      y: event.clientY - reactFlowBounds.top,
    });

    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      canvasX: position.x,
      canvasY: position.y,
    });
  }, [reactFlowInstance]);

  const addNodeByType = useCallback(async (presetId: string) => {
    if (!contextMenu) return;

    const preset = getPresets().find(p => p.id === presetId);
    const presetName = preset?.name || '节点';

    const newNode = {
      id: `node_${Date.now()}`,
      type: 'agent' as const,
      position: { x: contextMenu.canvasX, y: contextMenu.canvasY },
      data: {
        name: `新${presetName}`,
        desc: '',
        agentType: presetId,
        color: preset?.color || '#3F51B5',
        system_prompt: preset?.system_prompt || '',
        assistant_prompt: '',
        skills: preset?.skills || [],
        tools: preset?.tools || [],
        mcp_tools: preset?.mcp_tools || [],
      },
    };

    await addNodeWithDefaultConfig(newNode as any);
    setContextMenu(null);
  }, [contextMenu, addNodeWithDefaultConfig]);

  const addAnnotation = useCallback(() => {
    if (!contextMenu) return;

    const newNode = {
      id: `annotation_${Date.now()}`,
      type: 'annotation' as const,
      position: { x: contextMenu.canvasX, y: contextMenu.canvasY },
      data: {
        text: annotationText || '新注释',
        color: annotationColor,
      },
    };

    addNode(newNode as any);
    setContextMenu(null);
    setAnnotationText('');
    setAnnotationModalVisible(false);
  }, [contextMenu, addNode, annotationText, annotationColor]);

  const handleDeleteSelected = useCallback(() => {
    const { nodes, edges, setNodes, setEdges } = useCanvasStore.getState();
    
    const newNodes = nodes.filter(node => !selectedNodeIds.includes(node.id));
    const newEdges = edges.filter(
      edge => !selectedNodeIds.includes(edge.source) && !selectedNodeIds.includes(edge.target)
    );
    
    setNodes(newNodes);
    setEdges(newEdges);
    setSelectedNodeIds([]);
    pushHistory();
    message.success(`已删除 ${selectedNodeIds.length} 个节点`);
  }, [selectedNodeIds, pushHistory]);

  const handleDuplicateSelected = useCallback(() => {
    const { nodes, addNode } = useCanvasStore.getState();
    
    const nodesToDuplicate = nodes.filter(node => selectedNodeIds.includes(node.id));
    
    nodesToDuplicate.forEach(node => {
      const newNode = {
        ...node,
        id: `${node.id}_copy_${Date.now()}`,
        position: {
          x: node.position.x + 50,
          y: node.position.y + 50,
        },
        data: {
          ...node.data,
          name: `${node.data.name} (副本)`,
        },
      };
      addNode(newNode as any);
    });
    
    message.success(`已复制 ${nodesToDuplicate.length} 个节点`);
  }, [selectedNodeIds]);

  const contextMenuContent = (
    <Menu
      items={[
        {
          key: 'header',
          label: <span style={{ fontWeight: 600, color: 'var(--text-100)' }}>添加节点</span>,
          disabled: true,
        },
        { type: 'divider' },
        ...getPresets().map(preset => ({
          key: preset.id,
          icon: getPresetIcon(preset.icon),
          label: <span style={{ color: preset.color || '#3F51B5', fontWeight: 500 }}>{preset.name}</span>,
          onClick: () => addNodeByType(preset.id),
        })),
        { type: 'divider' as const },
        {
          key: 'annotation',
          icon: <CommentOutlined style={{ color: '#ffc107' }} />,
          label: <span style={{ fontWeight: 500 }}>添加注释</span>,
          onClick: () => setAnnotationModalVisible(true),
        },
        ...(selectedNodeIds.length > 0 ? [
          { type: 'divider' as const },
          {
            key: 'delete-selected',
            icon: <DeleteOutlined style={{ color: '#ff4d4f' }} />,
            label: <span style={{ color: '#ff4d4f' }}>删除选中 ({selectedNodeIds.length})</span>,
            onClick: handleDeleteSelected,
          },
          {
            key: 'duplicate-selected',
            icon: <CopyOutlined />,
            label: <span>复制选中 ({selectedNodeIds.length})</span>,
            onClick: handleDuplicateSelected,
          },
        ] : []),
      ]}
    />
  );

  const onDrop = useCallback(
    async (event: React.DragEvent) => {
      event.preventDefault();

      const typeData = event.dataTransfer.getData('application/reactflow');
      if (!typeData) return;

      const presetId = JSON.parse(typeData);
      const preset = getPresets().find(p => p.id === presetId);
      const reactFlowBounds = reactFlowWrapper.current?.getBoundingClientRect();
      if (!reactFlowBounds) return;

      const position = reactFlowInstance?.project({
        x: event.clientX - reactFlowBounds.left,
        y: event.clientY - reactFlowBounds.top,
      });

      if (!position) return;

      const newNode = {
        id: `node_${Date.now()}`,
        type: 'agent' as const,
        position,
        data: {
          name: `新${preset?.name || '节点'}`,
          desc: '',
          agentType: presetId,
          color: preset?.color || '#3F51B5',
          system_prompt: preset?.system_prompt || '',
          assistant_prompt: '',
          skills: preset?.skills || [],
          tools: preset?.tools || [],
          mcp_tools: preset?.mcp_tools || [],
        },
      };

      await addNodeWithDefaultConfig(newNode as any);
    },
    [reactFlowInstance, addNodeWithDefaultConfig]
  );

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onNodeDragStart: NodeDragHandler = useCallback((_, node) => {
    setIsDragging(true);
    if (snapToGrid) {
      setDraggingNodeInfo({ id: node.id, position: node.position });
    }
  }, [snapToGrid, setIsDragging]);

  const onNodeDrag: NodeDragHandler = useCallback((_, node) => {
    if (snapToGrid) {
      setDraggingNodeInfo({ id: node.id, position: node.position });
    }
  }, [snapToGrid]);

  const onNodeDragStop: NodeDragHandler = useCallback(() => {
    setIsDragging(false);
    setDraggingNodeInfo(null);
    pushHistory();
    // 拖拽结束后触发自动保存
    setTimeout(() => {
      useCanvasStore.getState().autoSave();
    }, 0);
  }, [setIsDragging, pushHistory]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // 如果在输入框中，不处理快捷键
      const activeElement = document.activeElement;
      if (activeElement?.tagName === 'INPUT' || activeElement?.tagName === 'TEXTAREA') {
        return;
      }
      
      if (event.key === 'Delete' || event.key === 'Backspace') {
        if (selectedNodeIds.length > 0) {
          event.preventDefault();
          handleDeleteSelected();
        }
      }
      
      if (event.ctrlKey || event.metaKey) {
        if (event.key === 'a' || event.key === 'A') {
          event.preventDefault();
          setSelectedNodeIds(nodes.map(n => n.id));
        }
        if (event.key === 'd' || event.key === 'D') {
          if (selectedNodeIds.length > 0) {
            event.preventDefault();
            handleDuplicateSelected();
          }
        }
        // Ctrl+Z 撤销
        if (event.key === 'z' || event.key === 'Z') {
          event.preventDefault();
          useCanvasStore.getState().undo();
        }
        // Ctrl+Y 重做
        if (event.key === 'y' || event.key === 'Y') {
          event.preventDefault();
          useCanvasStore.getState().redo();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedNodeIds, nodes, handleDeleteSelected, handleDuplicateSelected]);

  return (
    <>
      <div ref={reactFlowWrapper} style={{ width: '100%', height: '100%' }}>
        <Dropdown
          overlay={contextMenuContent}
          visible={!!contextMenu}
          onVisibleChange={(visible) => !visible && setContextMenu(null)}
          trigger={['contextMenu']}
          overlayStyle={{ 
            position: 'fixed', 
            left: contextMenu?.x || 0, 
            top: contextMenu?.y || 0,
            zIndex: 1000,
          }}
        >
          <div style={{ width: '100%', height: '100%' }}>
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onNodeClick={onNodeClick}
              onPaneClick={onPaneClick}
              onContextMenu={onContextMenu}
              onDrop={onDrop}
              onDragOver={onDragOver}
              onNodeDragStart={onNodeDragStart}
              onNodeDrag={onNodeDrag}
              onNodeDragStop={onNodeDragStop}
              onInit={setReactFlowInstance}
              onSelectionChange={onSelectionChange}
              nodeTypes={nodeTypes}
              snapToGrid={snapToGrid}
              snapGrid={[20, 20]}
              fitView
              selectionMode={SelectionMode.Partial}
              selectionOnDrag={false}
              panOnDrag={true}
              selectNodesOnDrag={false}
              multiSelectionKeyCode="Shift"
              panOnScroll
              panOnScrollMode={1 as any}
            >
              <Controls />
              <MiniMap />
              <ScalableBackground 
                baseGap={20} 
                baseSize={1} 
                color="var(--bg-300)" 
                showBackground={!snapToGrid}
              />
              <SmartGridLines
                draggingNodeInfo={draggingNodeInfo}
                nodes={nodes}
                visible={snapToGrid}
              />
              <Panel position="top-left">
                {selectedNodeIds.length > 0 && (
                  <div style={{
                    background: 'var(--bg-100)',
                    padding: '8px 12px',
                    borderRadius: 'var(--radius-base)',
                    boxShadow: 'var(--shadow-base)',
                    display: 'flex',
                    gap: 8,
                    alignItems: 'center',
                  }}>
                    <span style={{ fontSize: 12, color: 'var(--text-200)' }}>
                      已选择 {selectedNodeIds.length} 个节点
                    </span>
                    <Tooltip title="复制">
                      <Button size="small" icon={<CopyOutlined />} onClick={handleDuplicateSelected} />
                    </Tooltip>
                    <Tooltip title="删除">
                      <Button size="small" danger icon={<DeleteOutlined />} onClick={handleDeleteSelected} />
                    </Tooltip>
                  </div>
                )}
              </Panel>
            </ReactFlow>
          </div>
        </Dropdown>
      </div>
      <Toolbar reactFlowInstance={reactFlowInstance} />

      <Modal
        title="添加注释"
        open={annotationModalVisible}
        onOk={addAnnotation}
        onCancel={() => {
          setAnnotationModalVisible(false);
          setContextMenu(null);
        }}
        okText="添加"
        cancelText="取消"
      >
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', marginBottom: 8 }}>注释内容:</label>
          <Input.TextArea
            value={annotationText}
            onChange={(e) => setAnnotationText(e.target.value)}
            placeholder="请输入注释内容..."
            rows={4}
          />
        </div>
        <div>
          <label style={{ display: 'block', marginBottom: 8 }}>背景颜色:</label>
          <div style={{ display: 'flex', gap: 8 }}>
            {annotationColors.map((c) => (
              <div
                key={c.color}
                onClick={() => setAnnotationColor(c.color)}
                style={{
                  width: 32,
                  height: 32,
                  background: c.color,
                  border: annotationColor === c.color ? `2px solid ${c.border}` : '1px solid #ddd',
                  borderRadius: 4,
                  cursor: 'pointer',
                }}
                title={c.name}
              />
            ))}
          </div>
        </div>
      </Modal>
    </>
  );
};

export default Canvas;
