# -*- coding: utf-8 -*-
"""
Agent Tools API endpoints.

@file agent_tools.py
@description Agent工具API - LLM调用、浏览器操作、文档读写等工具接口
@author SoloEngine Team
@date 2026-02-22

功能描述：
- LLM对话接口（支持用户配置的模型）
- 浏览器自动化操作接口
- 文档读写操作接口
- 工具执行结果记录
- 项目绑定的对话历史

使用场景：
- 调试面板调用Agent工具
- 工作流执行过程中的工具调用

重构说明：
- 所有LLM配置从数据库读取，不再依赖环境变量
- 支持通过config_id指定使用哪个配置
- 未指定时使用用户默认配置
"""
import os
import json
import logging
import asyncio
from typing import Dict, List, Optional, Any
from datetime import datetime
import uuid
import httpx
from fastapi import APIRouter, HTTPException, Depends, BackgroundTasks
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.database import get_db, db_manager, LLMConfigModel
from app.api.v1.auth import get_current_user
from app.core.auth import User
from app.api.v1.debug_project import _active_project_sessions

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/agent-tools", tags=["agent-tools"])


class LLMRequest(BaseModel):
    message: str = Field(..., description="用户消息")
    config_id: Optional[str] = Field(None, description="LLM配置ID，未指定时使用默认配置")
    model: Optional[str] = Field(None, description="模型名称（可选，覆盖配置）")
    provider: Optional[str] = Field(None, description="提供商（可选，覆盖配置）")
    temperature: Optional[float] = Field(None, ge=0, le=2, description="温度参数（可选）")
    max_tokens: Optional[int] = Field(None, ge=1, le=32000, description="最大Token数（可选）")
    system_prompt: Optional[str] = Field(None, description="系统提示词")
    conversation_history: Optional[List[Dict[str, str]]] = Field(None, description="对话历史")
    project_id: Optional[str] = Field(None, description="项目ID，用于绑定对话历史")


class LLMResponse(BaseModel):
    content: str
    model: str
    provider: str
    config_id: Optional[str] = None
    config_name: Optional[str] = None
    tokens_used: Dict[str, int]
    finish_reason: str


class BrowserNavigateRequest(BaseModel):
    url: str = Field(..., description="目标URL")


class BrowserActionRequest(BaseModel):
    action_type: str = Field(..., description="操作类型: click, type, scroll, screenshot, extract")
    selector: Optional[str] = Field(None, description="CSS选择器")
    text: Optional[str] = Field(None, description="输入文本")
    direction: Optional[str] = Field(None, description="滚动方向: up, down")


class DocumentReadRequest(BaseModel):
    filename: str = Field(..., description="文件名")
    encoding: str = Field(default="utf-8", description="文件编码")


class DocumentWriteRequest(BaseModel):
    filename: str = Field(..., description="文件名")
    content: str = Field(..., description="文件内容")
    encoding: str = Field(default="utf-8", description="文件编码")
    mode: str = Field(default="write", description="写入模式: write, append")


class DocumentSearchRequest(BaseModel):
    path: str = Field(default=".", description="搜索路径")
    pattern: str = Field(..., description="搜索模式")
    recursive: bool = Field(default=True, description="递归搜索")


class DocumentSummarizeRequest(BaseModel):
    content: str = Field(..., description="文档内容")
    max_length: int = Field(default=500, description="最大摘要长度")
    config_id: Optional[str] = Field(None, description="LLM配置ID")


_llm_clients: Dict[str, Any] = {}


def _get_decrypted_api_key(config: LLMConfigModel) -> str:
    """从配置中获取解密后的API Key。"""
    if config.api_key:
        return db_manager.encryption_service.decrypt(config.api_key) if db_manager.encryption_service else config.api_key
    return ""


async def _get_llm_config(
    db: Session,
    user_id: str,
    config_id: Optional[str] = None
) -> LLMConfigModel:
    """获取用户的LLM配置。"""
    if config_id:
        config = db_manager.get_llm_config(db, config_id, user_id)
        if not config:
            raise HTTPException(status_code=404, detail=f"LLM配置 '{config_id}' 不存在")
        return config
    
    config = db_manager.get_default_llm_config(db, user_id)
    if not config:
        raise HTTPException(
            status_code=400,
            detail="未找到默认LLM配置，请先在设置中配置模型"
        )
    return config


async def _create_llm_client(config: LLMConfigModel) -> tuple:
    """根据配置创建LLM客户端。"""
    provider = config.provider
    api_key = _get_decrypted_api_key(config)
    base_url = config.base_url
    
    if provider == "openai":
        client = httpx.AsyncClient(
            base_url=base_url or "https://api.openai.com/v1",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json"
            },
            timeout=float(config.timeout or 120)
        )
        return ("openai", client, config)
    
    elif provider == "anthropic":
        client = httpx.AsyncClient(
            base_url=base_url or "https://api.anthropic.com/v1",
            headers={
                "x-api-key": api_key,
                "anthropic-version": "2023-06-01",
                "Content-Type": "application/json"
            },
            timeout=float(config.timeout or 120)
        )
        return ("anthropic", client, config)
    
    elif provider == "qwen":
        client = httpx.AsyncClient(
            base_url=base_url or "https://dashscope.aliyuncs.com/api/v1",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json"
            },
            timeout=float(config.timeout or 120)
        )
        return ("qwen", client, config)
    
    elif provider == "ollama":
        client = httpx.AsyncClient(
            base_url=f"{base_url or 'http://localhost:11434'}/api",
            timeout=float(config.timeout or 120)
        )
        return ("ollama", client, config)
    
    else:
        raise ValueError(f"不支持的LLM提供商: {provider}")


@router.post("/llm/chat")
async def llm_chat(
    request: LLMRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """LLM对话接口 - 使用用户配置的模型。"""
    try:
        project_id = request.project_id or _active_project_sessions.get(current_user.id)
        
        config = await _get_llm_config(db, current_user.id, request.config_id)
        provider_type, client, llm_config = await _create_llm_client(config)
        
        model = request.model or llm_config.model_name
        temperature = request.temperature if request.temperature is not None else llm_config.temperature
        max_tokens = request.max_tokens or llm_config.max_tokens
        
        messages = []
        if request.system_prompt:
            messages.append({"role": "system", "content": request.system_prompt})
        
        if request.conversation_history:
            messages.extend(request.conversation_history)
        
        messages.append({"role": "user", "content": request.message})
        
        db_manager.add_memory(
            db=db,
            user_id=current_user.id,
            role="user",
            content=request.message,
            debug_project_id=project_id,
        )
        
        if provider_type == "openai":
            response = await client.post(
                "/chat/completions",
                json={
                    "model": model,
                    "messages": messages,
                    "temperature": temperature,
                    "max_tokens": max_tokens
                }
            )
            
            if response.status_code != 200:
                raise HTTPException(
                    status_code=response.status_code,
                    detail=f"OpenAI API 错误: {response.text}"
                )
            
            data = response.json()
            assistant_content = data["choices"][0]["message"]["content"]
            
            db_manager.add_memory(
                db=db,
                user_id=current_user.id,
                role="assistant",
                content=assistant_content,
                debug_project_id=project_id,
                metadata={"model": model, "tokens": data.get("usage", {})}
            )
            
            return {
                "code": 200,
                "message": "LLM响应已生成",
                "data": {
                    "content": assistant_content,
                    "model": data.get("model", model),
                    "provider": provider_type,
                    "config_id": config.id,
                    "config_name": config.name,
                    "tokens_used": {
                        "prompt_tokens": data.get("usage", {}).get("prompt_tokens", 0),
                        "completion_tokens": data.get("usage", {}).get("completion_tokens", 0),
                        "total_tokens": data.get("usage", {}).get("total_tokens", 0)
                    },
                    "finish_reason": data["choices"][0].get("finish_reason", "stop"),
                    "project_id": project_id,
                }
            }
        
        elif provider_type == "anthropic":
            anthropic_messages = []
            system_content = None
            for msg in messages:
                if msg["role"] == "system":
                    system_content = msg["content"]
                else:
                    anthropic_messages.append({
                        "role": msg["role"],
                        "content": msg["content"]
                    })
            
            request_body = {
                "model": model,
                "messages": anthropic_messages,
                "max_tokens": max_tokens
            }
            if system_content:
                request_body["system"] = system_content
            
            response = await client.post(
                "/messages",
                json=request_body
            )
            
            if response.status_code != 200:
                raise HTTPException(
                    status_code=response.status_code,
                    detail=f"Anthropic API 错误: {response.text}"
                )
            
            data = response.json()
            content = ""
            for block in data.get("content", []):
                if block.get("type") == "text":
                    content += block.get("text", "")
            
            return {
                "code": 200,
                "message": "LLM响应已生成",
                "data": {
                    "content": content,
                    "model": data.get("model", model),
                    "provider": provider_type,
                    "config_id": config.id,
                    "config_name": config.name,
                    "tokens_used": {
                        "input_tokens": data.get("usage", {}).get("input_tokens", 0),
                        "output_tokens": data.get("usage", {}).get("output_tokens", 0)
                    },
                    "finish_reason": data.get("stop_reason", "end_turn")
                }
            }
        
        elif provider_type == "qwen":
            qwen_messages = []
            for msg in messages:
                qwen_messages.append({
                    "role": msg["role"],
                    "content": msg["content"]
                })
            
            response = await client.post(
                "/services/aigc/text-generation/generation",
                json={
                    "model": model,
                    "input": {
                        "messages": qwen_messages
                    },
                    "parameters": {
                        "temperature": temperature,
                        "max_tokens": max_tokens
                    }
                }
            )
            
            if response.status_code != 200:
                raise HTTPException(
                    status_code=response.status_code,
                    detail=f"通义千问 API 错误: {response.text}"
                )
            
            data = response.json()
            output = data.get("output", {})
            
            return {
                "code": 200,
                "message": "LLM响应已生成",
                "data": {
                    "content": output.get("text", ""),
                    "model": model,
                    "provider": provider_type,
                    "config_id": config.id,
                    "config_name": config.name,
                    "tokens_used": {
                        "input_tokens": data.get("usage", {}).get("input_tokens", 0),
                        "output_tokens": data.get("usage", {}).get("output_tokens", 0)
                    },
                    "finish_reason": output.get("finish_reason", "stop")
                }
            }
        
        elif provider_type == "ollama":
            response = await client.post(
                "/chat",
                json={
                    "model": model,
                    "messages": messages,
                    "stream": False,
                    "options": {
                        "temperature": temperature,
                        "num_predict": max_tokens
                    }
                }
            )
            
            if response.status_code != 200:
                raise HTTPException(
                    status_code=response.status_code,
                    detail=f"Ollama API 错误: {response.text}"
                )
            
            data = response.json()
            return {
                "code": 200,
                "message": "LLM响应已生成",
                "data": {
                    "content": data.get("message", {}).get("content", ""),
                    "model": data.get("model", model),
                    "provider": provider_type,
                    "config_id": config.id,
                    "config_name": config.name,
                    "tokens_used": {
                        "prompt_tokens": data.get("prompt_eval_count", 0),
                        "completion_tokens": data.get("eval_count", 0)
                    },
                    "finish_reason": "stop"
                }
            }
        
        else:
            raise HTTPException(status_code=400, detail=f"不支持的提供商: {provider_type}")
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"LLM对话失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/browser/navigate")
async def browser_navigate(
    request: BrowserNavigateRequest,
    current_user: User = Depends(get_current_user)
):
    """浏览器导航接口。"""
    try:
        from playwright.async_api import async_playwright
        
        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True)
            page = await browser.new_page()
            
            try:
                response = await page.goto(request.url, wait_until="networkidle", timeout=30000)
                
                title = await page.title()
                url = page.url
                
                return {
                    "code": 200,
                    "message": "Navigation completed",
                    "data": {
                        "status": "completed",
                        "url": url,
                        "title": title,
                        "status_code": response.status if response else None
                    }
                }
            finally:
                await browser.close()
    
    except ImportError:
        return {
            "code": 503,
            "message": "Playwright not installed. Install with: pip install playwright && playwright install",
            "data": {"status": "error", "error": "Playwright not available"}
        }
    except Exception as e:
        logger.error(f"Browser navigation failed: {e}")
        return {
            "code": 500,
            "message": str(e),
            "data": {"status": "error", "error": str(e)}
        }


@router.post("/browser/action")
async def browser_action(
    request: BrowserActionRequest,
    current_user: User = Depends(get_current_user)
):
    """浏览器操作接口。"""
    try:
        from playwright.async_api import async_playwright
        
        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True)
            page = await browser.new_page()
            
            try:
                result = {"status": "completed", "action_type": request.action_type}
                
                if request.action_type == "screenshot":
                    screenshot_bytes = await page.screenshot(full_page=True)
                    import base64
                    result["screenshot_base64"] = base64.b64encode(screenshot_bytes).decode()
                    result["message"] = "Screenshot captured"
                
                elif request.action_type == "extract":
                    if request.selector:
                        content = await page.inner_text(request.selector)
                    else:
                        content = await page.inner_text("body")
                    result["content"] = content
                    result["message"] = "Content extracted"
                
                elif request.action_type == "click":
                    if not request.selector:
                        raise ValueError("Selector required for click action")
                    await page.click(request.selector)
                    result["message"] = f"Clicked: {request.selector}"
                
                elif request.action_type == "type":
                    if not request.selector or not request.text:
                        raise ValueError("Selector and text required for type action")
                    await page.fill(request.selector, request.text)
                    result["message"] = f"Typed into: {request.selector}"
                
                elif request.action_type == "scroll":
                    direction = request.direction or "down"
                    if direction == "down":
                        await page.evaluate("window.scrollBy(0, window.innerHeight)")
                    else:
                        await page.evaluate("window.scrollBy(0, -window.innerHeight)")
                    result["message"] = f"Scrolled {direction}"
                
                return {
                    "code": 200,
                    "message": "Browser action completed",
                    "data": result
                }
            
            finally:
                await browser.close()
    
    except ImportError:
        return {
            "code": 503,
            "message": "Playwright not installed",
            "data": {"status": "error", "error": "Playwright not available"}
        }
    except Exception as e:
        logger.error(f"Browser action failed: {e}")
        return {
            "code": 500,
            "message": str(e),
            "data": {"status": "error", "error": str(e)}
        }


@router.post("/document/read")
async def document_read(
    request: DocumentReadRequest,
    current_user: User = Depends(get_current_user)
):
    """文档读取接口。"""
    try:
        if not os.path.exists(request.filename):
            return {
                "code": 404,
                "message": f"File not found: {request.filename}",
                "data": {"status": "error", "error": "File not found"}
            }
        
        with open(request.filename, "r", encoding=request.encoding) as f:
            content = f.read()
        
        file_stat = os.stat(request.filename)
        
        return {
            "code": 200,
            "message": "File read successfully",
            "data": {
                "status": "completed",
                "filename": request.filename,
                "content": content,
                "size": file_stat.st_size,
                "modified": datetime.fromtimestamp(file_stat.st_mtime).isoformat()
            }
        }
    
    except UnicodeDecodeError:
        return {
            "code": 400,
            "message": f"Failed to decode file with encoding: {request.encoding}",
            "data": {"status": "error", "error": "Encoding error"}
        }
    except Exception as e:
        logger.error(f"Document read failed: {e}")
        return {
            "code": 500,
            "message": str(e),
            "data": {"status": "error", "error": str(e)}
        }


@router.post("/document/write")
async def document_write(
    request: DocumentWriteRequest,
    current_user: User = Depends(get_current_user)
):
    """文档写入接口。"""
    try:
        os.makedirs(os.path.dirname(request.filename) or ".", exist_ok=True)
        
        mode = "a" if request.mode == "append" else "w"
        with open(request.filename, mode, encoding=request.encoding) as f:
            f.write(request.content)
        
        file_stat = os.stat(request.filename)
        
        return {
            "code": 200,
            "message": "File written successfully",
            "data": {
                "status": "completed",
                "filename": request.filename,
                "size": file_stat.st_size,
                "modified": datetime.fromtimestamp(file_stat.st_mtime).isoformat()
            }
        }
    
    except Exception as e:
        logger.error(f"Document write failed: {e}")
        return {
            "code": 500,
            "message": str(e),
            "data": {"status": "error", "error": str(e)}
        }


@router.post("/document/search")
async def document_search(
    request: DocumentSearchRequest,
    current_user: User = Depends(get_current_user)
):
    """文档搜索接口。"""
    try:
        import fnmatch
        
        results = []
        search_path = os.path.abspath(request.path)
        
        if request.recursive:
            for root, dirs, files in os.walk(search_path):
                for filename in fnmatch.filter(files, request.pattern):
                    full_path = os.path.join(root, filename)
                    rel_path = os.path.relpath(full_path, search_path)
                    file_stat = os.stat(full_path)
                    results.append({
                        "path": full_path,
                        "relative_path": rel_path,
                        "size": file_stat.st_size,
                        "modified": datetime.fromtimestamp(file_stat.st_mtime).isoformat()
                    })
        else:
            for filename in os.listdir(search_path):
                if fnmatch.fnmatch(filename, request.pattern):
                    full_path = os.path.join(search_path, filename)
                    if os.path.isfile(full_path):
                        file_stat = os.stat(full_path)
                        results.append({
                            "path": full_path,
                            "relative_path": filename,
                            "size": file_stat.st_size,
                            "modified": datetime.fromtimestamp(file_stat.st_mtime).isoformat()
                        })
        
        return {
            "code": 200,
            "message": f"Found {len(results)} files",
            "data": {
                "status": "completed",
                "results": results,
                "count": len(results)
            }
        }
    
    except FileNotFoundError:
        return {
            "code": 404,
            "message": f"Path not found: {request.path}",
            "data": {"status": "error", "error": "Path not found"}
        }
    except Exception as e:
        logger.error(f"Document search failed: {e}")
        return {
            "code": 500,
            "message": str(e),
            "data": {"status": "error", "error": str(e)}
        }


@router.post("/document/summarize")
async def document_summarize(
    request: DocumentSummarizeRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """文档摘要接口 - 使用用户配置的模型。"""
    try:
        llm_request = LLMRequest(
            message=f"请总结以下内容，控制在{request.max_length}字以内:\n\n{request.content}",
            config_id=request.config_id,
            max_tokens=request.max_length * 2
        )
        
        result = await llm_chat(llm_request, db, current_user)
        
        return {
            "code": 200,
            "message": "文档摘要已生成",
            "data": {
                "status": "completed",
                "summary": result["data"]["content"],
                "original_length": len(request.content),
                "summary_length": len(result["data"]["content"]),
                "model": result["data"].get("model"),
                "config_id": result["data"].get("config_id"),
                "config_name": result["data"].get("config_name"),
            }
        }
    
    except Exception as e:
        logger.error(f"文档摘要失败: {e}")
        return {
            "code": 500,
            "message": str(e),
            "data": {"status": "error", "error": str(e)}
        }
