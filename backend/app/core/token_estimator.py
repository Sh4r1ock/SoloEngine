# -*- coding: utf-8 -*-
"""
SoloEngine : 上下文 / 输出 token 估算（核心层）

@file token_estimator.py
@description 基于 tiktoken 的纯函数 token 估算，供核心层（react_core 上下文压缩
             阈值检测、输出 token 统计）使用。无任何 API 层 / 前端依赖。

架构分层（对齐 06-architecture.md）：
- 核心层（本模块）：纯估算函数，不感知 FastAPI / 前端
- 引用方（SoloAgent.core.react_core）：核心层内部使用，保持低耦合
"""

import json
from typing import Any, Dict

import tiktoken


def estimate_context_tokens(messages: list, model_name: str) -> Dict[str, int]:
    """估算输入消息 token，按角色分类统计。

    分类语义（与主流 AI IDE 一致：仅 3 种输入角色 + completion 输出）：
    - system_prompt_token：system 消息 content token
    - user_prompt_token：user 消息 content token
    - assistant_prompt_token：assistant 输入侧 token
      = assistant 消息 content token + assistant tool_calls token + tool 消息（工具结果）token
      （assistant 消息包含 content + tool_calls；工具结果是 assistant 发起工具调用后
      回填的输入上下文，供 assistant 继续推理，语义上归 assistant——不新增分类）

    设计要点（2026-08-04 重构）：
    1. 不含 reasoning_content（思维链）：DeepSeek 官方规范——多轮对话无需回传
       reasoning_content，仅工具调用轮协议强制回传；reasoning_content 是模型输出
       （计费在 completion 侧），不是输入。故不估算。
    2. 不含 tools schema / 消息结构 overhead：仅统计消息内容本身，作为压缩阈值
       （上下文占用）的判断依据；工具定义等固定开销不计入角色分类。
    3. 返回值仅 3 类（system/user/assistant），与 total 的关系：
       total = API 权威值（prompt + completion）；3 类求和为本地估算，
       与 API prompt_tokens 存在 tokenizer 编码差异（估算 vs 真实）。
    """
    try:
        encoder = tiktoken.encoding_for_model(model_name)
    except KeyError:
        encoder = tiktoken.get_encoding("o200k_base")

    result = {
        "system_prompt_token": 0,
        "user_prompt_token": 0,
        "assistant_prompt_token": 0,
    }

    def _content_text(content) -> str:
        """提取 content 文本（str 直接返回；list 拼接各 block 的 text，不含思维链块）。"""
        if isinstance(content, str):
            return content
        if isinstance(content, list):
            return "".join(
                (block.get("text", "") or "")
                for block in content
                if isinstance(block, dict)
            )
        return ""

    for message in messages:
        role = message.get("role")
        content = message.get("content", "")
        text = _content_text(content)
        token_count = len(encoder.encode(text)) if text else 0

        if role == "system":
            result["system_prompt_token"] += token_count
        elif role == "user":
            result["user_prompt_token"] += token_count
        elif role == "assistant":
            result["assistant_prompt_token"] += token_count
            # assistant tool_calls token（JSON 序列化，包含 function name + arguments）
            # tool_calls 是 assistant 生成的一部分，应计入 assistant_prompt_token
            tool_calls = message.get("tool_calls")
            if tool_calls:
                tc_text = json.dumps(tool_calls, ensure_ascii=False)
                result["assistant_prompt_token"] += len(encoder.encode(tc_text))
        elif role == "tool":
            # 工具结果计入 assistant_prompt_token：工具结果是 assistant 发起工具调用后
            # 回填的输入上下文（ReAct：assistant tool_calls → tool 结果 → assistant 继续推理）。
            result["assistant_prompt_token"] += token_count

    return result


def estimate_text_tokens(text: str, model_name: str) -> int:
    try:
        encoder = tiktoken.encoding_for_model(model_name)
    except KeyError:
        encoder = tiktoken.get_encoding("o200k_base")
    return len(encoder.encode(text))
