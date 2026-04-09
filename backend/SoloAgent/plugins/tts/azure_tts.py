# -*- coding: utf-8 -*-
"""
SoloEngine : Azure TTS模型实现

@file azure_tts.py
@description Azure认知服务文本转语音模型实现
@author Sh4rlock
@date 2026-04-09

功能描述：
本模块提供Azure TTS模型实现，包括：
    - AzureTTSModel: Azure文本转语音模型
    - 使用Azure认知服务语音API
    - 支持SSML语音合成标记语言
    - 支持多种语音和语言
    - 支持语速和音调调节

依赖:
    - os: 操作系统接口
    - aiofiles: 异步文件操作
    - typing: 类型提示
    - datetime: 日期时间
    - logging: 日志记录
    - httpx: HTTP客户端
    - ...core.interfaces: 核心接口

使用示例:
    - from SoloAgent.plugins.tts import AzureTTSModel
    - tts = AzureTTSModel(subscription_key="your_key", region="eastus")
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


class AzureTTSModel(ITTSModel):
    """
    Azure文本转语音模型

    职责:
        - 实现ITTSModel接口
        - 调用Azure认知服务语音API
        - 支持SSML语音合成
        - 支持多种语音和语言
        - 管理访问令牌

    属性:
        subscription_key: Azure订阅密钥
        region: Azure区域
        voice: 默认语音
        output_path: 输出路径
        _token: 访问令牌
        _token_expires: 令牌过期时间

    示例:
        >>> tts = AzureTTSModel(subscription_key="your_key", region="eastus")
        >>> result = await tts.synthesize("Hello World")
        >>> print(result["output_file"])
    """

    def __init__(
        self,
        subscription_key: Optional[str] = None,
        region: str = "eastus",
        voice: str = "en-US-JennyNeural",
        output_path: str = "./tts_output",
    ):
        """
        初始化Azure TTS模型

        Args:
            subscription_key: Azure订阅密钥，默认从环境变量AZURE_SPEECH_KEY读取
            region: Azure区域，默认为"eastus"
            voice: 默认语音，默认为"en-US-JennyNeural"
            output_path: 输出路径，默认为"./tts_output"

        示例:
            >>> tts = AzureTTSModel(subscription_key="your_key")
        """
        self.subscription_key = subscription_key or os.getenv("AZURE_SPEECH_KEY")
        self.region = region
        self.voice = voice
        self.output_path = output_path
        self._token = None
        self._token_expires = None

        os.makedirs(output_path, exist_ok=True)
    
    async def _get_access_token(self) -> Optional[str]:
        if self._token and self._token_expires:
            from datetime import datetime, timedelta
            if datetime.now() < self._token_expires - timedelta(minutes=5):
                return self._token
        
        try:
            import httpx
            
            token_url = f"https://{self.region}.api.cognitive.microsoft.com/sts/v1.0/issueToken"
            
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    token_url,
                    headers={
                        "Ocp-Apim-Subscription-Key": self.subscription_key,
                        "Content-Type": "application/x-www-form-urlencoded"
                    }
                )
                
                if response.status_code == 200:
                    self._token = response.text
                    from datetime import datetime, timedelta
                    self._token_expires = datetime.now() + timedelta(minutes=10)
                    return self._token
                else:
                    logger.error(f"Failed to get Azure token: {response.status_code}")
                    return None
                    
        except Exception as e:
            logger.error(f"Azure token request failed: {e}")
            return None
    
    async def synthesize(
        self,
        text: str,
        output_file: Optional[str] = None,
        **kwargs
    ) -> Dict[str, Any]:
        if not self.subscription_key:
            logger.warning("Azure Speech key not configured, TTS synthesis skipped")
            return {"success": False, "error": "Subscription key not configured"}
        
        try:
            import httpx
            
            token = await self._get_access_token()
            if not token:
                return {"success": False, "error": "Failed to get access token"}
            
            voice = kwargs.get("voice", self.voice)
            rate = kwargs.get("rate", "1.0")
            pitch = kwargs.get("pitch", "0%")
            
            ssml = f"""
            <speak version='1.0' xml:lang='en-US'>
                <voice name='{voice}'>
                    <prosody rate='{rate}' pitch='{pitch}'>
                        {text}
                    </prosody>
                </voice>
            </speak>
            """
            
            url = f"https://{self.region}.tts.speech.microsoft.com/cognitiveservices/v1"
            
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    url,
                    content=ssml.encode('utf-8'),
                    headers={
                        "Authorization": f"Bearer {token}",
                        "Content-Type": "application/ssml+xml",
                        "X-Microsoft-OutputFormat": "audio-16khz-128kbitrate-mono-mp3"
                    }
                )
                
                if response.status_code != 200:
                    return {
                        "success": False,
                        "error": f"Azure TTS error: {response.status_code} - {response.text}"
                    }
                
                if not output_file:
                    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
                    output_file = os.path.join(self.output_path, f"tts_{timestamp}.mp3")
                
                async with aiofiles.open(output_file, "wb") as f:
                    await f.write(response.content)
                
                return {
                    "success": True,
                    "output_file": output_file,
                    "text_length": len(text),
                    "voice": voice
                }
                
        except Exception as e:
            logger.error(f"Azure TTS synthesis failed: {e}")
            return {"success": False, "error": str(e)}
    
    async def get_available_voices(self) -> list:
        try:
            import httpx
            
            token = await self._get_access_token()
            if not token:
                return []
            
            url = f"https://{self.region}.tts.speech.microsoft.com/cognitiveservices/voices/list"
            
            async with httpx.AsyncClient() as client:
                response = await client.get(
                    url,
                    headers={"Authorization": f"Bearer {token}"}
                )
                
                if response.status_code == 200:
                    voices = response.json()
                    return [
                        {
                            "id": v["ShortName"],
                            "name": v["DisplayName"],
                            "language": v["Locale"],
                            "gender": v["Gender"]
                        }
                        for v in voices
                    ]
                    
        except Exception as e:
            logger.error(f"Failed to get Azure voices: {e}")
        
        return []
