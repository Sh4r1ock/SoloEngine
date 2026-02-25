# -*- coding: utf-8 -*-
"""
Client Factory - 根据服务器配置创建对应的客户端实例。
"""

import logging
from typing import Any

from .base import BaseClient
from .stdio_client import StdioClient
from .sse_client import SSEClient
from .http_client import HTTPClient

logger = logging.getLogger(__name__)


class ClientFactory:
    """客户端工厂，根据传输类型创建对应的客户端。"""
    
    @staticmethod
    def create_client(server_info: Any) -> BaseClient:
        """根据服务器配置创建客户端。
        
        Args:
            server_info: 服务器配置信息
            
        Returns:
            对应类型的客户端实例
            
        Raises:
            ValueError: 不支持的传输类型
        """
        transport = server_info.transport.lower()
        
        client_map = {
            "stdio": StdioClient,
            "sse": SSEClient,
            "http": HTTPClient,
        }
        
        client_class = client_map.get(transport)
        
        if not client_class:
            raise ValueError(f"Unsupported transport type: {transport}")
        
        logger.info(f"Creating {transport} client for server: {server_info.name}")
        return client_class(server_info)
    
    @staticmethod
    def get_supported_transports() -> list:
        """获取支持的传输类型列表。"""
        return ["stdio", "sse", "http"]
    
    @staticmethod
    def is_transport_supported(transport: str) -> bool:
        """检查传输类型是否支持。"""
        return transport.lower() in ClientFactory.get_supported_transports()
