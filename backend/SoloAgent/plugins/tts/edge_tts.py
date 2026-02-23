# -*- coding: utf-8 -*-
"""Edge TTS Model implementation using Microsoft Edge's online TTS service."""

import os
import aiofiles
from typing import Optional, Dict, Any
from datetime import datetime
import logging
import json

from ...core.interfaces import ITTSModel

logger = logging.getLogger(__name__)


class EdgeTTSModel(ITTSModel):
    """Edge TTS model implementation using Microsoft Edge's free online TTS."""
    
    def __init__(
        self,
        voice: str = "en-US-AriaNeural",
        output_path: str = "./tts_output",
    ):
        self.voice = voice
        self.output_path = output_path
        self._communicate = None
        
        os.makedirs(output_path, exist_ok=True)
    
    def _get_edge_tts(self):
        if self._communicate is None:
            try:
                import edge_tts
                self._communicate = edge_tts.Communicate
            except ImportError:
                raise ImportError(
                    "edge-tts is required for Edge TTS. Install with: pip install edge-tts"
                )
        return self._communicate
    
    async def synthesize(
        self,
        text: str,
        output_file: Optional[str] = None,
        **kwargs
    ) -> Dict[str, Any]:
        try:
            Communicate = self._get_edge_tts()
            
            voice = kwargs.get("voice", self.voice)
            rate = kwargs.get("rate", "+0%")
            volume = kwargs.get("volume", "+0%")
            
            if not output_file:
                timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
                output_file = os.path.join(self.output_path, f"tts_{timestamp}.mp3")
            
            communicate = Communicate(
                text=text,
                voice=voice,
                rate=rate,
                volume=volume
            )
            
            await communicate.save(output_file)
            
            return {
                "success": True,
                "output_file": output_file,
                "text_length": len(text),
                "voice": voice
            }
            
        except ImportError as e:
            logger.error(f"Edge TTS import failed: {e}")
            return {"success": False, "error": str(e)}
        except Exception as e:
            logger.error(f"Edge TTS synthesis failed: {e}")
            return {"success": False, "error": str(e)}
    
    async def get_available_voices(self) -> list:
        try:
            import edge_tts
            
            voices = await edge_tts.list_voices()
            
            return [
                {
                    "id": v["ShortName"],
                    "name": v["FriendlyName"],
                    "language": v["Locale"],
                    "gender": v["Gender"]
                }
                for v in voices
            ]
            
        except ImportError:
            logger.warning("edge-tts not installed, returning default voices")
            return self._get_default_voices()
        except Exception as e:
            logger.error(f"Failed to get Edge voices: {e}")
            return self._get_default_voices()
    
    def _get_default_voices(self) -> list:
        return [
            {"id": "en-US-AriaNeural", "name": "Aria (US English)", "language": "en-US", "gender": "Female"},
            {"id": "en-US-GuyNeural", "name": "Guy (US English)", "language": "en-US", "gender": "Male"},
            {"id": "en-GB-SoniaNeural", "name": "Sonia (UK English)", "language": "en-GB", "gender": "Female"},
            {"id": "en-GB-RyanNeural", "name": "Ryan (UK English)", "language": "en-GB", "gender": "Male"},
            {"id": "zh-CN-XiaoxiaoNeural", "name": "晓晓 (中文)", "language": "zh-CN", "gender": "Female"},
            {"id": "zh-CN-YunxiNeural", "name": "云希 (中文)", "language": "zh-CN", "gender": "Male"},
            {"id": "zh-CN-YunyangNeural", "name": "云扬 (中文)", "language": "zh-CN", "gender": "Male"},
            {"id": "ja-JP-NanamiNeural", "name": "Nanami (Japanese)", "language": "ja-JP", "gender": "Female"},
            {"id": "ko-KR-SunHiNeural", "name": "SunHi (Korean)", "language": "ko-KR", "gender": "Female"},
        ]
    
    async def stream_synthesize(self, text: str, **kwargs):
        try:
            Communicate = self._get_edge_tts()
            
            voice = kwargs.get("voice", self.voice)
            rate = kwargs.get("rate", "+0%")
            
            communicate = Communicate(text=text, voice=voice, rate=rate)
            
            async for chunk in communicate.stream():
                if chunk["type"] == "audio":
                    yield chunk["data"]
                    
        except Exception as e:
            logger.error(f"Edge TTS streaming failed: {e}")
            raise
