# -*- coding: utf-8 -*-
"""
SoloEngine : OpenAI TTS模型实现

@file openai_tts.py
@description OpenAI文本转语音模型实现
@author Sh4rlock
@date 2026-04-09

功能描述：
本模块提供OpenAI TTS模型实现，包括：
    - OpenAITTSModel: OpenAI文本转语音模型
    - 支持多种语音（alloy, echo, fable, onyx, nova, shimmer）
    - 支持语速调节
    - 支持多种输出格式

依赖:
    - os: 操作系统接口
    - aiofiles: 异步文件操作
    - typing: 类型提示
    - datetime: 日期时间
    - logging: 日志记录
    - httpx: HTTP客户端
    - ...core.interfaces: 核心接口

使用示例:
    - from SoloAgent.plugins.tts import OpenAITTSModel
    - tts = OpenAITTSModel(api_key="your_key")
    - result = await tts.synthesize("Hello World")
    - voices = await tts.get_available_voices()
"""

import os
import aiofiles
from typing import Optional, Dict, Any
from datetime import datetime
import logging

from ...core.interfaces import ITTSModel

logger = logging.getLogger(__name__)


class OpenAITTSModel(ITTSModel):
    """
    OpenAI文本转语音模型

    职责:
        - 实现ITTSModel接口
        - 调用OpenAI TTS API
        - 支持多种语音和语速
        - 管理音频输出

    属性:
        api_key: OpenAI API密钥
        model: TTS模型名称
        voice: 默认语音
        output_path: 输出路径
        base_url: API基础URL
        _client: HTTP客户端

    示例:
        >>> tts = OpenAITTSModel(api_key="your_key", voice="alloy")
        >>> result = await tts.synthesize("Hello World")
        >>> print(result["output_file"])
    """

    def __init__(
        self,
        api_key: Optional[str] = None,
        model: str = "tts-1",
        voice: str = "alloy",
        output_path: str = "./tts_output",
        base_url: Optional[str] = None,
    ):
        """
        初始化OpenAI TTS模型

        Args:
            api_key: OpenAI API密钥，默认从环境变量读取
            model: TTS模型名称，默认为"tts-1"
            voice: 默认语音，默认为"alloy"
            output_path: 输出路径，默认为"./tts_output"
            base_url: API基础URL，默认为OpenAI官方API

        示例:
            >>> tts = OpenAITTSModel(api_key="your_key")
        """
        self.api_key = api_key or os.getenv("OPENAI_API_KEY")
        self.model = model
        self.voice = voice
        self.output_path = output_path
        self.base_url = base_url or os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1")
        self._client = None

        os.makedirs(output_path, exist_ok=True)
    
    def _get_client(self):
        if self._client is None:
            try:
                import httpx
                self._client = httpx.AsyncClient(
                    base_url=self.base_url,
                    headers={
                        "Authorization": f"Bearer {self.api_key}",
                        "Content-Type": "application/json"
                    },
                    timeout=60.0
                )
            except ImportError:
                raise ImportError("httpx is required for OpenAI TTS. Install with: pip install httpx")
        return self._client
    
    async def synthesize(
        self,
        text: str,
        output_file: Optional[str] = None,
        **kwargs
    ) -> Dict[str, Any]:
        if not self.api_key:
            logger.warning("OpenAI API key not configured, TTS synthesis skipped")
            return {"success": False, "error": "API key not configured"}
        
        try:
            client = self._get_client()
            
            voice = kwargs.get("voice", self.voice)
            model = kwargs.get("model", self.model)
            speed = kwargs.get("speed", 1.0)
            response_format = kwargs.get("response_format", "mp3")
            
            response = await client.post(
                "/audio/speech",
                json={
                    "model": model,
                    "input": text,
                    "voice": voice,
                    "speed": speed,
                    "response_format": response_format
                }
            )
            
            if response.status_code != 200:
                return {
                    "success": False,
                    "error": f"OpenAI API error: {response.status_code} - {response.text}"
                }
            
            if not output_file:
                timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
                output_file = os.path.join(
                    self.output_path,
                    f"tts_{timestamp}.{response_format}"
                )
            
            async with aiofiles.open(output_file, "wb") as f:
                await f.write(response.content)
            
            return {
                "success": True,
                "output_file": output_file,
                "text_length": len(text),
                "voice": voice,
                "model": model
            }
            
        except Exception as e:
            logger.error(f"OpenAI TTS synthesis failed: {e}")
            return {"success": False, "error": str(e)}
    
    async def get_available_voices(self) -> list:
        return [
            {"id": "alloy", "name": "Alloy", "description": "Neutral voice"},
            {"id": "echo", "name": "Echo", "description": "Male voice"},
            {"id": "fable", "name": "Fable", "description": "British voice"},
            {"id": "onyx", "name": "Onyx", "description": "Deep male voice"},
            {"id": "nova", "name": "Nova", "description": "Female voice"},
            {"id": "shimmer", "name": "Shimmer", "description": "Warm female voice"},
        ]
    
    async def close(self):
        if self._client:
            await self._client.aclose()
            self._client = None
