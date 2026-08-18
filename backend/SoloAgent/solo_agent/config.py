"""
SoloAgent机制-config.py: SoloAgent配置模块，提供简洁的声明式配置接口

@file config.py
@description 定义SoloAgent的配置数据类，支持声明式配置
@author Sh4rlock
@date 2026-04-09

功能描述：
本模块定义SoloAgent机制的配置数据类，提供以下功能：
- SoloAgentConfig: 主配置数据类，包含所有Agent配置项
- SubAgentInfo: 子Agent信息数据类
- 支持声明式配置：只需指定名称即可自动加载详细配置
- 配置细节在运行时按需从数据库/文件加载
- 支持完整的LLM参数配置（temperature, max_tokens等）

依赖:
- uuid: 用于生成唯一标识符
- dataclasses: 用于定义数据类
- typing: 类型提示支持

使用示例:
- config = SoloAgentConfig(name="my_agent", provider="openai", model="gpt-4")
- config = SoloAgentConfig(name="my_agent", system_prompt="你是助手")
"""
import uuid
from dataclasses import dataclass, field
from typing import Optional, List, Dict, Any


@dataclass
class SubAgentInfo:
    """
    子Agent信息数据类
    
    职责:
    - 存储子Agent的元信息
    - 区分显示给模型的字段和后端使用的字段
    
    属性:
        subagent_name (str): 子Agent名称，显示给模型
        description (str): 子Agent描述，显示给模型
        subagent_id (str): 子Agent唯一标识，后端使用
    """
    subagent_name: str
    description: str
    subagent_id: str


@dataclass
class SoloAgentConfig:
    """
    SoloAgent配置数据类
    
    职责:
    - 提供简洁的声明式配置接口
    - 支持运行时按需加载详细配置
    - 包含完整的Agent运行参数
    
    属性:
        name (str): Agent名称
        provider (str): LLM提供商
        model (str): 模型名称
        system_prompt (str): 系统提示词
        desc (str): Agent描述
        skills (List[Dict]): Skill列表
        tools (List[str]): 工具列表
        mcp_servers (Any): MCP服务器配置
        subagents (List[Dict]): 子Agent配置
        max_iters (int): 最大迭代次数
        stream (bool): 是否流式输出
        temperature (float): 温度参数
        max_tokens (int): 最大token数
    """
    
    name: str
    provider: str
    model: str
    system_prompt: str = ""
    desc: str = ""
    
    skills: List[Dict[str, Any]] = field(default_factory=list)
    tools: List[str] = field(default_factory=list)
    mcp_servers: Any = field(default_factory=dict)
    
    subagents: List[Dict[str, Any]] = field(default_factory=list)

    user_id: Optional[str] = None
    agentic_flow_id: Optional[str] = None
    run_project_id: Optional[str] = None
    agent_id: Optional[str] = None
    session_id: Optional[str] = None
    max_memory_length: Optional[int] = None
    
    max_iters: int = 10
    # 工具调用轮次：一次 react_core 循环中 agent 允许调用 LLM API 的次数上限。
    # 必须从画布节点 model_config 获取（默认值来自 llm_config 并写入 canvas），禁止降级到默认值。
    max_tool_calls: Optional[int] = None
    stream: bool = True
    
    api_key: Optional[str] = None
    base_url: Optional[str] = None
    # 完整 URL 开关：True 表示 base_url 为完整请求地址（含 /chat/completions）
    is_full_url: bool = False
    temperature: float = 0.7
    max_tokens: Optional[int] = None
    max_input_tokens: Optional[int] = None  # 新增：最大输入 token 数，必须从 canvas_data 传入
    max_output_tokens: Optional[int] = None  # 新增：最大输出 token 数，必须从 canvas_data 传入
    top_p: float = 1.0
    frequency_penalty: float = 0.0
    presence_penalty: float = 0.0
    timeout: int = 60
    
    agent_type: str = "custom"
    
    work_dir: Optional[str] = None
    
    extra: Dict[str, Any] = field(default_factory=dict)
    
    _llm_config_id: Optional[str] = field(default=None, repr=False)
    _llm_config_version: Optional[int] = field(default=None, repr=False)
    
    def __post_init__(self):
        if self.agent_id is None:
            self.agent_id = str(uuid.uuid4())
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "SoloAgentConfig":
        return cls(
            name=data.get("name", "Agent"),
            provider=data.get("provider", data.get("model_config", {}).get("provider", "openai")),
            model=data.get("model", data.get("model_config", {}).get("model", "gpt-4")),
            system_prompt=data.get("system_prompt", ""),
            desc=data.get("desc", ""),
            skills=data.get("skills", []),
            tools=data.get("tools", []),
            mcp_servers=data.get("mcp_servers", []),
            subagents=data.get("subagents", data.get("child_agents", [])),
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
            is_full_url=data.get("is_full_url", False),
            temperature=data.get("temperature", 0.7),
            max_tokens=data.get("max_tokens"),
            max_input_tokens=data.get("max_input_tokens"),  # 新增
            max_output_tokens=data.get("max_output_tokens"),  # 新增
            top_p=data.get("top_p", 1.0),
            frequency_penalty=data.get("frequency_penalty", 0.0),
            presence_penalty=data.get("presence_penalty", 0.0),
            timeout=data.get("timeout", 60),
            agent_type=data.get("agentType", data.get("agent_type", "custom")),
            work_dir=data.get("work_dir"),
            extra=data.get("extra", {}),
        )
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "name": self.name,
            "provider": self.provider,
            "model": self.model,
            "system_prompt": self.system_prompt,
            "desc": self.desc,
            "skills": self.skills,
            "tools": self.tools,
            "mcp_servers": self.mcp_servers,
            "subagents": self.subagents,
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
            "is_full_url": self.is_full_url,
            "temperature": self.temperature,
            "max_tokens": self.max_tokens,
            "max_input_tokens": self.max_input_tokens,  # 新增
            "max_output_tokens": self.max_output_tokens,  # 新增
            "top_p": self.top_p,
            "frequency_penalty": self.frequency_penalty,
            "presence_penalty": self.presence_penalty,
            "timeout": self.timeout,
            "agent_type": self.agent_type,
            "work_dir": self.work_dir,
            "extra": self.extra,
        }
