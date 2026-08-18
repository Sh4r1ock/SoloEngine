# -*- coding: utf-8 -*-
"""
AskUserQuestion 工具模块。

@file ask_user_question.py
@description 向用户提问工具，用于在执行过程中获取用户反馈
@author SoloEngine Team
@date 2026-03-02

功能描述：
- 在执行过程中向用户提问
- 支持多选项问题
- 支持单选和多选模式
- 格式化问题输出

使用场景：
- 需要用户确认的场景
- 让用户选择执行路径
- 收集用户偏好

状态: ✅ 模块初始化完成
"""

import asyncio
import json
import logging
from typing import Dict, Any, List, Optional

from .base import BaseTaskTool
from .._hitl import get_run_context, await_user_message

logger = logging.getLogger(__name__)


class AskUserQuestion(BaseTaskTool):
    """
    AskUserQuestion 工具类。
    
    用于在执行过程中向用户提问，获取用户反馈。
    
    核心功能：
        1. 格式化问题输出
        2. 验证问题结构
        3. 支持单选和多选模式
    
    问题结构：
        - header: 问题标题（最多12个字符）
        - question: 问题内容
        - options: 选项列表（2-4个选项）
        - multiSelect: 是否多选
    
    Example:
        >>> tool = AskUserQuestion()
        >>> result = tool.execute(
        ...     questions=[
        ...         {
        ...             "header": "确认操作",
        ...             "question": "是否继续执行？",
        ...             "options": [
        ...                 {"label": "是", "description": "继续执行"},
        ...                 {"label": "否", "description": "取消操作"}
        ...             ],
        ...             "multiSelect": False
        ...         }
        ...     ]
        ... )
    """
    
    MAX_HEADER_LENGTH = 12
    """标题最大长度"""
    
    MIN_OPTIONS = 2
    """最小选项数量"""
    
    MAX_OPTIONS = 4
    """最大选项数量"""
    
    def validate_question(self, question: Dict[str, Any]) -> Optional[str]:
        """
        验证单个问题的有效性。
        
        Args:
            question (Dict[str, Any]): 问题数据
        
        Returns:
            Optional[str]: 错误信息，如果验证通过则返回 None
        """
        if not isinstance(question, dict):
            return "问题必须是字典类型"
        
        if "header" not in question:
            return "问题缺少必需的 'header' 字段"
        
        header = question["header"]
        if not isinstance(header, str):
            return "'header' 必须是字符串类型"
        
        if len(header) > self.MAX_HEADER_LENGTH:
            return f"'header' 长度不能超过 {self.MAX_HEADER_LENGTH} 个字符"
        
        if "question" not in question:
            return "问题缺少必需的 'question' 字段"
        
        if not isinstance(question["question"], str):
            return "'question' 必须是字符串类型"
        
        if "options" not in question:
            return "问题缺少必需的 'options' 字段"
        
        options = question["options"]
        if not isinstance(options, list):
            return "'options' 必须是列表类型"
        
        if len(options) < self.MIN_OPTIONS or len(options) > self.MAX_OPTIONS:
            return f"'options' 数量必须在 {self.MIN_OPTIONS}-{self.MAX_OPTIONS} 之间"
        
        for i, option in enumerate(options):
            option_error = self._validate_option(option, i)
            if option_error:
                return option_error
        
        if "multiSelect" in question and not isinstance(question["multiSelect"], bool):
            return "'multiSelect' 必须是布尔类型"
        
        return None
    
    def _validate_option(self, option: Dict[str, Any], index: int) -> Optional[str]:
        """
        验证单个选项的有效性。
        
        Args:
            option (Dict[str, Any]): 选项数据
            index (int): 选项索引
        
        Returns:
            Optional[str]: 错误信息，如果验证通过则返回 None
        """
        if not isinstance(option, dict):
            return f"第 {index + 1} 个选项必须是字典类型"
        
        if "label" not in option:
            return f"第 {index + 1} 个选项缺少必需的 'label' 字段"
        
        if not isinstance(option["label"], str):
            return f"第 {index + 1} 个选项的 'label' 必须是字符串类型"
        
        if "description" not in option:
            return f"第 {index + 1} 个选项缺少必需的 'description' 字段"
        
        if not isinstance(option["description"], str):
            return f"第 {index + 1} 个选项的 'description' 必须是字符串类型"
        
        return None
    
    def validate_questions(self, questions: List[Dict[str, Any]]) -> Optional[str]:
        """
        验证问题列表的有效性。
        
        Args:
            questions (List[Dict[str, Any]]): 问题列表
        
        Returns:
            Optional[str]: 错误信息，如果验证通过则返回 None
        """
        if not isinstance(questions, list):
            return "questions 必须是列表类型"
        
        if len(questions) == 0:
            return "questions 列表不能为空"
        
        for i, question in enumerate(questions):
            error = self.validate_question(question)
            if error:
                return f"第 {i + 1} 个问题验证失败: {error}"
        
        return None
    
    def format_question(self, question: Dict[str, Any]) -> str:
        """
        格式化单个问题为可读文本。
        
        Args:
            question (Dict[str, Any]): 问题数据
        
        Returns:
            str: 格式化的问题文本
        """
        header = question.get("header", "")
        question_text = question.get("question", "")
        options = question.get("options", [])
        multi_select = question.get("multiSelect", False)
        
        lines = []
        lines.append(f"[{header}]")
        lines.append(f"问题: {question_text}")
        lines.append("选项:")
        
        for i, option in enumerate(options):
            label = option.get("label", "")
            description = option.get("description", "")
            lines.append(f"  {i + 1}. {label} - {description}")
        
        if multi_select:
            lines.append("(可多选)")
        else:
            lines.append("(单选)")
        
        return "\n".join(lines)
    
    async def execute(self, questions: List[Dict[str, Any]]) -> Dict[str, Any]:
        """
        执行提问，等待用户真实回答。

        工具本身是暂停的：execute 被 toolkit_executor await 调用，
        内部通过 run_context 的业务消息队列等待用户在工具调用面板中选择/输入，
        收到回答后才返回给 LLM 继续执行。

        Args:
            questions (List[Dict[str, Any]]): 问题列表，每个问题包含：
                - header (str): 问题标题（最多12个字符）
                - question (str): 问题内容
                - options (List[Dict]): 选项列表（2-4个选项）
                    - label (str): 选项标签
                    - description (str): 选项描述
                - multiSelect (bool): 是否多选

        Returns:
            Dict[str, Any]: 执行结果，包含：
                - success: 是否成功
                - answers: 用户回答列表 [{question, answer}]
                - questions: 格式化后的问题列表
                - formatted_text: 格式化的文本输出
                - error: 错误信息（如果失败）
        """
        validation_error = self.validate_questions(questions)
        if validation_error:
            return self.format_error(validation_error, "VALIDATION_ERROR")

        formatted_questions = []
        formatted_texts = []

        for question in questions:
            formatted_q = {
                "header": question["header"],
                "question": question["question"],
                "options": [
                    {
                        "label": opt["label"],
                        "description": opt["description"],
                    }
                    for opt in question["options"]
                ],
                "multiSelect": question.get("multiSelect", False),
            }
            formatted_questions.append(formatted_q)
            formatted_texts.append(self.format_question(question))

        formatted_text = "\n\n".join(formatted_texts)

        # 真实交互：等待用户在工具调用面板中选择/输入回答。
        # 用户回答经前端 → WS execute → run.py enqueue_message 进入业务消息队列，
        # await_user_message 内部 await 该队列即实现"工具暂停等待用户回答"。
        run_context = get_run_context()
        if run_context is not None:
            try:
                answers = await self._await_user_answers(run_context, formatted_questions)
            except asyncio.TimeoutError:
                return {
                    "content": "User response timed out; no answer was provided.",
                    "success": False,
                    "error_message": "等待用户回答超时",
                    "questions": formatted_questions,
                    "formatted_text": formatted_text,
                    "question_count": len(formatted_questions),
                    "metadata": {},
                }

            # content 为结构化 JSON（question → answer 映射），供 LLM 直接消费，
            # 与主流 Agent SDK（Claude Agent SDK user-input）的 answers 结构一致。
            content = json.dumps({"answers": answers}, ensure_ascii=False)

            return {
                "content": content,
                "answers": answers,
                "questions": formatted_questions,
                "formatted_text": formatted_text,
                "question_count": len(formatted_questions),
                "success": True,
                "error_message": None,
                "metadata": {},
            }

        # 无 run_context（非 Web 执行场景）：直接报错，严禁回退。
        # 工具必须真实等待用户回答，失败即显式报错（对齐 _hitl.await_user_input）。
        raise RuntimeError(
            "无运行上下文（run_context）：无法等待用户回答，"
            "AskUserQuestion 工具必须在 AgenticFlow 执行环境中使用"
        )

    async def _await_user_answers(
        self,
        run_context,
        questions: List[Dict[str, Any]],
    ) -> Dict[str, str]:
        """
        等待用户对全部问题的回答（一次性接收）。

        前端分页卡片在最后一题点击「确认」后，一次性提交全部答案（JSON，
        {answers: {question_text: answer}}，未作答的题为 null 即跳过），
        此处只取一条消息并解析为 question → answer 映射。

        Args:
            run_context: 当前执行的 run_context。
            questions (List[Dict]): 格式化后的问题列表。

        Returns:
            Dict[str, str]: 回答映射 {question_text: answer_text}（未作答为 None）

        Raises:
            asyncio.TimeoutError: 等待回答超时。
        """
        answer_text = await await_user_message(run_context, "用户问答")

        answers: Dict[str, Any] = {}
        try:
            data = json.loads(answer_text)
            raw = data.get("answers", data) if isinstance(data, dict) else {}
            if isinstance(raw, dict):
                answers = raw
        except (json.JSONDecodeError, AttributeError):
            logger.warning(f"[AskUserQuestion] 用户回答非 JSON，按空答案处理: {answer_text[:80]}")

        # 按问题顺序规整为 question → answer（缺失即 None=跳过），保证结构稳定
        result: Dict[str, Any] = {}
        for question in questions:
            result[question["question"]] = answers.get(question["question"])

        # 保留前端额外提交的答案（前端自动附加的"补充信息"等题不在后端 questions 中），
        # 避免用户填写的补充信息丢失——LLM 应能看到补充内容
        for key, value in answers.items():
            if key not in result:
                result[key] = value

        return result

    def get_tool_spec(self) -> Dict[str, Any]:
        """
        获取工具规范。
        
        返回兼容 OpenAI Function Calling 格式的工具规范。
        
        Returns:
            Dict[str, Any]: 工具规范
        """
        return {
            "name": "AskUserQuestion",
            "description": (
                "在执行过程中向用户提问，获取用户反馈。"
                "调用后工具会暂停等待用户回答，用户在界面选择选项或输入内容后"
                "回答会返回给 Agent 继续执行。"
                "支持单选和多选模式，每个问题可以有2-4个选项。"
                "问题标题最多12个字符。"
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "questions": {
                        "type": "array",
                        "description": "问题列表",
                        "items": {
                            "type": "object",
                            "properties": {
                                "header": {
                                    "type": "string",
                                    "maxLength": 12,
                                    "description": "问题标题（最多12个字符）"
                                },
                                "question": {
                                    "type": "string",
                                    "description": "问题内容"
                                },
                                "options": {
                                    "type": "array",
                                    "description": "选项列表（2-4个选项）",
                                    "items": {
                                        "type": "object",
                                        "properties": {
                                            "label": {
                                                "type": "string",
                                                "description": "选项标签"
                                            },
                                            "description": {
                                                "type": "string",
                                                "description": "选项描述"
                                            }
                                        },
                                        "required": ["label", "description"]
                                    },
                                    "minItems": 2,
                                    "maxItems": 4
                                },
                                "multiSelect": {
                                    "type": "boolean",
                                    "description": "是否多选（默认为false）"
                                }
                            },
                            "required": ["header", "question", "options"]
                        }
                    }
                },
                "required": ["questions"]
            }
        }

