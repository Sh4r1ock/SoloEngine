"""
SoloAgent 配置模块
提供简洁的声明式配置接口
"""
from dataclasses import dataclass, field
from typing import Optional, List, Dict, Any


@dataclass
class SoloAgentConfig:
    """SoloAgent 配置 - 简洁的声明式配置
    
    只需指定名称，自动加载详细配置。
    配置细节在运行时按需从数据库/文件加载。
    """
    
    name: str
    provider: str
    model: str
    system_prompt: str = ""
    
    skills: List[Dict[str, Any]] = field(default_factory=list)
    tools: List[str] = field(default_factory=list)
    mcp_servers: List[Dict[str, Any]] = field(default_factory=list)
    
    child_agents: List[str] = field(default_factory=list)
    
    memory: bool = False
    user_id: Optional[str] = None
    agentic_flow_id: Optional[str] = None
    run_project_id: Optional[str] = None
    agent_id: Optional[str] = None
    session_id: Optional[str] = None
    max_memory_length: Optional[int] = None
    
    max_iters: int = 10
    stream: bool = True
    
    api_key: Optional[str] = None
    base_url: Optional[str] = None
    temperature: float = 0.7
    max_tokens: int = 4096
    
    agent_type: str = "executor"
    
    work_dir: Optional[str] = None
    
    extra: Dict[str, Any] = field(default_factory=dict)
    
    def __post_init__(self):
        if self.agent_id is None:
            self.agent_id = self.name
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "SoloAgentConfig":
        return cls(
            name=data.get("name", "Agent"),
            provider=data.get("provider", data.get("model_config", {}).get("provider", "openai")),
            model=data.get("model", data.get("model_config", {}).get("model", "gpt-4")),
            system_prompt=data.get("system_prompt", ""),
            skills=data.get("skills", []),
            tools=data.get("tools", []),
            mcp_servers=data.get("mcp_servers", []),
            child_agents=data.get("child_agents", []),
            memory=data.get("memory", False),
            user_id=data.get("user_id"),
            agentic_flow_id=data.get("agentic_flow_id"),
            run_project_id=data.get("run_project_id"),
            agent_id=data.get("agent_id"),
            session_id=data.get("session_id"),
            max_memory_length=data.get("max_memory_length"),
            max_iters=data.get("max_iters", 10),
            stream=data.get("stream", True),
            api_key=data.get("api_key"),
            base_url=data.get("base_url"),
            temperature=data.get("temperature", 0.7),
            max_tokens=data.get("max_tokens", 4096),
            agent_type=data.get("agentType", data.get("agent_type", "executor")),
            work_dir=data.get("work_dir"),
            extra=data.get("extra", {}),
        )
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "name": self.name,
            "provider": self.provider,
            "model": self.model,
            "system_prompt": self.system_prompt,
            "skills": self.skills,
            "tools": self.tools,
            "mcp_servers": self.mcp_servers,
            "child_agents": self.child_agents,
            "memory": self.memory,
            "user_id": self.user_id,
            "agentic_flow_id": self.agentic_flow_id,
            "run_project_id": self.run_project_id,
            "agent_id": self.agent_id,
            "session_id": self.session_id,
            "max_memory_length": self.max_memory_length,
            "max_iters": self.max_iters,
            "stream": self.stream,
            "api_key": self.api_key,
            "base_url": self.base_url,
            "temperature": self.temperature,
            "max_tokens": self.max_tokens,
            "agent_type": self.agent_type,
            "work_dir": self.work_dir,
            "extra": self.extra,
        }
