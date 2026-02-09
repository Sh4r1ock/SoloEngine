# -*- coding: utf-8 -*-
"""Plugin interfaces for SoloEngine."""

from abc import ABC, abstractmethod
from typing import Optional, List

from ..message import Msg
from ..types import JSONSerializableObject


class IMemory(ABC):
    """Interface for memory plugins."""
    
    @abstractmethod
    async def add(self, msg: Msg) -> None:
        """Add a message to memory."""
        pass
    
    @abstractmethod
    async def retrieve(
        self, 
        query: str, 
        limit: int = 5
    ) -> List[Msg]:
        """Retrieve relevant messages from memory."""
        pass
    
    @abstractmethod
    async def clear(self) -> None:
        """Clear the memory."""
        pass
    
    @abstractmethod
    async def get_memory_state(self) -> dict:
        """Get the current memory state."""
        pass
    
    @abstractmethod
    async def set_memory_state(self, state: dict) -> None:
        """Set the memory state."""
        pass


class IRAG(ABC):
    """Interface for RAG plugins."""
    
    @abstractmethod
    async def retrieve(
        self, 
        query: str, 
        limit: int = 5
    ) -> List[dict]:
        """Retrieve relevant documents from knowledge base.
        
        Returns:
            List of documents, each document is a dict with at least
            'content' and 'metadata' fields.
        """
        pass
    
    @abstractmethod
    async def add_document(
        self,
        content: str,
        metadata: Optional[dict[str, JSONSerializableObject]] = None
    ) -> str:
        """Add a document to the knowledge base.
        
        Returns:
            Document ID.
        """
        pass
    
    @abstractmethod
    async def clear(self) -> None:
        """Clear the knowledge base."""
        pass


class IToolExecutor(ABC):
    """Interface for tool execution plugins."""
    
    @abstractmethod
    async def execute(
        self, 
        tool_call: dict,
        **kwargs
    ) -> dict:
        """Execute a tool call.
        
        Args:
            tool_call: Tool call specification with 'name', 'arguments', etc.
            **kwargs: Additional execution context.
            
        Returns:
            Tool result.
        """
        pass
    
    @abstractmethod
    def get_available_tools(self) -> List[dict]:
        """Get list of available tools.
        
        Returns:
            List of tool specifications.
        """
        pass
    
    @abstractmethod
    async def register_tool(self, tool_spec: dict) -> None:
        """Register a new tool."""
        pass


class IMCPClient(ABC):
    """Interface for MCP client plugins."""
    
    @abstractmethod
    async def connect(self) -> None:
        """Connect to the MCP server."""
        pass
    
    @abstractmethod
    async def disconnect(self) -> None:
        """Disconnect from the MCP server."""
        pass
    
    @abstractmethod
    async def get_tools(self) -> List[dict]:
        """Get tools from the MCP server."""
        pass
    
    @abstractmethod
    async def call_tool(
        self,
        tool_name: str,
        arguments: dict
    ) -> dict:
        """Call a tool on the MCP server."""
        pass


class IPlanNotebook(ABC):
    """Interface for plan notebook plugins."""
    
    @abstractmethod
    async def create_plan(
        self,
        goal: str,
        **kwargs
    ) -> dict:
        """Create a new plan."""
        pass
    
    @abstractmethod
    async def update_plan(
        self,
        plan_id: str,
        updates: dict
    ) -> None:
        """Update an existing plan."""
        pass
    
    @abstractmethod
    async def get_plan(self, plan_id: str) -> Optional[dict]:
        """Get a plan by ID."""
        pass
    
    @abstractmethod
    async def delete_plan(self, plan_id: str) -> None:
        """Delete a plan."""
        pass


class ITTSModel(ABC):
    """Interface for TTS model plugins."""
    
    @abstractmethod
    async def synthesize(
        self,
        text: str,
        **kwargs
    ) -> bytes:
        """Synthesize speech from text.
        
        Returns:
            Audio data in bytes.
        """
        pass


__all__ = [
    "IMemory",
    "IRAG",
    "IToolExecutor",
    "IMCPClient",
    "IPlanNotebook",
    "ITTSModel",
]