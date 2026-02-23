# -*- coding: utf-8 -*-
"""Local TTS Model implementation for offline text-to-speech."""

import os
import aiofiles
from typing import Optional, Dict, Any
from datetime import datetime
import logging

from ...core.interfaces import ITTSModel

logger = logging.getLogger(__name__)


class LocalTTSModel(ITTSModel):
    """Local Text-to-Speech model implementation using various local TTS engines."""
    
    def __init__(
        self,
        model_path: Optional[str] = None,
        output_path: str = "./tts_output",
        engine: str = "pyttsx3",
        language: str = "en",
    ):
        self.model_path = model_path
        self.output_path = output_path
        self.engine_name = engine
        self.language = language
        self._engine = None
        
        os.makedirs(output_path, exist_ok=True)
    
    def _get_engine(self):
        if self._engine is None:
            if self.engine_name == "pyttsx3":
                try:
                    import pyttsx3
                    self._engine = pyttsx3.init()
                    self._engine.setProperty('rate', 150)
                    self._engine.setProperty('volume', 1.0)
                except ImportError:
                    raise ImportError(
                        "pyttsx3 is required for local TTS. Install with: pip install pyttsx3"
                    )
            elif self.engine_name == "gtts":
                pass
            elif self.engine_name == "coqui":
                try:
                    from TTS.api import TTS as CoquiTTS
                    if self.model_path:
                        self._engine = CoquiTTS(model_path=self.model_path)
                    else:
                        self._engine = CoquiTTS(model_name="tts_models/en/ljspeech/vits")
                except ImportError:
                    raise ImportError(
                        "TTS is required for Coqui TTS. Install with: pip install TTS"
                    )
        
        return self._engine
    
    async def synthesize(
        self,
        text: str,
        output_file: Optional[str] = None,
        **kwargs
    ) -> Dict[str, Any]:
        try:
            if self.engine_name == "pyttsx3":
                return await self._synthesize_pyttsx3(text, output_file, **kwargs)
            elif self.engine_name == "gtts":
                return await self._synthesize_gtts(text, output_file, **kwargs)
            elif self.engine_name == "coqui":
                return await self._synthesize_coqui(text, output_file, **kwargs)
            else:
                return {"success": False, "error": f"Unknown engine: {self.engine_name}"}
                
        except ImportError as e:
            logger.error(f"Local TTS import failed: {e}")
            return {"success": False, "error": str(e)}
        except Exception as e:
            logger.error(f"Local TTS synthesis failed: {e}")
            return {"success": False, "error": str(e)}
    
    async def _synthesize_pyttsx3(
        self,
        text: str,
        output_file: Optional[str] = None,
        **kwargs
    ) -> Dict[str, Any]:
        import asyncio
        
        engine = self._get_engine()
        
        if not output_file:
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            output_file = os.path.join(self.output_path, f"tts_{timestamp}.wav")
        
        rate = kwargs.get("rate", 150)
        volume = kwargs.get("volume", 1.0)
        
        engine.setProperty('rate', rate)
        engine.setProperty('volume', volume)
        
        def save_audio():
            engine.save_to_file(text, output_file)
            engine.runAndWait()
        
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, save_audio)
        
        return {
            "success": True,
            "output_file": output_file,
            "text_length": len(text),
            "engine": "pyttsx3"
        }
    
    async def _synthesize_gtts(
        self,
        text: str,
        output_file: Optional[str] = None,
        **kwargs
    ) -> Dict[str, Any]:
        try:
            from gtts import gTTS
            import asyncio
            
            language = kwargs.get("language", self.language)
            
            if not output_file:
                timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
                output_file = os.path.join(self.output_path, f"tts_{timestamp}.mp3")
            
            def save_audio():
                tts = gTTS(text=text, lang=language, slow=False)
                tts.save(output_file)
            
            loop = asyncio.get_event_loop()
            await loop.run_in_executor(None, save_audio)
            
            return {
                "success": True,
                "output_file": output_file,
                "text_length": len(text),
                "language": language,
                "engine": "gtts"
            }
            
        except ImportError:
            raise ImportError(
                "gtts is required for Google TTS. Install with: pip install gTTS"
            )
    
    async def _synthesize_coqui(
        self,
        text: str,
        output_file: Optional[str] = None,
        **kwargs
    ) -> Dict[str, Any]:
        import asyncio
        
        engine = self._get_engine()
        
        if not output_file:
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            output_file = os.path.join(self.output_path, f"tts_{timestamp}.wav")
        
        speaker = kwargs.get("speaker", None)
        language_id = kwargs.get("language_id", None)
        
        def save_audio():
            engine.tts_to_file(
                text=text,
                speaker=speaker,
                language=language_id,
                file_path=output_file
            )
        
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, save_audio)
        
        return {
            "success": True,
            "output_file": output_file,
            "text_length": len(text),
            "engine": "coqui"
        }
    
    async def get_available_voices(self) -> list:
        try:
            if self.engine_name == "pyttsx3":
                engine = self._get_engine()
                voices = engine.getProperty('voices')
                return [
                    {
                        "id": v.id,
                        "name": v.name,
                        "language": v.languages[0] if v.languages else "unknown"
                    }
                    for v in voices
                ]
            elif self.engine_name == "gtts":
                return [
                    {"id": "en", "name": "English", "language": "en"},
                    {"id": "zh-CN", "name": "Chinese (Simplified)", "language": "zh-CN"},
                    {"id": "zh-TW", "name": "Chinese (Traditional)", "language": "zh-TW"},
                    {"id": "ja", "name": "Japanese", "language": "ja"},
                    {"id": "ko", "name": "Korean", "language": "ko"},
                    {"id": "de", "name": "German", "language": "de"},
                    {"id": "fr", "name": "French", "language": "fr"},
                    {"id": "es", "name": "Spanish", "language": "es"},
                ]
            elif self.engine_name == "coqui":
                engine = self._get_engine()
                if hasattr(engine, 'speakers') and engine.speakers:
                    return [
                        {"id": s, "name": s, "language": "multi"}
                        for s in engine.speakers
                    ]
                return [{"id": "default", "name": "Default Speaker", "language": "en"}]
        except Exception as e:
            logger.error(f"Failed to get voices: {e}")
        
        return []
    
    async def get_available_languages(self) -> list:
        if self.engine_name == "gtts":
            return [
                {"code": "en", "name": "English"},
                {"code": "zh-CN", "name": "Chinese (Simplified)"},
                {"code": "zh-TW", "name": "Chinese (Traditional)"},
                {"code": "ja", "name": "Japanese"},
                {"code": "ko", "name": "Korean"},
                {"code": "de", "name": "German"},
                {"code": "fr", "name": "French"},
                {"code": "es", "name": "Spanish"},
                {"code": "ru", "name": "Russian"},
                {"code": "ar", "name": "Arabic"},
            ]
        return [{"code": self.language, "name": self.language}]
