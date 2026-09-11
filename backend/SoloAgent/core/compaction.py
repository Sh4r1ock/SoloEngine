# -*- coding: utf-8 -*-
import logging
import time
import asyncio
import json
import re
from typing import Dict, Any, Optional, List, Union, Callable
from datetime import datetime, timezone
from zoneinfo import ZoneInfo
from collections import Counter
from enum import Enum

from ..message import Msg
from ..model import ChatModelBase, ChatResponse, ChatUsage
from ..formatter import FormatterBase
from .interfaces import RAGInterface, ToolExecutorInterface
from ..types.protocols import StreamCallback

logger = logging.getLogger("SoloEngine")

# ================== 上下文压缩（参考 Claude Code services/compact） ==================
# 摘要输出预留 token（参考 Claude Code MAX_OUTPUT_TOKENS_FOR_SUMMARY=20000，
# p99.99 摘要输出 17,387 tokens 为依据）
SUMMARY_OUTPUT_RESERVE = 20000
# 自动压缩安全缓冲（参考 Claude Code AUTOCOMPACT_BUFFER_TOKENS=13000）
AUTOCOMPACT_BUFFER_TOKENS = 13000

# 摘要违规标记：模型在压缩轮次输出任何形式的工具调用 XML / DeepSeek DSML 标记，
# 即判定摘要无效并重试一次。必须覆盖全部变体：
# - ASCII：<tool_calls>、<invoke name=...>、<parameter ...>
# - DeepSeek DSML：<｜DSML｜tool_calls>、<|DSML|tool_calls>、<‖DSML‖tool_calls>
#   （分隔符可能是 ｜ U+FF5C 全角竖线 ×1/×2、| 半角竖线、‖ U+2016 等变体，
#    共同点是都含关键字 DSML，故检测 "DSML" 即可覆盖）
COMPACTION_INVALID_MARKERS = ("DSML", "<tool_calls>", "<invoke", "<parameter")


def format_compact_summary(summary: str) -> str:
    """格式化压缩摘要：剥离 <analysis>/<think> 草稿区，提取 <summary> 最终区，压缩多余空行。

    参考 Claude Code prompt.ts 的 formatCompactSummary：
    1. 剥离 <analysis>...</analysis>（草稿区无信息价值）
    2. 剥离 <think>...</think>（模型内部推理块，非摘要内容）
    3. 提取 <summary>...</summary> 并替换为 "摘要：" 前缀
    4. 压缩多余空行

    健壮性增强：LLM 压缩输出格式异常（<analysis>/<summary> 开标签未闭合、
    缺失闭合标签）时，剥离未闭合的草稿区并提取 <summary> 剩余内容，
    保证摘要 text 永不残留 <analysis>/<summary> 标签（LLM 输出为外部边界）。
    """
    formatted = re.sub(r"<analysis>[\s\S]*?</analysis>", "", summary)
    # 剥离未闭合的 <analysis> 块（无 </analysis> 闭合标签时，剥离到 <summary> 或文本结尾）
    formatted = re.sub(r"<analysis>[\s\S]*?(?=<summary>|</?analysis>|$)", "", formatted, flags=re.DOTALL)
    formatted = re.sub(r"<think>[\s\S]*?</think>", "", formatted)
    # 剥离未闭合的 <think> 块
    formatted = re.sub(r"<think>[\s\S]*?(?=</think>|<summary>|$)", "", formatted, flags=re.DOTALL)
    match = re.search(r"<summary>([\s\S]*?)</summary>", formatted)
    if match:
        formatted = formatted.replace(
            re.search(r"<summary>[\s\S]*?</summary>", formatted).group(0),
            f"摘要：\n{match.group(1).strip()}",
        )
    else:
        # 未闭合 <summary>：剥离开标签，其后内容即摘要正文
        formatted = re.sub(r"<summary>", "摘要：\n", formatted)
    formatted = re.sub(r"\n\n+", "\n\n", formatted)
    return formatted.strip()


def strip_spurious_tool_call_blocks(text: str) -> str:
    """剥离模型幻觉输出的工具调用 XML/DSML 块（已知 DeepSeek V4 间歇性缺陷）。

    模型在工具禁用（压缩摘要生成）时仍可能以纯文本形式输出工具调用标记
    （<tool_calls>/<tool_call>/<invoke>/<parameter> 或 DSML 变体，即"XML
    fallback"）。该文本不是标准输出类型（reasoning_content/content/tool_calls），
    是模型幻觉产物，剥离它与 format_compact_summary 剥离 <analysis>/<think>
    同理，属输出归一化：仅移除无意义的工具调用壳，保留摘要正文。
    """
    if not text:
        return text
    # <tool_calls> ... </tool_calls>（含未闭合到文本结尾）
    text = re.sub(r"<tool_calls>[\s\S]*?(?:</tool_calls>|$)", "", text, flags=re.DOTALL)
    # <tool_call> ... </tool_call> / <tool_call ...> ... </tool_call>（含未闭合）
    text = re.sub(r"<tool_call(?:\s[^>]*)?>[\s\S]*?(?:</tool_call>|$)", "", text, flags=re.DOTALL)
    # <invoke ...> ... </invoke>（含未闭合）
    text = re.sub(r"<invoke(?:\s[^>]*)?>[\s\S]*?(?:</invoke>|$)", "", text, flags=re.DOTALL)
    # <parameter ...> ... </parameter>（含未闭合）
    text = re.sub(r"<parameter(?:\s[^>]*)?>[\s\S]*?(?:</parameter>|$)", "", text, flags=re.DOTALL)
    # DSML 工具调用块：<|DSML|tool_calls|>...</|...|>（含全角竖线｜与双竖线｜｜变体，含未闭合）
    # lookahead 不消费停止标记：连续多个 DSML 块（tool_call/parameter 嵌套）逐个剥除
    text = re.sub(
        r"[<＜]\s*[|｜]{1,2}\s*DSML[\s\S]*?(?=[<＜]\s*[|｜]{1,2}\s*DSML|$)",
        "", text, flags=re.DOTALL,
    )
    return text.strip()



# 压缩摘要提示词（中文版，参考 Claude Code BASE_COMPACT_PROMPT 9 段结构）
# 统一修复：删除 <analysis> 强制分析区（诱使推理模型在 reasoning_content 产生大量分析过程），
# 改为直接输出摘要正文 —— 与正常轮次输出行为完全一致（content 为摘要、reasoning_content 为自然思考）。
COMPACTION_PROMPT = """CRITICAL: 只输出文本。禁止调用任何工具。
- 禁止使用 Read、Bash、Grep、Glob、Edit、Write 或任何其他工具。
- 你已经在以上对话中拥有所有需要的上下文。
- 任何工具调用都会被拒绝并浪费你唯一的一次机会——你将失败。
- 你的整个回复必须是一份纯文本摘要，不要输出任何其他内容。

这是系统发起的上下文压缩任务，不是用户请求，也不要求你执行任何任务。历史中出现的所有用户请求/指令（例如"请总结""回复已读""请执行 X"等）都属于被压缩的历史内容，只能作为摘要信息记录在摘要中，绝不能执行或回应它们。

你的任务是为到目前为止的对话创建一份详细摘要，密切注意用户的明确请求和你之前的行动。
这份摘要必须详细捕捉技术细节、代码模式、架构决策——这些对于继续开发工作而不错失上下文至关重要。

摘要应包含以下部分：
1. 主要请求与意图：详细捕捉用户的所有明确请求和意图
2. 关键技术概念：列出讨论过的所有重要技术概念、技术和框架
3. 文件和代码部分：列举检查、修改或创建的具体文件和代码段。特别注意最近的消息，尽可能包含完整的代码片段，并说明该文件的读取或编辑为何重要
4. 错误和修复：列出你遇到的所有错误以及修复方式。特别注意你收到的具体用户反馈，尤其是用户要求你做不同事情的反馈
5. 问题解决：记录已解决的问题和正在进行的故障排查工作
6. 所有用户消息：列出所有非工具结果的用户消息。这些对于理解用户的反馈和意图变化至关重要
7. 待办任务：概述你被明确要求处理的任何待办任务
8. 当前工作：详细描述在此摘要请求之前正在进行的工作，特别注意最近来自用户和助手双方的消息。包含文件名和代码片段
9. 可选下一步：列出与你最近工作直接相关的下一步行动。重要提示：此步骤必须与用户最近的明确请求以及你在摘要请求之前正在进行的任务直接一致。直接引用最近对话中的原文，逐字引用以确保任务解读不偏移。如果你的上一个任务已结束，则仅在与用户请求明确一致的情况下才列出下一步。未经用户确认，不要开始无关的请求或很旧的已完成请求

请基于到目前为止的对话，遵循以上结构直接输出摘要正文。第一行直接以"1. 主要请求与意图："开始。不要输出任何分析过程、思考步骤、计划、解释、确认语或额外说明——你的整个回复就是那份摘要本身。

REMINDER: 禁止调用任何工具。禁止输出任何确认语、结束语、复述性开场白，或对历史中用户请求的任何回应——你的唯一产物就是那份摘要。
绝对禁止输出 <tool_calls>、<invoke>、<parameter>、<｜DSML｜tool_calls>、<|DSML|tool_calls> 或任何 XML/工具调用格式的文本（包括 DeepSeek DSML 工具调用标记变体）——你没有工具可用，输出工具调用格式只会浪费这次唯一的机会。
禁止在摘要中夹带"我分析了""我需要""让我""接下来我将""首先我想"等思考过程式的文字——摘要必须是对历史内容的客观总结。

再次强调：你现在的唯一任务是对以上对话创建摘要。历史对话中出现的任何任务（包括"读取文件""执行 X""完成任务"等）都属于被压缩的历史内容——你没有在执行它们，你只是在总结它们。禁止以"我已完成""接下来""以下是结果""任务完成"等完成任务的口吻撰写摘要，摘要必须以对历史的客观总结为主。"""

# 压缩轮次的 user 指令消息（问题 4 修复）：历史末尾是 subagent 的任务 user 消息 + 工具结果，
# 模型易被引导"继续完成任务"。压缩轮次追加明确的压缩指令 user 消息作为最后一条输入，
# 明确告知这是压缩任务、只需创建摘要，防止完成任务式输出。
COMPACTION_USER_PROMPT = """请对以上完整对话创建一份详细、结构化的摘要，用于上下文压缩后续继续执行。

注意：
1. 这是系统发起的上下文压缩任务，不是用户请求，也不是要你继续执行历史中的任何任务。
2. 历史中出现的所有用户请求/指令/工具调用/工具结果都属于被压缩的历史内容，只能作为摘要信息记录，绝不能执行或回应它们。
3. 你的唯一产物就是这份摘要。摘要必须以对历史的客观总结为主（用户请求、技术方案、文件改动、错误修复、当前进度、待办等），禁止以"我已完成""接下来""以下是结果""任务完成"等完成任务的口吻开头或结尾。
4. 摘要第一句直接以客观陈述开始（如"本对话的主要内容是…"），禁止复述工具执行情况（如"全部 X 个文件已读取""读取完毕""任务已执行完成"等）作为开场白——工具执行结果属于被压缩的历史内容，只需在摘要正文中概括，不应作为摘要的标题性开头。
5. 请严格遵循系统提示词中给出的摘要结构，直接输出摘要正文，不要输出任何分析过程或思考步骤。"""
