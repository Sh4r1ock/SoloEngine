import React, { useCallback, useRef, useState } from 'react';
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
} from 'reactflow';
import 'reactflow/dist/style.css';
import { useCanvasStore } from '../../store/canvasStore';
import { NodeData, EdgeData } from '../../types/canvas';
import AgentNode from './AgentNode';
import Toolbar from '../Toolbar/Toolbar';
import ScalableBackground from './ScalableBackground';
import SmartGridLines from './SmartGridLines';

const nodeTypes: NodeTypes = {
  agent: AgentNode,
};

const Canvas: React.FC = () => {
  const { nodes, edges, setNodes, setEdges, addEdge: storeAddEdge, addNode, snapToGrid, setIsDragging, pushHistory } = useCanvasStore();
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const [reactFlowInstance, setReactFlowInstance] = useState<ReactFlowInstance | null>(null);
  const [draggingNodeInfo, setDraggingNodeInfo] = useState<{ id: string; position: { x: number; y: number } } | null>(null);

  const onNodesChange: OnNodesChange = useCallback(
    (changes) => {
      const updatedNodes = applyNodeChanges(changes, nodes as any);
      const isDragging = changes.some(change => change.type === 'position' && change.dragging);
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

  const onPaneClick = useCallback(() => {
    useCanvasStore.getState().setSelectedNode(null);
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();

      const typeData = event.dataTransfer.getData('application/reactflow');
      if (!typeData) return;

      const agentType = JSON.parse(typeData);
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
          name: '新节点',
          desc: '',
          agentType: agentType as "orchestrator" | "planner" | "executor",
          system_prompt: '',
          user_prompt: '',
          assistant_prompt: '',
          model_config: {
            provider: 'openai',
            model: 'gpt-4',
          },
          skills: [],
        },
      };

      addNode(newNode as any);
    },
    [reactFlowInstance, addNode]
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
  }, [setIsDragging, pushHistory]);

  return (
    <>
      <div ref={reactFlowWrapper} style={{ width: '100%', height: '100%' }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeClick={onNodeClick}
          onPaneClick={onPaneClick}
          onDrop={onDrop}
          onDragOver={onDragOver}
          onNodeDragStart={onNodeDragStart}
          onNodeDrag={onNodeDrag}
          onNodeDragStop={onNodeDragStop}
          onInit={setReactFlowInstance}
          nodeTypes={nodeTypes}
          snapToGrid={snapToGrid}
          snapGrid={[20, 20]}
          fitView
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
        </ReactFlow>
      </div>
      <Toolbar reactFlowInstance={reactFlowInstance} />
    </>
  );
};

export default Canvas;
