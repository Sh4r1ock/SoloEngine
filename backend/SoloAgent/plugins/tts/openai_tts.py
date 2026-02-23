# -*- coding: utf-8 -*-
"""OpenAI TTS Model implementation."""

import os
import aiofiles
from typing import Optional, Dict, Any
from datetime import datetime
import logging

from ...core.interfaces import ITTSModel

logger = logging.getLogger(__name__)


class OpenAITTSModel(ITTSModel):
    """OpenAI Text-to-Speech model implementation."""
    
    def __init__(
        self,
        api_key: Optional[str] = None,
        model: str = "tts-1",
        voice: str = "alloy",
        output_path: str = "./tts_output",
        base_url: Optional[str] = None,
    ):
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
