import { Node } from 'reactflow';
import { NodeData } from '../types/canvas';

export const generateOrchestratorPrompt = (orchestratorNode: Node, plannerNodes: Node[]): string => {
  const plannerInfo = plannerNodes
    .filter(node => node.data.agentType === 'planner')
    .map(node => `规划师${node.data.name}（简介：${node.data.desc || '无'}）可用于拆解复杂目标。`)
    .join('\n');
  
  return `你是总指挥，负责管理整个项目的执行流程。
  
可用助手：
${plannerInfo}

当需要拆解复杂目标时，请调用相应的规划师。
当需要执行具体任务时，请调用相应的执行者。`;
};

export const generatePlannerPrompt = (plannerNode: Node, executorNodes: Node[]): string => {
  const executorList = executorNodes
    .filter(node => node.data.agentType === 'executor')
    .map(node => ({
      id: node.id,
      name: node.data.name,
      desc: node.data.desc || '无'
    }));
  
  return `你是规划师${plannerNode.data.name}，负责将高层目标拆解为可执行的步骤。

可用执行者：
${JSON.stringify(executorList, null, 2)}

请根据任务需求，将目标拆解为具体的步骤，并分配给合适的执行者。`;
};

export const generateExecutorPrompt = (executorNode: Node): string => {
  return `你是执行者${executorNode.data.name}（简介：${executorNode.data.desc || '无'}），负责执行具体的任务。

请根据分配的任务，使用你绑定的技能完成工作。
完成后，请返回详细的执行结果。`;
};

export const updateNodePromptWithConnections = (
  node: NodeData,
  connectedNodes: NodeData[],
  connectionType: 'upstream' | 'downstream'
): string => {
  if (connectionType === 'upstream') {
    const upstreamInfo = connectedNodes
      .map(n => `${n.data.name}（简介：${n.data.desc || '无'}）`)
      .join('\n');
    
    return `${node.data.system_prompt}

上级节点：
${upstreamInfo}`;
  } else {
    const downstreamInfo = connectedNodes
      .map(n => `${n.data.name}（简介：${n.data.desc || '无'}）`)
      .join('\n');
    
    return `${node.data.system_prompt}

下级节点：
${downstreamInfo}`;
  }
};
