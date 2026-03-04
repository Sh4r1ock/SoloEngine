"""
AgenticFlow 编译器
将画布 JSON 编译为可执行的多智能体系统
"""
import uuid
import logging
from typing import Dict, Any, List, Optional

from ..config import SoloAgentConfig
from ..agent import SoloAgent

logger = logging.getLogger(__name__)


class CompiledFlow:
    """编译后的 AgenticFlow"""
    
    def __init__(
        self,
        agents: Dict[str, SoloAgent],
        edges: Dict[str, List[str]],
        orchestrator_id: Optional[str] = None,
        flow_id: str = None,
        run_id: str = None,
    ):
        self.agents = agents
        self.edges = edges
        self.orchestrator_id = orchestrator_id
        self.flow_id = flow_id
        self.run_id = run_id
    
    def get_agent(self, agent_id: str) -> Optional[SoloAgent]:
        return self.agents.get(agent_id)
    
    def get_orchestrator(self) -> Optional[SoloAgent]:
        if self.orchestrator_id:
            return self.agents.get(self.orchestrator_id)
        return None
    
    def get_child_agents(self, agent_id: str) -> List[SoloAgent]:
        child_ids = self.edges.get(agent_id, [])
        return [self.agents[aid] for aid in child_ids if aid in self.agents]
    
    async def run(self, input_message: str) -> str:
        """运行 AgenticFlow"""
        orchestrator = self.get_orchestrator()
        if orchestrator is None:
            if len(self.agents) == 1:
                agent = list(self.agents.values())[0]
                return await agent.reply(input_message)
            raise ValueError("No orchestrator found and multiple agents exist")
        
        if not orchestrator._initialized:
            await orchestrator.initialize()
        
        return await orchestrator.reply(input_message)
    
    async def run_agent(self, agent_id: str, message: str) -> str:
        """运行指定的 Agent"""
        agent = self.get_agent(agent_id)
        if agent is None:
            raise ValueError(f"Agent '{agent_id}' not found")
        
        if not agent._initialized:
            await agent.initialize()
        
        return await agent.reply(message)


class AgenticFlowCompiler:
    """AgenticFlow 编译器
    
    将前端画布 JSON 数据编译为可执行的 Agent 实例树
    """
    
    def __init__(self, user_id: str = None):
        self.user_id = user_id
    
    def compile(
        self,
        flow_data: Dict[str, Any],
        user_id: str = None,
        flow_id: str = None,
    ) -> CompiledFlow:
        """编译 AgenticFlow JSON 为可执行结构
        
        Args:
            flow_data: AgenticFlow JSON 数据
            user_id: 用户 ID
            flow_id: AgenticFlow ID
            
        Returns:
            CompiledFlow: 编译后的可执行结构
        """
        user_id = user_id or self.user_id
        flow_id = flow_id or flow_data.get("flow_id", str(uuid.uuid4()))
        run_id = str(uuid.uuid4())
        
        canvas_data = flow_data.get("canvas_data", flow_data)
        nodes = canvas_data.get("nodes", [])
        edges = canvas_data.get("edges", [])
        
        agents: Dict[str, SoloAgent] = {}
        orchestrator_id: Optional[str] = None
        
        for node in nodes:
            agent = self._compile_node(
                node=node,
                user_id=user_id,
                flow_id=flow_id,
                run_id=run_id,
            )
            agents[agent.agent_id] = agent
            
            if node.get("data", {}).get("agentType") == "orchestrator":
                orchestrator_id = agent.agent_id
        
        edge_map = self._compile_edges(edges)
        
        for agent_id, child_ids in edge_map.items():
            if agent_id in agents:
                agents[agent_id].config.child_agents = child_ids
                child_agents = {cid: agents[cid] for cid in child_ids if cid in agents}
                agents[agent_id].set_child_agents(child_agents)
        
        logger.info(
            f"Compiled AgenticFlow with {len(agents)} agents, "
            f"orchestrator: {orchestrator_id}"
        )
        
        return CompiledFlow(
            agents=agents,
            edges=edge_map,
            orchestrator_id=orchestrator_id,
            flow_id=flow_id,
            run_id=run_id,
        )
    
    def _compile_node(
        self,
        node: Dict[str, Any],
        user_id: str,
        flow_id: str,
        run_id: str,
    ) -> SoloAgent:
        """编译单个节点为 Agent"""
        node_id = node.get("id")
        node_data = node.get("data", {})
        
        model_config = node_data.get("model_config", {})
        
        config = SoloAgentConfig(
            name=node_data.get("name", "Agent"),
            provider=model_config.get("provider", "openai"),
            model=model_config.get("model", "gpt-4"),
            system_prompt=node_data.get("system_prompt", ""),
            skills=node_data.get("skills", []),
            tools=node_data.get("tools", []),
            mcp_servers=node_data.get("mcp_servers", []),
            child_agents=[],
            memory=node_data.get("memory", False),
            user_id=user_id,
            agentic_flow_id=flow_id,
            agentic_flow_run_id=run_id,
            agent_id=node_id,
            max_iters=node_data.get("max_iters", 10),
            stream=node_data.get("stream", True),
            agent_type=node_data.get("agentType", "executor"),
        )
        
        return SoloAgent(config)
    
    def _compile_edges(self, edges: List[Dict[str, Any]]) -> Dict[str, List[str]]:
        """编译边关系
        
        Returns:
            Dict[str, List[str]]: 源节点 ID -> 目标节点 ID 列表的映射
        """
        edge_map: Dict[str, List[str]] = {}
        
        for edge in edges:
            source = edge.get("source")
            target = edge.get("target")
            
            if source and target:
                if source not in edge_map:
                    edge_map[source] = []
                edge_map[source].append(target)
        
        return edge_map
