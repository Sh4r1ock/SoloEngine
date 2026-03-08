"""
配置加载器
从数据库/文件加载详细配置
"""
import os
import json
import logging
import re
from typing import Optional, Dict, Any, List

logger = logging.getLogger(__name__)


class ConfigLoader:
    """配置加载器
    
    从数据库/文件加载详细配置：
    - LLM 配置：从 LLMConfigModel 表加载
    - Skill 配置：从 SkillsPackageModel 表或 data/system_skills 目录加载
    - MCP 配置：从配置文件或数据库加载
    - Tool 配置：从工具定义加载
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
        max_tokens: int = 4096,
        temperature: float = 0.7,
    ) -> Dict[str, Any]:
        """加载 LLM 配置
        
        优先级：
        1. 直接传入的参数
        2. 数据库中的用户配置
        3. 默认配置
        """
        config = {
            "provider": provider,
            "model": model,
            "api_key": api_key,
            "base_url": base_url,
            "temperature": temperature,
            "max_tokens": max_tokens,
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
                if not api_key:
                    config["api_key"] = llm_config.api_key
                if not base_url:
                    config["base_url"] = llm_config.base_url
                config["temperature"] = llm_config.temperature or 0.7
                config["max_tokens"] = llm_config.max_tokens or 4096
                
                cls._llm_configs[cache_key] = config
                
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
        """获取默认 LLM 配置"""
        return {
            "openai": {
                "base_url": "https://api.openai.com/v1",
            },
            "anthropic": {
                "base_url": "https://api.anthropic.com",
            },
            "deepseek": {
                "base_url": "https://api.deepseek.com",
            },
            "qwen": {
                "base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1",
            },
            "zhipu": {
                "base_url": "https://open.bigmodel.cn/api/paas/v4",
            },
            "ollama": {
                "base_url": "http://localhost:11434",
            },
        }
    
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
            "instructions": "",
            "tools": [],
        }
        
        base_path = os.path.join(
            os.path.dirname(__file__),
            "..", "..", "..", "data", "system_skills",
            skill_name
        )
        
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
                    config["instructions"] = content
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
                config["instructions"] = skill.instructions or config.get("instructions", "")
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
        
        mcp_config_paths = [
            os.path.join(
                os.path.dirname(__file__),
                "..", "..", "..", "data", "mcp_config.json"
            ),
            os.path.join(
                os.path.dirname(__file__),
                "..", "..", "..", "..", "data", "mcp_config.json"
            ),
        ]
        
        for mcp_config_path in mcp_config_paths:
            if os.path.exists(mcp_config_path):
                try:
                    with open(mcp_config_path, "r", encoding="utf-8") as f:
                        mcp_data = json.load(f)
                        servers = mcp_data.get("mcpServers", {})
                        if server_name in servers:
                            server_config = servers[server_name]
                            config.update(server_config)
                            logger.info(f"Loaded MCP server '{server_name}' from {mcp_config_path}")
                            break
                except Exception as e:
                    logger.warning(f"Failed to load MCP config from {mcp_config_path}: {e}")
        
        if not config.get("command"):
            server_main_path = os.path.join(
                os.path.dirname(__file__),
                "..", "..", "..", "data", "mcp_servers", server_name, "main.py"
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
