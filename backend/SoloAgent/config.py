# -*- coding: utf-8 -*-
"""
SoloAgent 核心层独立配置模块

@file config.py
@description 核心层（core/model/message/utils/tracing/embedding）与
SoloAgent 框架内部各层（solo_agent/compiler、plugins）禁止反向依赖 app 层
（架构文档：核心层禁 import app 层）。本模块直接从环境变量读取框架所需的
运行时配置，默认值与 app.core.config 保持一致（.env 由应用入口统一加载，
此处仅读取已加载的环境变量，不重复加载）。

字段（均为 SoloAgent 层实际使用，与 app.core.config 同名同默认值）：
- DEFAULT_TIMEZONE: 所有时间戳生成的时区
- DEFAULT_MAX_ITERS: ReAct 最大迭代轮数
- STREAM_STALL_TIMEOUT: LLM 流式响应 stall 超时（秒）
- OLLAMA_REQUEST_TIMEOUT: Ollama 请求超时（秒）
- COMPILED_FLOW_*: Compiler 层 Flow 缓存配置
- COMMAND_*_TIMEOUT_MS: 命令执行工具超时（毫秒）
- NETWORK_TOOL_TIMEOUT / WEB_FETCH_MAX_CONTENT_LENGTH: 网络工具超时与内容上限
- SEARCH_ENGINE / TAVILY_API_KEY / SERPER_API_KEY: 搜索引擎配置
- GREP_TOOL_TIMEOUT / GREP_MAX_FILES: Grep 工具超时与文件上限
- EMBEDDING_PROVIDER: Embedding 服务提供商
- AGENT_TOOL_TIMEOUT: Agent 工具执行超时（秒）
- RETURN_INTERMEDIATE_STEPS: Task 工具是否返回中间步骤
- INTERACTION_TIMEOUT: 交互类工具（AskUserQuestion/ExitPlanMode）等待超时
"""

import os
from types import SimpleNamespace

# 时区：所有时间戳生成统一使用（与 app.core.config.DEFAULT_TIMEZONE 一致）
DEFAULT_TIMEZONE: str = os.getenv("DEFAULT_TIMEZONE", "UTC")

# ReAct 最大迭代轮数（与 app.core.config.DEFAULT_MAX_ITERS 一致）
DEFAULT_MAX_ITERS: int = int(os.getenv("MAX_ITERATIONS", "10"))

# LLM 流式响应 stall 超时（秒）：两次 chunk 之间超过该时间视为流停滞
STREAM_STALL_TIMEOUT: int = int(os.getenv("STREAM_STALL_TIMEOUT", "60"))

# Ollama 请求超时（秒）
OLLAMA_REQUEST_TIMEOUT: int = int(os.getenv("OLLAMA_REQUEST_TIMEOUT", "300"))

# Compiler 层 Flow 缓存配置（与 app.core.config 一致）
COMPILED_FLOW_MAX_INSTANCES: int = int(os.getenv("COMPILED_FLOW_MAX_INSTANCES", "50"))
COMPILED_FLOW_CACHE_TIMEOUT: int = int(os.getenv("COMPILED_FLOW_CACHE_TIMEOUT", "1800"))
COMPILED_FLOW_CLEANUP_INTERVAL: int = int(os.getenv("COMPILED_FLOW_CLEANUP_INTERVAL", "300"))

# 命令执行工具超时（毫秒）
COMMAND_MAX_TIMEOUT_MS: int = int(os.getenv("COMMAND_MAX_TIMEOUT_MS", "600000"))
COMMAND_DEFAULT_TIMEOUT_MS: int = int(os.getenv("COMMAND_DEFAULT_TIMEOUT_MS", "30000"))

# 网络工具：超时（秒）与内容上限
NETWORK_TOOL_TIMEOUT: int = int(os.getenv("NETWORK_TOOL_TIMEOUT", "30"))
WEB_FETCH_MAX_CONTENT_LENGTH: int = int(os.getenv("WEB_FETCH_MAX_CONTENT_LENGTH", "10000"))

# 搜索引擎配置
SEARCH_ENGINE: str = os.getenv("SEARCH_ENGINE", "bing")
TAVILY_API_KEY = os.getenv("TAVILY_API_KEY")
SERPER_API_KEY = os.getenv("SERPER_API_KEY")

# Grep 工具超时（秒）与单次扫描最大文件数
GREP_TOOL_TIMEOUT: int = int(os.getenv("GREP_TOOL_TIMEOUT", "60"))
GREP_MAX_FILES: int = int(os.getenv("GREP_MAX_FILES", "1000"))

# Embedding 服务配置（SearchCodebase 语义搜索默认 bge-m3/ollama）
EMBEDDING_PROVIDER: str = os.getenv("EMBEDDING_PROVIDER", "ollama")
EMBEDDING_MODEL: str = os.getenv("EMBEDDING_MODEL", "bge-m3")
EMBEDDING_DIMENSIONS: int = int(os.getenv("EMBEDDING_DIMENSIONS", "1024"))
EMBEDDING_BASE_URL = os.getenv("EMBEDDING_BASE_URL", "http://localhost:11434")
EMBEDDING_API_KEY = os.getenv("EMBEDDING_API_KEY")

# Agent 工具执行超时（秒）
AGENT_TOOL_TIMEOUT: int = int(os.getenv("AGENT_TOOL_TIMEOUT", "300"))

# Task 工具是否返回中间步骤
RETURN_INTERMEDIATE_STEPS: bool = os.getenv("RETURN_INTERMEDIATE_STEPS", "false").lower() == "true"

# 交互类工具（AskUserQuestion/ExitPlanMode）等待用户响应的超时时间（秒）
INTERACTION_TIMEOUT: int = int(os.getenv("INTERACTION_TIMEOUT", "300"))

# 兼容对象：SoloAgent 层沿用 `settings.XXX` 读取语法（与 app.core.config.settings 一致）
settings = SimpleNamespace(
    DEFAULT_TIMEZONE=DEFAULT_TIMEZONE,
    DEFAULT_MAX_ITERS=DEFAULT_MAX_ITERS,
    STREAM_STALL_TIMEOUT=STREAM_STALL_TIMEOUT,
    OLLAMA_REQUEST_TIMEOUT=OLLAMA_REQUEST_TIMEOUT,
    COMPILED_FLOW_MAX_INSTANCES=COMPILED_FLOW_MAX_INSTANCES,
    COMPILED_FLOW_CACHE_TIMEOUT=COMPILED_FLOW_CACHE_TIMEOUT,
    COMPILED_FLOW_CLEANUP_INTERVAL=COMPILED_FLOW_CLEANUP_INTERVAL,
    COMMAND_MAX_TIMEOUT_MS=COMMAND_MAX_TIMEOUT_MS,
    COMMAND_DEFAULT_TIMEOUT_MS=COMMAND_DEFAULT_TIMEOUT_MS,
    NETWORK_TOOL_TIMEOUT=NETWORK_TOOL_TIMEOUT,
    WEB_FETCH_MAX_CONTENT_LENGTH=WEB_FETCH_MAX_CONTENT_LENGTH,
    SEARCH_ENGINE=SEARCH_ENGINE,
    TAVILY_API_KEY=TAVILY_API_KEY,
    SERPER_API_KEY=SERPER_API_KEY,
    GREP_TOOL_TIMEOUT=GREP_TOOL_TIMEOUT,
    GREP_MAX_FILES=GREP_MAX_FILES,
    EMBEDDING_PROVIDER=EMBEDDING_PROVIDER,
    EMBEDDING_MODEL=EMBEDDING_MODEL,
    EMBEDDING_DIMENSIONS=EMBEDDING_DIMENSIONS,
    EMBEDDING_BASE_URL=EMBEDDING_BASE_URL,
    EMBEDDING_API_KEY=EMBEDDING_API_KEY,
    AGENT_TOOL_TIMEOUT=AGENT_TOOL_TIMEOUT,
    RETURN_INTERMEDIATE_STEPS=RETURN_INTERMEDIATE_STEPS,
    INTERACTION_TIMEOUT=INTERACTION_TIMEOUT,
)
