# -*- coding: utf-8 -*-
"""
OpenPreview工具模块 - 打开预览实现。

@file open_preview.py
@description OpenPreview工具 - 向用户展示预览URL
@author SoloEngine Team
@date 2026-03-02

功能描述：
- 向用户展示预览URL
- 支持command_id和preview_url参数
- 返回动作状态和预览详情

预览功能说明：
    预览功能用于展示Agent启动的服务：
    1. Agent启动本地开发服务器
    2. 调用OpenPreview工具展示URL
    3. 前端收到动作后打开预览窗口
    4. 用户可以查看运行结果

设计理念：
    OpenPreview工具用于通知前端打开预览：
    1. Agent启动服务后调用此工具
    2. 传递命令ID和预览URL
    3. 前端收到动作后展示预览
    4. 用户可以交互查看结果

使用场景：
    - Agent启动本地开发服务器
    - Agent启动Web应用预览
    - 展示运行中的服务

状态: ✅ 完整实现
"""

from typing import Dict, Any, Optional
import re
import logging

from .base import BaseOtherTool

logger = logging.getLogger(__name__)


class OpenPreviewTool(BaseOtherTool):
    """
    OpenPreview工具 - 向用户展示预览URL。
    
    用于在Agent启动服务后向用户展示预览URL。
    
    核心功能：
        1. 验证预览URL的有效性
        2. 关联命令ID用于状态追踪
        3. 生成打开预览的动作
    
    工作流程：
        1. Agent启动本地服务
        2. 调用OpenPreview工具
        3. 传递command_id和preview_url
        4. 前端收到动作，打开预览窗口
    
    Example:
        >>> preview_tool = OpenPreviewTool()
        >>> result = await preview_tool.execute(
        ...     command_id="cmd-123",
        ...     preview_url="http://localhost:3000"
        ... )
        >>> print(result["content"])
        预览已就绪：http://localhost:3000
    
    Note:
        - command_id用于关联启动服务的命令
        - preview_url必须是有效的URL
        - 返回的动作需要前端处理
    """
    
    def __init__(self) -> None:
        """初始化OpenPreview工具。"""
        super().__init__()
        self._last_command_id: Optional[str] = None
        self._last_preview_url: Optional[str] = None
    
    async def execute(
        self,
        command_id: str,
        preview_url: str,
        **kwargs
    ) -> Dict[str, Any]:
        """
        执行OpenPreview工具 - 生成打开预览动作。
        
        创建一个动作，通知前端打开预览URL。
        
        Args:
            command_id (str): 命令ID。
                用于关联启动服务的命令，便于状态追踪。
            preview_url (str): 预览URL。
                要展示给用户的预览地址，必须是有效的URL。
            **kwargs: 额外参数（忽略）。
        
        Returns:
            Dict[str, Any]: 执行结果，包含：
                - success (bool): 是否成功
                - content (str): 状态消息
                - action (dict): 前端需要执行的动作
                - metadata (dict): 预览相关元数据
        
        Raises:
            OtherToolError: 当参数无效时抛出。
        
        Example:
            >>> result = await preview_tool.execute(
            ...     command_id="cmd-123",
            ...     preview_url="http://localhost:3000"
            ... )
        """
        if not command_id:
            return self.create_error_response(
                message="command_id参数不能为空",
                error_code="INVALID_COMMAND_ID"
            )
        
        if not preview_url:
            return self.create_error_response(
                message="preview_url参数不能为空",
                error_code="INVALID_PREVIEW_URL"
            )
        
        if not self._is_valid_url(preview_url):
            return self.create_error_response(
                message=f"无效的预览URL: {preview_url}",
                error_code="INVALID_PREVIEW_URL",
                details={"url": preview_url}
            )
        
        self._last_command_id = command_id
        self._last_preview_url = preview_url
        
        action = self.create_action(
            action_type="open_preview",
            action_data={
                "command_id": command_id,
                "preview_url": preview_url
            },
            message=f"预览已就绪：{preview_url}",
            requires_confirmation=False
        )
        
        content = self._generate_preview_message(preview_url, command_id)
        
        return self.create_success_response(
            content=content,
            action=action,
            metadata={
                "command_id": command_id,
                "preview_url": preview_url,
                "resources_used": [preview_url]
            }
        )
    
    def _is_valid_url(self, url: str) -> bool:
        """
        验证URL是否有效。
        
        Args:
            url (str): 要验证的URL
        
        Returns:
            bool: 是否有效
        """
        url_pattern = re.compile(
            r'^https?://'
            r'(?:(?:[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?\.)+[A-Z]{2,6}\.?|'
            r'localhost|'
            r'\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})'
            r'(?::\d+)?'
            r'(?:/?|[/?]\S+)$',
            re.IGNORECASE
        )
        
        return bool(url_pattern.match(url))
    
    def _generate_preview_message(self, preview_url: str, command_id: str) -> str:
        """
        生成预览消息。
        
        Args:
            preview_url (str): 预览URL
            command_id (str): 命令ID
        
        Returns:
            str: 消息内容
        """
        message = f"""【预览已就绪】

预览地址：{preview_url}
命令ID：{command_id}

点击预览按钮或直接访问上述地址查看结果。"""
        return message
    
    def get_last_preview(self) -> Dict[str, Optional[str]]:
        """
        获取最近的预览信息。
        
        Returns:
            Dict[str, Optional[str]]: 包含command_id和preview_url的字典
        """
        return {
            "command_id": self._last_command_id,
            "preview_url": self._last_preview_url
        }
    
    def get_tool_spec(self) -> Dict[str, Any]:
        """
        获取OpenPreview工具规范。
        
        Returns:
            Dict[str, Any]: 工具规范，兼容OpenAI Function Calling格式。
        """
        return {
            "name": "OpenPreview",
            "description": (
                "向用户展示预览URL。"
                "在启动本地服务后调用此工具，展示预览地址给用户。"
                "需要提供command_id和preview_url参数。"
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "command_id": {
                        "type": "string",
                        "description": "命令ID，用于关联启动服务的命令",
                    },
                    "preview_url": {
                        "type": "string",
                        "description": "预览URL，要展示给用户的预览地址",
                    }
                },
                "required": ["command_id", "preview_url"]
            }
        }

