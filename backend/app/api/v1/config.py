# -*- coding: utf-8 -*-
"""
SoloEngine : LLM配置API模块

@file config.py
@description LLM配置接口 - 模型管理相关API端点
@author Sh4rlock
@date 2026-04-09

功能描述：
本模块提供以下核心功能：
    - 获取LLM提供商列表
    - 获取提供商支持的模型列表
    - 创建/更新/删除LLM配置
    - 设置默认模型
    - 测试模型连接
    - 获取使用统计

依赖:
    - os: 操作系统接口
    - typing: 类型注解支持
    - fastapi: FastAPI框架
    - pydantic: 数据验证
    - sqlalchemy: ORM框架
    - app.core.database: 数据库管理
    - SoloAgent.model: LLM工厂
    - SoloAgent.llm_tracker: LLM使用追踪

使用示例:
    - GET /api/v1/llm/providers - 获取提供商列表
    - POST /api/v1/llm/configs - 创建LLM配置

使用场景：
    - LLM模型配置管理
    - API密钥管理
"""
import os
from typing import List, Optional

from fastapi import APIRouter, HTTPException, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.database import get_db, db_manager, LLMConfigModel, OptimisticLockError
from SoloAgent.model.llm_factory import LLMFactory, LLMProvider
from SoloAgent.llm_tracker import LLMUsageTracker
from app.api.v1.auth import get_current_user
from app.core.auth import User

_tracker = LLMUsageTracker()
router = APIRouter(prefix="/api/v1/llm", tags=["llm"])


class ProviderConfig(BaseModel):
    """提供商配置。"""
    name: str
    display_name: str
    requires_api_key: bool
    default_model: str
    models: List[str] = []


class LLMConfigCreate(BaseModel):
    """创建LLM配置请求。"""
    name: str = Field(..., description="配置名称")
    provider: str = Field(..., description="提供商")
    model_name: str = Field(..., description="模型名称")
    api_key: Optional[str] = Field(None, description="API密钥")
    base_url: Optional[str] = Field(None, description="自定义API地址")
    temperature: float = Field(0.7, ge=0, le=2, description="温度参数")
    max_tokens: int = Field(2048, ge=1, le=128000, description="最大Token数")
    top_p: float = Field(1.0, ge=0, le=1, description="Top P参数")
    frequency_penalty: float = Field(0.0, ge=-2, le=2, description="频率惩罚")
    presence_penalty: float = Field(0.0, ge=-2, le=2, description="存在惩罚")
    timeout: int = Field(60, ge=1, le=600, description="超时时间(秒)")
    extra_params: Optional[dict] = Field(None, description="额外参数")
    is_default: bool = Field(False, description="是否设为默认")


class LLMConfigUpdate(BaseModel):
    """更新LLM配置请求。"""
    name: Optional[str] = None
    model_name: Optional[str] = None
    api_key: Optional[str] = None
    base_url: Optional[str] = None
    temperature: Optional[float] = Field(None, ge=0, le=2)
    max_tokens: Optional[int] = Field(None, ge=1, le=128000)
    top_p: Optional[float] = Field(None, ge=0, le=1)
    frequency_penalty: Optional[float] = Field(None, ge=-2, le=2)
    presence_penalty: Optional[float] = Field(None, ge=-2, le=2)
    timeout: Optional[int] = Field(None, ge=1, le=600)
    extra_params: Optional[dict] = None
    is_default: Optional[bool] = None
    version: Optional[int] = Field(None, description="乐观锁版本号")


class LLMConfigResponse(BaseModel):
    """LLM配置响应。"""
    id: str
    user_id: str
    name: str
    provider: str
    model_name: str
    base_url: Optional[str]
    temperature: float
    max_tokens: int
    top_p: float
    frequency_penalty: float
    presence_penalty: float
    timeout: int
    extra_params: dict
    is_default: bool
    is_active: bool
    version: int
    created_at: Optional[str]
    updated_at: Optional[str]


class UsageStatistics(BaseModel):
    """使用统计。"""
    time_range_hours: int
    total_requests: int
    total_tokens: int
    avg_tokens_per_request: float
    avg_time_per_request: float


@router.get("/providers")
async def get_providers() -> dict:
    """获取所有LLM提供商。"""
    providers = LLMFactory.get_available_providers()
    
    provider_configs = []
    for provider in providers:
        models = LLMFactory.get_available_models(provider)
        default_model = LLMFactory.get_default_model(provider)
        
        display_names = {
            LLMProvider.OPENAI: "OpenAI",
            LLMProvider.ANTHROPIC: "Anthropic Claude",
            LLMProvider.QWEN: "通义千问 (Qwen)",
            LLMProvider.OLLAMA: "Ollama (本地)",
        }
        
        provider_configs.append(ProviderConfig(
            name=provider,
            display_name=display_names.get(provider, provider),
            requires_api_key=provider != LLMProvider.OLLAMA,
            default_model=default_model,
            models=models,
        ))
    
    return {
        "code": 200,
        "message": "success",
        "data": [p.dict() for p in provider_configs],
    }


@router.get("/providers/{provider}/models")
async def get_provider_models(provider: str) -> dict:
    """获取提供商支持的模型列表。"""
    try:
        models = LLMFactory.get_available_models(provider)
        return {
            "code": 200,
            "message": "success",
            "data": {
                "provider": provider,
                "models": models,
            },
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/configs")
async def list_configs(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
) -> dict:
    """获取用户的所有LLM配置。"""
    user_id = current_user.id
    configs = db_manager.get_llm_configs(db, user_id)
    
    return {
        "code": 200,
        "message": "success",
        "data": [
            {
                "id": c.id,
                "user_id": c.user_id,
                "name": c.name,
                "provider": c.provider,
                "model_name": c.model_name,
                "base_url": c.base_url,
                "temperature": c.temperature,
                "max_tokens": c.max_tokens,
                "top_p": c.top_p,
                "frequency_penalty": c.frequency_penalty,
                "presence_penalty": c.presence_penalty,
                "timeout": c.timeout,
                "extra_params": c.extra_params or {},
                "is_default": c.is_default,
                "is_active": c.is_active,
                "version": c.version,
                "created_at": c.created_at.isoformat() if c.created_at else None,
                "updated_at": c.updated_at.isoformat() if c.updated_at else None,
            }
            for c in configs
        ],
    }


@router.get("/configs/active")
async def list_active_configs(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
) -> dict:
    """获取用户的活跃LLM配置（仅is_active=True，用于画布节点编辑面板）。"""
    user_id = current_user.id
    configs = db_manager.get_active_llm_configs(db, user_id)

    return {
        "code": 200,
        "message": "success",
        "data": [
            {
                "id": c.id,
                "user_id": c.user_id,
                "name": c.name,
                "provider": c.provider,
                "model_name": c.model_name,
                "base_url": c.base_url,
                "temperature": c.temperature,
                "max_tokens": c.max_tokens,
                "top_p": c.top_p,
                "frequency_penalty": c.frequency_penalty,
                "presence_penalty": c.presence_penalty,
                "timeout": c.timeout,
                "extra_params": c.extra_params or {},
                "is_default": c.is_default,
                "is_active": c.is_active,
                "version": c.version,
                "created_at": c.created_at.isoformat() if c.created_at else None,
                "updated_at": c.updated_at.isoformat() if c.updated_at else None,
            }
            for c in configs
        ],
    }


@router.get("/configs/default")
async def get_default_config(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
) -> dict:
    """获取用户的默认LLM配置。"""
    user_id = current_user.id
    config = db_manager.get_default_llm_config(db, user_id)
    
    if not config:
        return {
            "code": 200,
            "message": "No default config found",
            "data": None,
        }
    
    return {
        "code": 200,
        "message": "success",
        "data": {
            "id": config.id,
            "user_id": config.user_id,
            "name": config.name,
            "provider": config.provider,
            "model_name": config.model_name,
            "base_url": config.base_url,
            "temperature": config.temperature,
            "max_tokens": config.max_tokens,
            "top_p": config.top_p,
            "frequency_penalty": config.frequency_penalty,
            "presence_penalty": config.presence_penalty,
            "timeout": config.timeout,
            "extra_params": config.extra_params or {},
            "is_default": config.is_default,
            "version": config.version,
        },
    }


@router.get("/configs/{config_id}")
async def get_config(
    config_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
) -> dict:
    """获取指定的LLM配置。"""
    user_id = current_user.id
    config = db_manager.get_llm_config(db, config_id, user_id)
    
    if not config:
        raise HTTPException(status_code=404, detail=f"Config '{config_id}' not found")
    
    return {
        "code": 200,
        "message": "success",
        "data": {
            "id": config.id,
            "user_id": config.user_id,
            "name": config.name,
            "provider": config.provider,
            "model_name": config.model_name,
            "base_url": config.base_url,
            "temperature": config.temperature,
            "max_tokens": config.max_tokens,
            "top_p": config.top_p,
            "frequency_penalty": config.frequency_penalty,
            "presence_penalty": config.presence_penalty,
            "timeout": config.timeout,
            "extra_params": config.extra_params or {},
            "is_default": config.is_default,
            "is_active": config.is_active,
            "version": config.version,
            "created_at": config.created_at.isoformat() if config.created_at else None,
            "updated_at": config.updated_at.isoformat() if config.updated_at else None,
        },
    }


@router.post("/configs")
async def create_config(
    request: LLMConfigCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
) -> dict:
    """创建LLM配置。"""
    user_id = current_user.id
    
    try:
        config = db_manager.create_llm_config(
            db=db,
            user_id=user_id,
            name=request.name,
            provider=request.provider,
            model_name=request.model_name,
            api_key=request.api_key,
            base_url=request.base_url,
            temperature=request.temperature,
            max_tokens=request.max_tokens,
            top_p=request.top_p,
            frequency_penalty=request.frequency_penalty,
            presence_penalty=request.presence_penalty,
            timeout=request.timeout,
            extra_params=request.extra_params,
            is_default=request.is_default,
        )
        
        return {
            "code": 200,
            "message": "LLM config created successfully",
            "data": {
                "id": config.id,
                "name": config.name,
                "provider": config.provider,
                "model_name": config.model_name,
                "is_default": config.is_default,
            },
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/configs/{config_id}")
async def update_config(
    config_id: str,
    request: LLMConfigUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
) -> dict:
    """更新LLM配置（带乐观锁）。"""
    user_id = current_user.id
    
    update_data = {k: v for k, v in request.dict().items() if v is not None and k != "version"}
    
    try:
        config = db_manager.update_llm_config(
            db, config_id, user_id, version=request.version, **update_data
        )
    except OptimisticLockError as e:
        raise HTTPException(status_code=409, detail=str(e))
    
    if not config:
        raise HTTPException(status_code=404, detail=f"Config '{config_id}' not found")
    
    return {
        "code": 200,
        "message": "LLM config updated successfully",
        "data": {
            "id": config.id,
            "name": config.name,
            "provider": config.provider,
            "model_name": config.model_name,
            "is_default": config.is_default,
            "version": config.version,
        },
    }


@router.delete("/configs/{config_id}")
async def delete_config(
    config_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
) -> dict:
    """删除LLM配置。"""
    user_id = current_user.id
    success = db_manager.delete_llm_config(db, config_id, user_id)
    
    if not success:
        raise HTTPException(status_code=404, detail=f"Config '{config_id}' not found")
    
    return {
        "code": 200,
        "message": "LLM config deleted successfully",
        "data": {"config_id": config_id},
    }


@router.post("/configs/{config_id}/set-default")
async def set_default_config(
    config_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
) -> dict:
    """设置默认LLM配置。"""
    user_id = current_user.id
    
    config = db_manager.update_llm_config(db, config_id, user_id, is_default=True)
    
    if not config:
        raise HTTPException(status_code=404, detail=f"Config '{config_id}' not found")
    
    return {
        "code": 200,
        "message": "Default config set successfully",
        "data": {
            "id": config.id,
            "name": config.name,
            "is_default": config.is_default,
        },
    }


@router.post("/test")
async def test_config(request: LLMConfigCreate, db: Session = Depends(get_db)) -> dict:
    """测试LLM配置。"""
    try:
        model = LLMFactory.create_model(
            provider=request.provider,
            model_name=request.model_name,
            stream=False,
            api_key=request.api_key,
            base_url=request.base_url,
        )
        
        return {
            "code": 200,
            "message": "Configuration test successful",
            "data": {
                "provider": request.provider,
                "model_name": request.model_name,
                "status": "success",
            },
        }
    except Exception as e:
        return {
            "code": 400,
            "message": "Configuration test failed",
            "data": {
                "provider": request.provider,
                "model_name": request.model_name,
                "status": "error",
                "error": str(e),
            },
        }


@router.get("/usage")
async def get_usage(
    time_range_hours: int = Query(default=24, ge=1, le=168),
    provider: str = Query(default=None),
    model_name: str = Query(default=None),
    current_user: User = Depends(get_current_user)
) -> dict:
    """获取LLM使用统计。"""
    try:
        stats = _tracker.get_statistics(
            time_range_hours=time_range_hours,
            provider=provider,
            model_name=model_name,
        )

        return {
            "code": 200,
            "message": "success",
            "data": stats,
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/usage/daily")
async def get_daily_usage(
    start_date: str = Query(default=None, description="开始日期 YYYY-MM-DD"),
    end_date: str = Query(default=None, description="结束日期 YYYY-MM-DD"),
    provider: str = Query(default=None),
    model_name: str = Query(default=None),
    current_user: User = Depends(get_current_user)
) -> dict:
    """获取按天统计的LLM使用数据。"""
    try:
        stats = _tracker.get_daily_statistics(
            start_date=start_date,
            end_date=end_date,
            provider=provider,
            model_name=model_name,
        )

        return {
            "code": 200,
            "message": "success",
            "data": stats,
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/usage/recent")
async def get_recent_usage(
    limit: int = Query(default=100, ge=1, le=500),
    provider: str = Query(default=None),
    current_user: User = Depends(get_current_user)
) -> dict:
    """获取最近的LLM使用记录。"""
    try:
        records = _tracker.get_recent_records(limit=limit, provider=provider)

        return {
            "code": 200,
            "message": "success",
            "data": records,
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/usage/export")
async def export_usage(
    format: str = Query(default="json", pattern="^(json|csv)$"),
    current_user: User = Depends(get_current_user)
) -> dict:
    """导出LLM使用数据。"""
    try:
        output_path = _tracker.export_usage(format=format)

        return {
            "code": 200,
            "message": "Usage data exported successfully",
            "data": {
                "path": output_path,
                "format": format,
            },
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/usage")
async def clear_usage(
    days_to_keep: int = Query(default=30, ge=1, le=365),
    current_user: User = Depends(get_current_user)
) -> dict:
    """清除旧的LLM使用记录。"""
    try:
        removed_count = _tracker.clear_old_records(days_to_keep=days_to_keep)

        return {
            "code": 200,
            "message": f"Removed {removed_count} old usage records",
            "data": {
                "removed_count": removed_count,
                "days_kept": days_to_keep,
            },
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
