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
} from 'reactflow';
import 'reactflow/dist/style.css';
import { useCanvasStore } from '../../store/canvasStore';
import { NodeData, EdgeData } from '../../types/canvas';
import AgentNode from './AgentNode';
import Toolbar from '../Toolbar/Toolbar';
import ScalableBackground from './ScalableBackground';

const nodeTypes: NodeTypes = {
  agent: AgentNode,
};

const Canvas: React.FC = () => {
  const { nodes, edges, setNodes, setEdges, addEdge: storeAddEdge, saveCanvas, addNode } = useCanvasStore();
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const [reactFlowInstance, setReactFlowInstance] = useState<ReactFlowInstance | null>(null);

  const onNodesChange: OnNodesChange = useCallback(
    (changes) => {
      const updatedNodes = applyNodeChanges(changes, nodes as any);
      setNodes(updatedNodes.map(node => ({
        ...node,
        type: 'agent' as const,
        data: {
          ...node.data,
          agentType: node.data.agentType as "orchestrator" | "planner" | "executor"
        }
      })) as NodeData[]);
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
      saveCanvas();
    },
    [storeAddEdge, saveCanvas]
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
          onInit={setReactFlowInstance}
          nodeTypes={nodeTypes}
          fitView
        >
          <Controls />
          <MiniMap />
          <ScalableBackground baseGap={20} baseSize={1} color="var(--bg-300)" />
        </ReactFlow>
      </div>
      <Toolbar reactFlowInstance={reactFlowInstance} />
    </>
  );
};

export default Canvas;
