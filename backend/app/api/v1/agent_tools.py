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
import logging
from typing import Dict, List, Optional, Any
from datetime import datetime
from fastapi import APIRouter, HTTPException, Depends, BackgroundTasks
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.database import get_db, db_manager, LLMConfigModel
from app.core.llm_service import LLMService
from app.api.v1.auth import get_current_user
from app.core.auth import User
from app.api.v1.run_project import _active_project_sessions

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
        
        db_manager.add_memory(
            db=db,
            user_id=current_user.id,
            role="user",
            content=request.message,
            run_project_id=project_id,
        )
        
        result = await LLMService.chat(
            config=config,
            message=request.message,
            system_prompt=request.system_prompt,
            conversation_history=request.conversation_history,
            temperature=request.temperature,
            max_tokens=request.max_tokens,
            model=request.model,
        )
        
        db_manager.add_memory(
            db=db,
            user_id=current_user.id,
            role="assistant",
            content=result["content"],
            run_project_id=project_id,
            metadata={
                "model": result["model"],
                "tokens": result["tokens_used"]
            }
        )
        
        result["project_id"] = project_id
        
        return {
            "code": 200,
            "message": "LLM响应已生成",
            "data": result
        }
    
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
