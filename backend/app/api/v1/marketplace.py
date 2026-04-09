# -*- coding: utf-8 -*-
"""
SoloEngine : 开放市场API模块

@file marketplace.py
@description 开放市场接口 - MCP和Skills市场相关API端点
@author Sh4rlock
@date 2026-04-09

功能描述：
本模块提供以下核心功能：
    - 获取MCP市场列表
    - 获取Skills市场列表
    - 导入市场项目
    - 搜索市场内容
    - 缓存市场数据

依赖:
    - os: 操作系统接口
    - json: JSON处理
    - logging: 日志记录
    - typing: 类型注解支持
    - fastapi: FastAPI框架
    - pydantic: 数据验证
    - app.core.cache: 缓存服务

使用示例:
    - GET /api/v1/marketplace/mcp - 获取MCP市场列表
    - GET /api/v1/marketplace/skills - 获取Skills市场列表

使用场景：
    - MCP和Skills市场浏览
    - 第三方工具发现
"""

import os
import json
import logging
from typing import List, Optional, Dict, Any
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, Field
from app.core.cache import async_cached, global_cache
from app.api.v1.auth import get_current_user
from app.core.auth import User

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/marketplace", tags=["marketplace"])


MCP_MARKET_ITEMS = [
    {
        "id": "filesystem",
        "name": "Filesystem MCP",
        "description": "文件系统操作工具，支持读写文件、创建目录、列出文件等操作",
        "author": "ModelContextProtocol",
        "category": "file",
        "tags": ["file", "filesystem", "io"],
        "transport": "stdio",
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-filesystem"],
        "downloads": 15000,
        "rating": 4.8,
        "verified": True,
        "icon": "folder",
    },
    {
        "id": "github",
        "name": "GitHub MCP",
        "description": "GitHub仓库和Issue操作，支持创建Issue、PR、查看仓库信息等",
        "author": "ModelContextProtocol",
        "category": "dev",
        "tags": ["github", "git", "repository"],
        "transport": "stdio",
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-github"],
        "env_required": ["GITHUB_TOKEN"],
        "downloads": 12000,
        "rating": 4.7,
        "verified": True,
        "icon": "github",
    },
    {
        "id": "postgres",
        "name": "PostgreSQL MCP",
        "description": "PostgreSQL数据库操作，支持查询、插入、更新等数据库操作",
        "author": "ModelContextProtocol",
        "category": "database",
        "tags": ["postgres", "database", "sql"],
        "transport": "stdio",
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-postgres"],
        "env_required": ["DATABASE_URL"],
        "downloads": 8500,
        "rating": 4.6,
        "verified": True,
        "icon": "database",
    },
    {
        "id": "sqlite",
        "name": "SQLite MCP",
        "description": "SQLite数据库操作，轻量级本地数据库管理",
        "author": "ModelContextProtocol",
        "category": "database",
        "tags": ["sqlite", "database", "sql"],
        "transport": "stdio",
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-sqlite"],
        "downloads": 7200,
        "rating": 4.5,
        "verified": True,
        "icon": "database",
    },
    {
        "id": "brave-search",
        "name": "Brave Search MCP",
        "description": "Brave搜索引擎集成，支持网页搜索和结果获取",
        "author": "ModelContextProtocol",
        "category": "search",
        "tags": ["search", "web", "brave"],
        "transport": "stdio",
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-brave-search"],
        "env_required": ["BRAVE_API_KEY"],
        "downloads": 6800,
        "rating": 4.4,
        "verified": True,
        "icon": "search",
    },
    {
        "id": "puppeteer",
        "name": "Puppeteer MCP",
        "description": "浏览器自动化工具，支持网页截图、PDF生成、表单填写等",
        "author": "ModelContextProtocol",
        "category": "browser",
        "tags": ["browser", "automation", "puppeteer"],
        "transport": "stdio",
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-puppeteer"],
        "downloads": 5500,
        "rating": 4.3,
        "verified": True,
        "icon": "chrome",
    },
    {
        "id": "slack",
        "name": "Slack MCP",
        "description": "Slack集成，支持发送消息、读取频道内容等",
        "author": "ModelContextProtocol",
        "category": "communication",
        "tags": ["slack", "chat", "messaging"],
        "transport": "stdio",
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-slack"],
        "env_required": ["SLACK_BOT_TOKEN", "SLACK_TEAM_ID"],
        "downloads": 4200,
        "rating": 4.2,
        "verified": True,
        "icon": "slack",
    },
    {
        "id": "memory",
        "name": "Memory MCP",
        "description": "知识图谱记忆存储，支持实体关系存储和查询",
        "author": "ModelContextProtocol",
        "category": "ai",
        "tags": ["memory", "knowledge-graph", "ai"],
        "transport": "stdio",
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-memory"],
        "downloads": 3800,
        "rating": 4.1,
        "verified": True,
        "icon": "brain",
    },
    {
        "id": "google-drive",
        "name": "Google Drive MCP",
        "description": "Google Drive文件操作，支持上传、下载、列出文件等",
        "author": "Community",
        "category": "cloud",
        "tags": ["google", "drive", "cloud", "storage"],
        "transport": "stdio",
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-gdrive"],
        "env_required": ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
        "downloads": 3200,
        "rating": 4.0,
        "verified": False,
        "icon": "cloud",
    },
    {
        "id": "fetch",
        "name": "Fetch MCP",
        "description": "HTTP请求工具，支持GET、POST等HTTP方法",
        "author": "ModelContextProtocol",
        "category": "network",
        "tags": ["http", "fetch", "api"],
        "transport": "stdio",
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-fetch"],
        "downloads": 4500,
        "rating": 4.3,
        "verified": True,
        "icon": "global",
    },
]


SKILLS_MARKET_ITEMS = [
    {
        "id": "code-review",
        "name": "Code Review Skills",
        "description": "代码审查技能包，提供代码质量检查、最佳实践建议等功能",
        "author": "SoloEngine",
        "category": "development",
        "tags": ["code", "review", "quality"],
        "version": "1.2.0",
        "downloads": 8500,
        "rating": 4.7,
        "verified": True,
        "icon": "code",
        "skills_count": 5,
    },
    {
        "id": "data-analysis",
        "name": "Data Analysis Skills",
        "description": "数据分析技能包，支持数据清洗、统计分析、可视化等",
        "author": "SoloEngine",
        "category": "data",
        "tags": ["data", "analysis", "visualization"],
        "version": "2.0.1",
        "downloads": 6200,
        "rating": 4.6,
        "verified": True,
        "icon": "chart",
        "skills_count": 8,
    },
    {
        "id": "web-scraping",
        "name": "Web Scraping Skills",
        "description": "网页抓取技能包，支持网页解析、数据提取、自动化爬取等",
        "author": "Community",
        "category": "web",
        "tags": ["web", "scraping", "crawler"],
        "version": "1.5.0",
        "downloads": 5800,
        "rating": 4.5,
        "verified": True,
        "icon": "spider",
        "skills_count": 4,
    },
    {
        "id": "document-writing",
        "name": "Document Writing Skills",
        "description": "文档写作技能包，支持技术文档、API文档、用户手册等写作",
        "author": "SoloEngine",
        "category": "writing",
        "tags": ["document", "writing", "documentation"],
        "version": "1.3.0",
        "downloads": 4500,
        "rating": 4.4,
        "verified": True,
        "icon": "file-text",
        "skills_count": 6,
    },
    {
        "id": "api-testing",
        "name": "API Testing Skills",
        "description": "API测试技能包，支持REST API测试、接口验证、性能测试等",
        "author": "SoloEngine",
        "category": "testing",
        "tags": ["api", "testing", "rest"],
        "version": "1.1.0",
        "downloads": 3800,
        "rating": 4.3,
        "verified": True,
        "icon": "api",
        "skills_count": 7,
    },
    {
        "id": "database-operations",
        "name": "Database Operations Skills",
        "description": "数据库操作技能包，支持SQL生成、数据迁移、性能优化等",
        "author": "Community",
        "category": "database",
        "tags": ["database", "sql", "migration"],
        "version": "1.0.2",
        "downloads": 3200,
        "rating": 4.2,
        "verified": False,
        "icon": "database",
        "skills_count": 5,
    },
    {
        "id": "automation",
        "name": "Automation Skills",
        "description": "自动化技能包，支持任务自动化、工作流编排、定时任务等",
        "author": "SoloEngine",
        "category": "automation",
        "tags": ["automation", "workflow", "scheduler"],
        "version": "2.1.0",
        "downloads": 5500,
        "rating": 4.5,
        "verified": True,
        "icon": "cog",
        "skills_count": 9,
    },
    {
        "id": "security-analysis",
        "name": "Security Analysis Skills",
        "description": "安全分析技能包，支持代码安全审计、漏洞检测、安全建议等",
        "author": "SoloEngine",
        "category": "security",
        "tags": ["security", "audit", "vulnerability"],
        "version": "1.4.0",
        "downloads": 2800,
        "rating": 4.6,
        "verified": True,
        "icon": "shield",
        "skills_count": 6,
    },
]


MCP_CATEGORIES = [
    {"id": "all", "name": "全部", "icon": "appstore"},
    {"id": "file", "name": "文件系统", "icon": "folder"},
    {"id": "dev", "name": "开发工具", "icon": "code"},
    {"id": "database", "name": "数据库", "icon": "database"},
    {"id": "search", "name": "搜索", "icon": "search"},
    {"id": "browser", "name": "浏览器", "icon": "chrome"},
    {"id": "communication", "name": "通讯", "icon": "message"},
    {"id": "ai", "name": "AI相关", "icon": "robot"},
    {"id": "cloud", "name": "云服务", "icon": "cloud"},
    {"id": "network", "name": "网络", "icon": "global"},
]


SKILLS_CATEGORIES = [
    {"id": "all", "name": "全部", "icon": "appstore"},
    {"id": "development", "name": "开发", "icon": "code"},
    {"id": "data", "name": "数据", "icon": "chart"},
    {"id": "web", "name": "网页", "icon": "global"},
    {"id": "writing", "name": "写作", "icon": "edit"},
    {"id": "testing", "name": "测试", "icon": "test-tube"},
    {"id": "database", "name": "数据库", "icon": "database"},
    {"id": "automation", "name": "自动化", "icon": "cog"},
    {"id": "security", "name": "安全", "icon": "shield"},
]


class MarketSearchRequest(BaseModel):
    query: str = Field("", description="搜索关键词")
    category: Optional[str] = Field(None, description="分类过滤")
    tags: Optional[List[str]] = Field(None, description="标签过滤")
    sort_by: str = Field("downloads", description="排序字段: downloads, rating, name")


@router.get("/mcp")
async def get_mcp_market(
    category: Optional[str] = None,
    search: Optional[str] = None,
    sort_by: str = "downloads"
):
    """获取MCP市场列表。"""
    items = MCP_MARKET_ITEMS.copy()
    
    if category and category != "all":
        items = [item for item in items if item.get("category") == category]
    
    if search:
        search_lower = search.lower()
        items = [
            item for item in items
            if search_lower in item["name"].lower()
            or search_lower in item["description"].lower()
            or any(search_lower in tag.lower() for tag in item.get("tags", []))
        ]
    
    if sort_by == "downloads":
        items.sort(key=lambda x: x.get("downloads", 0), reverse=True)
    elif sort_by == "rating":
        items.sort(key=lambda x: x.get("rating", 0), reverse=True)
    elif sort_by == "name":
        items.sort(key=lambda x: x.get("name", "").lower())
    
    return {
        "code": 200,
        "message": "MCP market items retrieved",
        "data": {
            "items": items,
            "categories": MCP_CATEGORIES,
            "total": len(items),
        }
    }


@router.get("/mcp/{item_id}")
async def get_mcp_item(item_id: str):
    """获取MCP市场项目详情。"""
    item = next((item for item in MCP_MARKET_ITEMS if item["id"] == item_id), None)
    
    if not item:
        raise HTTPException(status_code=404, detail=f"MCP item '{item_id}' not found")
    
    return {
        "code": 200,
        "message": "MCP item retrieved",
        "data": item,
    }


@router.get("/skills")
async def get_skills_market(
    category: Optional[str] = None,
    search: Optional[str] = None,
    sort_by: str = "downloads"
):
    """获取Skills市场列表。"""
    items = SKILLS_MARKET_ITEMS.copy()
    
    if category and category != "all":
        items = [item for item in items if item.get("category") == category]
    
    if search:
        search_lower = search.lower()
        items = [
            item for item in items
            if search_lower in item["name"].lower()
            or search_lower in item["description"].lower()
            or any(search_lower in tag.lower() for tag in item.get("tags", []))
        ]
    
    if sort_by == "downloads":
        items.sort(key=lambda x: x.get("downloads", 0), reverse=True)
    elif sort_by == "rating":
        items.sort(key=lambda x: x.get("rating", 0), reverse=True)
    elif sort_by == "name":
        items.sort(key=lambda x: x.get("name", "").lower())
    
    return {
        "code": 200,
        "message": "Skills market items retrieved",
        "data": {
            "items": items,
            "categories": SKILLS_CATEGORIES,
            "total": len(items),
        }
    }


@router.get("/skills/{item_id}")
async def get_skills_item(item_id: str):
    """获取Skills市场项目详情。"""
    item = next((item for item in SKILLS_MARKET_ITEMS if item["id"] == item_id), None)
    
    if not item:
        raise HTTPException(status_code=404, detail=f"Skills item '{item_id}' not found")
    
    return {
        "code": 200,
        "message": "Skills item retrieved",
        "data": item,
    }


@router.post("/mcp/{item_id}/install")
async def install_mcp_item(item_id: str, current_user: User = Depends(get_current_user)):
    """安装MCP市场项目。"""
    item = next((item for item in MCP_MARKET_ITEMS if item["id"] == item_id), None)
    
    if not item:
        raise HTTPException(status_code=404, detail=f"MCP item '{item_id}' not found")
    
    return {
        "code": 200,
        "message": "MCP item installed successfully",
        "data": {
            "id": item_id,
            "name": item["name"],
            "installed": True,
        }
    }


@router.post("/skills/{item_id}/install")
async def install_skills_item(item_id: str, current_user: User = Depends(get_current_user)):
    """安装Skills市场项目。"""
    item = next((item for item in SKILLS_MARKET_ITEMS if item["id"] == item_id), None)
    
    if not item:
        raise HTTPException(status_code=404, detail=f"Skills item '{item_id}' not found")
    
    return {
        "code": 200,
        "message": "Skills item installed successfully",
        "data": {
            "id": item_id,
            "name": item["name"],
            "installed": True,
        }
    }


@router.get("/featured")
async def get_featured_items():
    """获取精选项目。"""
    featured_mcp = sorted(MCP_MARKET_ITEMS, key=lambda x: x.get("rating", 0), reverse=True)[:3]
    featured_skills = sorted(SKILLS_MARKET_ITEMS, key=lambda x: x.get("rating", 0), reverse=True)[:3]
    
    return {
        "code": 200,
        "message": "Featured items retrieved",
        "data": {
            "mcp": featured_mcp,
            "skills": featured_skills,
        }
    }


@router.get("/stats")
async def get_market_stats():
    """获取市场统计信息。"""
    return {
        "code": 200,
        "message": "Market stats retrieved",
        "data": {
            "mcp": {
                "total_items": len(MCP_MARKET_ITEMS),
                "total_downloads": sum(item.get("downloads", 0) for item in MCP_MARKET_ITEMS),
                "categories_count": len(MCP_CATEGORIES) - 1,
            },
            "skills": {
                "total_items": len(SKILLS_MARKET_ITEMS),
                "total_downloads": sum(item.get("downloads", 0) for item in SKILLS_MARKET_ITEMS),
                "categories_count": len(SKILLS_CATEGORIES) - 1,
            }
        }
    }


@router.get("/cache/stats")
async def get_cache_stats():
    """获取缓存统计信息。"""
    return {
        "code": 200,
        "message": "Cache stats retrieved",
        "data": global_cache.stats()
    }


@router.post("/cache/clear")
async def clear_cache():
    """清除缓存。"""
    global_cache.clear()
    return {
        "code": 200,
        "message": "Cache cleared",
        "data": None
    }
