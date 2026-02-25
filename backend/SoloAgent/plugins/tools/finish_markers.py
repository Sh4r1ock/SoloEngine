# -*- coding: utf-8 -*-
"""
Finish 工具模块 - Text Markers 模式。

@file finish_markers.py
@description 通过文本标记词检测任务完成
@author SoloEngine Team
@date 2026-02-25

功能描述：
- 定义多语言完成/继续标记词配置
- 通过启发式关键词匹配判断任务状态
- 支持 TEXT_MARKERS 模式的任务完成检测

设计理念：
- 用于不支持 Function Calling 或 Structured Output 的模型
- 通过启发式关键词匹配判断任务状态
- 可配置、可扩展

使用场景：
- ReAct 循环中的文本标记词检测
- 不支持 Function Calling 的模型
- 需要多语言支持的场景

状态: ✅ 完整实现
"""

from dataclasses import dataclass, field
from typing import List, ClassVar, Dict, Any


@dataclass
class CompletionMarkers:
    """
    多语言完成标记配置。
    
    用于 TEXT_MARKERS 模式的任务完成检测。
    包含完成标记和继续标记两类关键词。
    
    Attributes:
        completion (List[str]): 完成标记列表。
        continuation (List[str]): 继续标记列表。
    """
    
    completion: List[str] = field(default_factory=list)
    continuation: List[str] = field(default_factory=list)
    
    _presets: ClassVar[Dict[str, Dict[str, List[str]]]] = {
        "en": {
            "completion": [
                "final answer",
                "final answer:",
                "answer:",
                "conclusion:",
                "conclusion",
                "task completed",
                "task complete",
                "done",
                "finished",
                "i have completed",
                "here is the result",
                "the result is",
                "in summary",
                "to summarize",
                "the answer is",
                "result:",
                "output:",
                "response:",
            ],
            "continuation": [
                "i need to",
                "next step",
                "next, i will",
                "i should",
                "let me",
                "i will now",
                "first, i",
                "then i will",
                "i'll",
                "i must",
                "continuing",
                "proceeding",
            ],
        },
        "zh": {
            "completion": [
                "最终答案",
                "最终答案：",
                "答案是",
                "答案是：",
                "结论",
                "结论：",
                "任务完成",
                "任务已完成",
                "完成",
                "已完成",
                "结果如下",
                "结果如下：",
                "回答如下",
                "回答如下：",
                "总结",
                "总结：",
                "综上所述",
                "我的回答是",
                "我的回答是：",
            ],
            "continuation": [
                "下一步",
                "接下来",
                "我需要",
                "我需要先",
                "首先",
                "然后",
                "接着",
                "让我",
                "我将",
                "我要",
                "继续",
                "进行",
            ],
        },
        "ja": {
            "completion": [
                "最終回答",
                "最終回答：",
                "答えは",
                "答えは：",
                "結論",
                "結論：",
                "タスク完了",
                "完了",
                "完了しました",
                "結果は以下",
                "結果は以下の通り",
                "まとめ",
                "まとめ：",
                "以上です",
            ],
            "continuation": [
                "次のステップ",
                "次に",
                "次は",
                "まず",
                "そして",
                "続いて",
                "私は",
                "私は次に",
                "続けます",
                "進めます",
            ],
        },
    }
    
    @classmethod
    def english(cls) -> 'CompletionMarkers':
        """获取英文标记词预设。"""
        preset = cls._presets["en"]
        return cls(
            completion=preset["completion"].copy(),
            continuation=preset["continuation"].copy(),
        )
    
    @classmethod
    def chinese(cls) -> 'CompletionMarkers':
        """获取中文标记词预设。"""
        preset = cls._presets["zh"]
        return cls(
            completion=preset["completion"].copy(),
            continuation=preset["continuation"].copy(),
        )
    
    @classmethod
    def japanese(cls) -> 'CompletionMarkers':
        """获取日文标记词预设。"""
        preset = cls._presets["ja"]
        return cls(
            completion=preset["completion"].copy(),
            continuation=preset["continuation"].copy(),
        )
    
    @classmethod
    def from_language(cls, language: str) -> 'CompletionMarkers':
        """根据语言代码获取标记词预设。"""
        if language == "zh":
            return cls.chinese()
        elif language == "ja":
            return cls.japanese()
        else:
            return cls.english()
    
    @classmethod
    def get_supported_languages(cls) -> List[str]:
        """获取支持的语言列表。"""
        return list(cls._presets.keys())
    
    def to_dict(self) -> Dict[str, Any]:
        """转换为字典格式。"""
        return {
            "completion": self.completion.copy(),
            "continuation": self.continuation.copy(),
        }
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'CompletionMarkers':
        """从字典创建配置。"""
        return cls(
            completion=data.get("completion", []),
            continuation=data.get("continuation", []),
        )
    
    def merge(self, other: 'CompletionMarkers') -> 'CompletionMarkers':
        """合并两个标记词配置。"""
        return CompletionMarkers(
            completion=list(set(self.completion + other.completion)),
            continuation=list(set(self.continuation + other.continuation)),
        )


def check_finish_by_markers(
    text: str, 
    markers: CompletionMarkers
) -> Dict[str, Any]:
    """
    通过文本标记词检测任务是否完成。
    
    Args:
        text (str): LLM 输出文本。
        markers (CompletionMarkers): 标记词配置。
    
    Returns:
        Dict[str, Any]: 检测结果，包含：
            - is_finished (bool): 是否任务完成
            - has_continuation (bool): 是否包含继续标记
            - confidence (float): 完成置信度
    """
    result = {
        "is_finished": False,
        "has_continuation": False,
        "confidence": 0.0,
    }
    
    if not text or not text.strip():
        return result
    
    text_lower = text.lower()
    
    for marker in markers.completion:
        if marker.lower() in text_lower:
            result["confidence"] = _calculate_confidence(text)
            if result["confidence"] > 0.5:
                result["is_finished"] = True
                return result
    
    for marker in markers.continuation:
        if marker.lower() in text_lower:
            result["has_continuation"] = True
            return result
    
    return result


def _calculate_confidence(text: str) -> float:
    """计算任务完成的置信度。"""
    confidence = 0.0
    text_lower = text.lower()
    
    strong_markers = ["final answer", "task completed", "conclusion:"]
    for marker in strong_markers:
        if marker in text_lower:
            confidence += 0.4
    
    weak_markers = ["answer:", "result:", "done", "finished"]
    for marker in weak_markers:
        if marker in text_lower:
            confidence += 0.2
    
    if _looks_like_final_answer(text):
        confidence += 0.2
    
    return min(confidence, 1.0)


def _looks_like_final_answer(text: str) -> bool:
    """判断文本是否看起来像最终答案。"""
    import re
    
    sentences = re.split(r'[.!?。！？]+', text)
    if len(sentences) <= 2:
        return True
    
    if re.search(r'^\s*(yes|no|correct|incorrect|是|否|对|错)\s*[,.，。]', text.lower()):
        return True
    
    return False


__all__ = [
    "CompletionMarkers",
    "check_finish_by_markers",
]
