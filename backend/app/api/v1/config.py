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

使用示例:
    - GET /api/v1/llm/providers - 获取提供商列表
    - POST /api/v1/llm/configs - 创建LLM配置

使用场景：
    - LLM模型配置管理
    - API密钥管理
"""
from typing import List, Optional
from collections import defaultdict
from zoneinfo import ZoneInfo

from fastapi import APIRouter, HTTPException, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.database import get_db, db_manager
from app.core.config import settings
from app.api.v1.auth import get_current_user
from app.core.auth import User
from app.utils.timezone_utils import format_iso

router = APIRouter(prefix="/api/v1/llm", tags=["llm"])


class ProviderConfig(BaseModel):
    """提供商配置。"""
    name: str
    display_name: str
    requires_api_key: bool
    default_model: str
    default_base_url: str = ""
    models: List[str] = []
    color: str = "#8c8c8c"


class LLMConfigCreate(BaseModel):
    """创建LLM配置请求。"""
    name: str = Field(..., description="配置名称")
    provider: str = Field(..., description="提供商")
    model_name: str = Field(..., description="模型名称")
    api_key: Optional[str] = Field(None, description="API密钥")
    base_url: Optional[str] = Field(None, description="自定义API地址")
    temperature: float = Field(0.7, ge=0, le=2, description="温度参数")
    max_tokens: int = Field(128000, ge=1, description="最大Token数")
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
    max_tokens: Optional[int] = Field(None, ge=1)
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
        config = LLMFactory.get_provider_config(provider)
        if not config:
            continue

        provider_configs.append(ProviderConfig(
            name=provider,
            display_name=config.get("name", provider),
            requires_api_key=config.get("requires_api_key", True),
            default_model=config.get("default_model", ""),
            default_base_url=config.get("default_base_url", ""),
            models=config.get("models", []),
            color=config.get("color", "#8c8c8c"),
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
                "has_api_key": bool(c.api_key),
                "created_at": format_iso(c.created_at),
                "updated_at": format_iso(c.updated_at),
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
                "has_api_key": bool(c.api_key),
                "created_at": format_iso(c.created_at),
                "updated_at": format_iso(c.updated_at),
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
            "has_api_key": bool(config.api_key),
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
            "has_api_key": bool(config.api_key),
            "version": config.version,
            "created_at": format_iso(config.created_at),
            "updated_at": format_iso(config.updated_at),
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
        import traceback
        traceback.print_exc()
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
    
    config = db_manager.update_llm_config(
            db, config_id, user_id, version=request.version, **update_data
        )
    
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
            client_kwargs={"base_url": request.base_url} if request.base_url else {},
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


def _build_usage_query(db: Session, user_id: str, start_date=None, end_date=None, model_name=None, provider=None):
    """共享：构建 usage 查询，返回过滤后的 query 对象或 None(无匹配配置)。"""
    from app.core.database import SessionMessageModel, LLMConfigModel
    
    query = db.query(SessionMessageModel).filter(
        SessionMessageModel.user_id == user_id,
        SessionMessageModel.role == "assistant",
        SessionMessageModel.total_tokens.isnot(None),
    )
    if start_date:
        start_dt = datetime.strptime(start_date, "%Y-%m-%d").replace(tzinfo=ZoneInfo(settings.DEFAULT_TIMEZONE))
        query = query.filter(SessionMessageModel.created_at >= start_dt)
    if end_date:
        end_dt = datetime.strptime(end_date, "%Y-%m-%d").replace(hour=23, minute=59, second=59, tzinfo=ZoneInfo(settings.DEFAULT_TIMEZONE))
        query = query.filter(SessionMessageModel.created_at <= end_dt)
    if model_name or provider:
        config_query = db.query(LLMConfigModel).filter(LLMConfigModel.user_id == user_id)
        if provider:
            config_query = config_query.filter(LLMConfigModel.provider == provider)
        if model_name:
            config_query = config_query.filter(LLMConfigModel.model_name == model_name)
        config_ids = {c.id for c in config_query.all()}
        if config_ids:
            query = query.filter(SessionMessageModel.llm_config_id.in_(config_ids))
        else:
            return None
    return query


def _build_model_lookup(db: Session, user_id: str) -> dict:
    """共享：构建 llm_config_id → (model_name, provider) 查找表。"""
    from app.core.database import LLMConfigModel
    configs = db.query(LLMConfigModel).filter(LLMConfigModel.user_id == user_id).all()
    return {c.id: (c.model_name, c.provider) for c in configs}


def _build_usage_record(msg, idx: int, model_lookup: dict) -> dict:
    """共享：根据消息和模型查找表构建单条导出记录。"""
    record = {
        "num": idx,
        "timestamp": format_iso(msg.created_at),
        "input_tokens": msg.prompt_tokens or 0,
        "output_tokens": msg.completion_tokens or 0,
        "total_tokens": msg.total_tokens or 0,
        "request_id": msg.id,
        "duration_ms": msg.duration_ms or 0,
    }
    if msg.llm_config_id and msg.llm_config_id in model_lookup:
        record["model_name"], record["provider"] = model_lookup[msg.llm_config_id]
    else:
        record["model_name"] = "unknown"
        record["provider"] = "unknown"
    return record


@router.get("/usage")
async def get_usage(
    start_date: str = Query(default=None, description="开始日期 YYYY-MM-DD"),
    end_date: str = Query(default=None, description="结束日期 YYYY-MM-DD"),
    provider: str = Query(default=None),
    model_name: str = Query(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
) -> dict:
    """获取按天聚合的LLM使用统计（后端无时间默认值，由前端传参控制）。"""
    try:
        user_id = current_user.id

        query = _build_usage_query(db, user_id, start_date=start_date, end_date=end_date,
                                   model_name=model_name, provider=provider)
        if query is None:
            return {"code": 200, "message": "success", "data": {"daily": [], "summary": {}, "date_range": {"start": None, "end": None}}}

        messages = query.order_by(None).all()

        daily_data = defaultdict(lambda: {"requests": 0, "tokens": 0, "total_duration_ms": 0, "requests_with_duration": 0})
        for msg in messages:
            day = msg.created_at.strftime("%Y-%m-%d") if msg.created_at else "unknown"
            daily_data[day]["requests"] += 1
            daily_data[day]["tokens"] += msg.total_tokens or 0
            if msg.duration_ms is not None:
                daily_data[day]["total_duration_ms"] += msg.duration_ms
                daily_data[day]["requests_with_duration"] += 1

        sorted_days = sorted(daily_data.keys())
        daily_stats = []
        for day in sorted_days:
            data = daily_data[day]
            daily_stats.append({
                "date": day,
                "requests": data["requests"],
                "tokens": data["tokens"],
                "avg_time": data["total_duration_ms"] / data["requests_with_duration"] / 1000 if data["requests_with_duration"] > 0 else 0,
            })

        total_requests = sum(d["requests"] for d in daily_stats)
        total_tokens = sum(d["tokens"] for d in daily_stats)
        total_duration_ms = sum(data["total_duration_ms"] for data in daily_data.values())
        total_requests_with_duration = sum(data["requests_with_duration"] for data in daily_data.values())

        return {
            "code": 200,
            "message": "success",
            "data": {
                "daily": daily_stats,
                "summary": {
                    "total_requests": total_requests,
                    "total_tokens": total_tokens,
                    "avg_tokens_per_request": total_tokens / total_requests if total_requests > 0 else 0,
                    "avg_time_per_request": total_duration_ms / total_requests_with_duration / 1000 if total_requests_with_duration > 0 else 0,
                },
                "date_range": {
                    "start": sorted_days[0] if sorted_days else None,
                    "end": sorted_days[-1] if sorted_days else None,
                },
            },
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/usage/export")
async def export_usage(
    fmt: str = Query(default="json", alias="format", pattern="^(json|csv)$"),
    model_name: str = Query(default=None),
    start_date: str = Query(default=None, description="开始日期 YYYY-MM-DD"),
    end_date: str = Query(default=None, description="结束日期 YYYY-MM-DD"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
) -> dict:
    """导出LLM使用数据，直接返回数据内容供前端下载。"""
    from app.core.database import SessionMessageModel

    try:
        user_id = current_user.id

        query = _build_usage_query(db, user_id, start_date=start_date, end_date=end_date, model_name=model_name)
        if query is None:
            if fmt == "csv":
                return {"code": 200, "message": "success", "data": "num,timestamp,provider,model_name,request_id,input_tokens,output_tokens,total_tokens,duration_ms"}
            return {"code": 200, "message": "success", "data": []}

        model_lookup = _build_model_lookup(db, user_id)
        messages = query.order_by(SessionMessageModel.created_at.desc()).all()

        records = [_build_usage_record(msg, idx, model_lookup) for idx, msg in enumerate(messages, start=1)]

        if fmt == "csv":
            import csv
            import io
            output = io.StringIO()
            writer = csv.writer(output)
            writer.writerow(["num", "timestamp", "provider", "model_name", "request_id", "input_tokens", "output_tokens", "total_tokens", "duration_ms"])
            for r in records:
                writer.writerow([r["num"], r["timestamp"], r["provider"], r["model_name"], r["request_id"], r["input_tokens"], r["output_tokens"], r["total_tokens"], r["duration_ms"]])
            csv_content = output.getvalue()
            output.close()
            return {"code": 200, "message": "success", "data": csv_content}
        else:
            return {"code": 200, "message": "success", "data": records}

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
