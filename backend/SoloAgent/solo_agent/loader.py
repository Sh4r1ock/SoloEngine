"""
SoloAgent机制-loader.py: 配置加载器，从数据库/文件加载详细配置

@file loader.py
@description 实现配置加载器，支持从数据库和文件加载各类配置
@author Sh4rlock
@date 2026-04-09

功能描述：
本模块实现SoloAgent机制的配置加载器，提供以下功能：
- 从数据库或文件加载LLM、Skill、MCP、Tool等详细配置
- 支持配置优先级：直接传入参数 > 数据库用户配置 > 默认配置
- 提供异步加载方法
- 缓存已加载的配置以提高性能

依赖:
- os: 操作系统接口
- json: JSON数据处理
- logging: 日志记录
- re: 正则表达式
- sys: 系统路径操作
- typing: 类型提示
- app.core.data_paths: 数据路径管理

使用示例:
- config = await ConfigLoader.load_llm_config("openai", "gpt-4")
- config = await ConfigLoader.load_skill_config("my_skill")
"""
import os
import json
import logging
import re
import sys
from typing import Optional, Dict, Any

logger = logging.getLogger(__name__)

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', 'app')))
from app.core.data_paths import DataPaths


class ConfigLoader:
    """
    配置加载器类
    
    职责:
    - 从数据库/文件加载详细配置
    - 管理配置缓存以提高性能
    - 支持配置优先级处理
    
    属性:
        _llm_configs (Dict): LLM配置缓存
        _skill_configs (Dict): Skill配置缓存
        _mcp_configs (Dict): MCP配置缓存
    
    配置来源：
    - LLM配置：从LLMConfigModel表加载
    - Skill配置：从SkillsPackageModel表或data/system_skills目录加载
    - MCP配置：从配置文件或数据库加载
    - Tool配置：从工具定义加载
    """
    
    _llm_configs: Dict[str, Dict[str, Any]] = {}
    _skill_configs: Dict[str, Dict[str, Any]] = {}
    _mcp_configs: Dict[str, Dict[str, Any]] = {}
    
    @classmethod
    async def load_llm_config(
        cls,
        provider: str,
        model: str,
        user_id: Optional[str] = None,
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
        max_tokens: int = 2048,
        temperature: float = 0.7,
        top_p: float = 1.0,
        frequency_penalty: float = 0.0,
        presence_penalty: float = 0.0,
        timeout: int = 60,
    ) -> Dict[str, Any]:
        config = {
            "provider": provider,
            "model": model,
            "api_key": api_key,
            "base_url": base_url,
            "temperature": temperature,
            "max_tokens": max_tokens,
            "top_p": top_p,
            "frequency_penalty": frequency_penalty,
            "presence_penalty": presence_penalty,
            "timeout": timeout,
        }
        
        if api_key:
            if not base_url:
                default_configs = cls._get_default_llm_configs()
                if provider in default_configs:
                    config["base_url"] = default_configs[provider].get("base_url")
            return config
        
        cache_key = f"{provider}:{user_id or 'default'}"
        if cache_key in cls._llm_configs:
            cached = cls._llm_configs[cache_key]
            config.update(cached)
            return config
        
        try:
            from app.core.database import get_db, LLMConfigModel
            
            db = next(get_db())
            query = db.query(LLMConfigModel).filter(
                LLMConfigModel.provider == provider
            )
            
            if user_id:
                query = query.filter(LLMConfigModel.user_id == user_id)
            
            llm_config = query.first()
            
            if llm_config:
                if not config.get("api_key") and llm_config.api_key:
                    from app.core.database import encryption_service
                    config["api_key"] = encryption_service.decrypt(llm_config.api_key)
                if not config.get("base_url"):
                    config["base_url"] = llm_config.base_url
                if llm_config.timeout:
                    config["timeout"] = llm_config.timeout
                if llm_config.max_tokens:
                    config["max_tokens"] = llm_config.max_tokens
                if llm_config.temperature is not None:
                    config["temperature"] = llm_config.temperature
                if llm_config.top_p is not None:
                    config["top_p"] = llm_config.top_p
                if llm_config.frequency_penalty is not None:
                    config["frequency_penalty"] = llm_config.frequency_penalty
                if llm_config.presence_penalty is not None:
                    config["presence_penalty"] = llm_config.presence_penalty

                cls._llm_configs[cache_key] = {
                    "provider": provider,
                    "model": model,
                    "api_key": config.get("api_key"),
                    "base_url": config.get("base_url"),
                    "timeout": config.get("timeout"),
                    "max_tokens": config.get("max_tokens"),
                    "temperature": config.get("temperature"),
                    "top_p": config.get("top_p"),
                    "frequency_penalty": config.get("frequency_penalty"),
                    "presence_penalty": config.get("presence_penalty"),
                }
                
        except Exception as e:
            logger.warning(f"Failed to load LLM config from database: {e}")
        
        default_configs = cls._get_default_llm_configs()
        if provider in default_configs:
            default = default_configs[provider]
            if not config.get("api_key"):
                config["api_key"] = default.get("api_key")
            if not config.get("base_url"):
                config["base_url"] = default.get("base_url")
        
        return config
    
    @classmethod
    def _get_default_llm_configs(cls) -> Dict[str, Dict[str, Any]]:
        return {}
    
    @classmethod
    async def load_skill_config(cls, skill_name: str) -> Dict[str, Any]:
        """加载技能配置
        
        优先级：
        1. 系统技能目录 (data/system_skills) - 支持 SKILL.md 和 skill.json
        2. 数据库中的用户技能
        """
        if skill_name in cls._skill_configs:
            return cls._skill_configs[skill_name]
        
        config = {
            "name": skill_name,
            "system_prompt": "",
            "tools": [],
        }
        
        base_path = os.path.join(DataPaths.get_system_skills_dir(), skill_name)
        
        skill_json_path = os.path.join(base_path, "skill.json")
        skill_md_path = os.path.join(base_path, "SKILL.md")
        
        if os.path.exists(skill_json_path):
            try:
                with open(skill_json_path, "r", encoding="utf-8") as f:
                    skill_data = json.load(f)
                    config.update(skill_data)
                    logger.info(f"Loaded skill '{skill_name}' from skill.json")
            except Exception as e:
                logger.warning(f"Failed to load skill '{skill_name}' from skill.json: {e}")
        
        elif os.path.exists(skill_md_path):
            try:
                with open(skill_md_path, "r", encoding="utf-8") as f:
                    content = f.read()
                    parsed = cls._parse_skill_md(content)
                    config.update(parsed)
                    logger.info(f"Loaded skill '{skill_name}' from SKILL.md")
            except Exception as e:
                logger.warning(f"Failed to load skill '{skill_name}' from SKILL.md: {e}")
        
        try:
            from app.core.database import get_db, SkillsPackageModel
            
            db = next(get_db())
            skill = db.query(SkillsPackageModel).filter(
                SkillsPackageModel.name == skill_name
            ).first()
            
            if skill:
                config["name"] = skill.name
                config["system_prompt"] = skill.system_prompt or config.get("system_prompt", "")
                config["tools"] = skill.tools or config.get("tools", [])
                
        except Exception as e:
            logger.warning(f"Failed to load skill '{skill_name}' from database: {e}")
        
        cls._skill_configs[skill_name] = config
        return config
    
    @classmethod
    def _parse_skill_md(cls, content: str) -> Dict[str, Any]:
        """解析 SKILL.md 文件（YAML frontmatter 格式）"""
        config = {
            "name": "",
            "description": "",
            "system_prompt": "",
            "tools": [],
        }
        
        frontmatter_match = re.match(r'^---\s*\n(.*?)\n---\s*\n', content, re.DOTALL)
        if frontmatter_match:
            frontmatter = frontmatter_match.group(1)
            for line in frontmatter.split('\n'):
                if ':' in line:
                    key, value = line.split(':', 1)
                    key = key.strip()
                    value = value.strip()
                    if key == 'name':
                        config['name'] = value
                    elif key == 'description':
                        config['description'] = value
                        config['system_prompt'] = value
        
        return config
    
    @classmethod
    async def load_mcp_config(cls, server_name: str) -> Dict[str, Any]:
        """加载 MCP 服务器配置"""
        if server_name in cls._mcp_configs:
            return cls._mcp_configs[server_name]
        
        config = {
            "name": server_name,
            "command": "",
            "args": [],
            "env": {},
        }
        
        if not config.get("command"):
            server_main_path = os.path.join(
                DataPaths.get_system_mcp_servers_dir(), server_name, "main.py"
            )
            if os.path.exists(server_main_path):
                config["command"] = sys.executable
                config["args"] = [server_main_path]
                logger.info(f"Using default MCP server path for '{server_name}'")
        
        cls._mcp_configs[server_name] = config
        return config
    
    @classmethod
    async def load_tool_config(cls, tool_name: str) -> Dict[str, Any]:
        """加载工具配置"""
        from .tools import ToolRegistry
        return ToolRegistry.get_tool_spec(tool_name)
    
    @classmethod
    def clear_cache(cls) -> None:
        """清除配置缓存"""
        cls._llm_configs.clear()
        cls._skill_configs.clear()
        cls._mcp_configs.clear()
