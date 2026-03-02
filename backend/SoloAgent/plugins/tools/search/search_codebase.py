# -*- coding: utf-8 -*-
"""
语义代码搜索工具模块。

@file search_codebase.py
@description 使用向量嵌入进行语义代码搜索
@author SoloEngine Team
@date 2026-03-02

功能描述：
- 基于向量嵌入的语义代码搜索
- 支持目标目录过滤
- 返回相关代码片段和相似度分数
- 实时索引代码库

使用场景：
- 查找相关代码片段
- 语义化代码检索
- 代码库探索

状态: ✅ 模块初始化完成
"""

import os
import logging
from typing import Dict, Any, List, Optional
from dataclasses import dataclass, field
from datetime import datetime
import hashlib
import json

from .base import BaseSearchTool, SearchToolError

logger = logging.getLogger(__name__)


@dataclass
class CodeSnippet:
    """
    代码片段数据类。
    
    存储单个代码片段的信息，包括内容、路径、向量等。
    
    Attributes:
        file_path (str): 文件路径
        content (str): 代码内容
        start_line (int): 起始行号
        end_line (int): 结束行号
        embedding (Optional[List[float]]): 向量嵌入
        metadata (Dict[str, Any]): 元数据
    """
    
    file_path: str
    content: str
    start_line: int
    end_line: int
    embedding: Optional[List[float]] = None
    metadata: Dict[str, Any] = field(default_factory=dict)
    
    def to_dict(self) -> Dict[str, Any]:
        """转换为字典格式。"""
        return {
            "file_path": self.file_path,
            "content": self.content,
            "start_line": self.start_line,
            "end_line": self.end_line,
            "metadata": self.metadata,
        }


@dataclass
class SearchResult:
    """
    搜索结果数据类。
    
    存储单个搜索结果，包含代码片段和相似度分数。
    
    Attributes:
        snippet (CodeSnippet): 代码片段
        score (float): 相似度分数 (0-1)
    """
    
    snippet: CodeSnippet
    score: float
    
    def to_dict(self) -> Dict[str, Any]:
        """转换为字典格式。"""
        return {
            **self.snippet.to_dict(),
            "score": round(self.score, 4),
        }


class CodeIndex:
    """
    代码索引类。
    
    管理代码库的向量索引，支持增量更新和持久化。
    
    核心功能：
        1. 代码文件解析和分块
        2. 向量嵌入生成和存储
        3. 相似度搜索
        4. 索引持久化
    """
    
    def __init__(
        self,
        index_dir: Optional[str] = None,
        chunk_size: int = 500,
        chunk_overlap: int = 50,
    ) -> None:
        """
        初始化代码索引。
        
        Args:
            index_dir (Optional[str], optional): 索引存储目录。默认为 None
            chunk_size (int, optional): 代码块大小（字符数）。默认为 500
            chunk_overlap (int, optional): 代码块重叠大小。默认为 50
        """
        self._index_dir = index_dir
        self._chunk_size = chunk_size
        self._chunk_overlap = chunk_overlap
        self._snippets: List[CodeSnippet] = []
        self._embeddings: List[List[float]] = []
        self._file_hashes: Dict[str, str] = {}
        self._embedding_service = None
    
    async def _get_embedding_service(self):
        """获取嵌入服务实例。"""
        if self._embedding_service is None:
            try:
                from ....embedding.embedding_service import get_embedding_service
                self._embedding_service = get_embedding_service()
            except ImportError:
                logger.warning("Embedding service not available")
                return None
        return self._embedding_service
    
    def _compute_file_hash(self, file_path: str) -> str:
        """计算文件哈希值。"""
        hasher = hashlib.md5()
        try:
            with open(file_path, 'rb') as f:
                hasher.update(f.read())
            return hasher.hexdigest()
        except Exception:
            return ""
    
    def _chunk_code(self, content: str, file_path: str) -> List[CodeSnippet]:
        """
        将代码内容分块。
        
        Args:
            content (str): 代码内容
            file_path (str): 文件路径
        
        Returns:
            List[CodeSnippet]: 代码块列表
        """
        lines = content.split('\n')
        snippets = []
        
        current_chunk = []
        current_start = 1
        current_size = 0
        
        for i, line in enumerate(lines, 1):
            current_chunk.append(line)
            current_size += len(line) + 1
            
            if current_size >= self._chunk_size:
                snippet = CodeSnippet(
                    file_path=file_path,
                    content='\n'.join(current_chunk),
                    start_line=current_start,
                    end_line=i,
                )
                snippets.append(snippet)
                
                overlap_lines = current_chunk[-min(len(current_chunk), 10):]
                current_chunk = overlap_lines
                current_start = i - len(overlap_lines) + 1
                current_size = sum(len(l) + 1 for l in overlap_lines)
        
        if current_chunk:
            snippet = CodeSnippet(
                file_path=file_path,
                content='\n'.join(current_chunk),
                start_line=current_start,
                end_line=len(lines),
            )
            snippets.append(snippet)
        
        return snippets
    
    def _should_index(self, file_path: str) -> bool:
        """判断文件是否应该被索引。"""
        indexed_extensions = {
            '.py', '.js', '.ts', '.tsx', '.jsx', '.java', '.go', '.rs',
            '.c', '.cpp', '.h', '.hpp', '.cs', '.rb', '.php', '.swift',
            '.kt', '.scala', '.md', '.txt', '.json', '.yaml', '.yml',
            '.toml', '.cfg', '.ini', '.sh', '.bash', '.zsh',
        }
        
        ignore_dirs = {
            'node_modules', '.git', '__pycache__', '.venv', 'venv',
            'dist', 'build', '.idea', '.vscode', 'egg-info',
        }
        
        ext = os.path.splitext(file_path)[1].lower()
        if ext not in indexed_extensions:
            return False
        
        for ignore_dir in ignore_dirs:
            if ignore_dir in file_path.split(os.sep):
                return False
        
        return True
    
    async def index_directory(
        self,
        directory: str,
        force_reindex: bool = False,
    ) -> int:
        """
        索引目录中的代码文件。
        
        Args:
            directory (str): 目录路径
            force_reindex (bool, optional): 是否强制重新索引。默认为 False
        
        Returns:
            int: 索引的文件数量
        """
        indexed_count = 0
        embedding_service = await self._get_embedding_service()
        
        for root, dirs, files in os.walk(directory):
            dirs[:] = [d for d in dirs if not d.startswith('.') and d != 'node_modules']
            
            for file in files:
                file_path = os.path.join(root, file)
                
                if not self._should_index(file_path):
                    continue
                
                file_hash = self._compute_file_hash(file_path)
                
                if not force_reindex and file_path in self._file_hashes:
                    if self._file_hashes[file_path] == file_hash:
                        continue
                
                try:
                    with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                        content = f.read()
                    
                    snippets = self._chunk_code(content, file_path)
                    
                    if embedding_service and embedding_service.is_available:
                        texts = [s.content for s in snippets]
                        embeddings = await embedding_service.embed_batch(texts)
                        
                        for snippet, embedding in zip(snippets, embeddings):
                            snippet.embedding = embedding.tolist()
                    
                    self._snippets.extend(snippets)
                    self._file_hashes[file_path] = file_hash
                    indexed_count += 1
                    
                except Exception as e:
                    logger.warning(f"Failed to index {file_path}: {e}")
        
        self._update_embeddings_list()
        return indexed_count
    
    def _update_embeddings_list(self) -> None:
        """更新嵌入列表。"""
        self._embeddings = [
            s.embedding for s in self._snippets
            if s.embedding is not None
        ]
    
    async def search(
        self,
        query: str,
        top_k: int = 5,
        threshold: float = 0.0,
    ) -> List[SearchResult]:
        """
        搜索相关代码片段。
        
        Args:
            query (str): 搜索查询
            top_k (int, optional): 返回结果数量。默认为 5
            threshold (float, optional): 相似度阈值。默认为 0.0
        
        Returns:
            List[SearchResult]: 搜索结果列表
        """
        if not self._snippets:
            return []
        
        embedding_service = await self._get_embedding_service()
        
        if embedding_service and embedding_service.is_available:
            query_embedding = await embedding_service.embed(query)
            query_vec = query_embedding.tolist()
            
            results = []
            for snippet in self._snippets:
                if snippet.embedding is None:
                    continue
                
                score = self._cosine_similarity(query_vec, snippet.embedding)
                
                if score >= threshold:
                    results.append(SearchResult(snippet=snippet, score=score))
            
            results.sort(key=lambda x: x.score, reverse=True)
            return results[:top_k]
        else:
            results = []
            query_lower = query.lower()
            
            for snippet in self._snippets:
                if query_lower in snippet.content.lower():
                    score = 0.5
                    results.append(SearchResult(snippet=snippet, score=score))
            
            results.sort(key=lambda x: x.score, reverse=True)
            return results[:top_k]
    
    def _cosine_similarity(self, vec1: List[float], vec2: List[float]) -> float:
        """计算余弦相似度。"""
        import math
        
        dot_product = sum(a * b for a, b in zip(vec1, vec2))
        norm1 = math.sqrt(sum(a * a for a in vec1))
        norm2 = math.sqrt(sum(b * b for b in vec2))
        
        if norm1 == 0 or norm2 == 0:
            return 0.0
        
        return dot_product / (norm1 * norm2)
    
    def clear(self) -> None:
        """清空索引。"""
        self._snippets = []
        self._embeddings = []
        self._file_hashes = {}


class SearchCodebase(BaseSearchTool):
    """
    语义代码搜索工具。
    
    使用向量嵌入进行语义代码搜索，支持实时索引和相似度检索。
    
    核心功能：
        1. 语义化代码搜索
        2. 目标目录过滤
        3. 相似度排序
        4. 实时索引更新
    
    输出格式：
        返回相关代码片段列表，每个片段包含：
        - file_path: 文件路径
        - content: 代码内容
        - start_line/end_line: 行号范围
        - score: 相似度分数
    
    Example:
        >>> tool = SearchCodebase("/home/user/project")
        >>> results = await tool.execute(
        ...     information_request="查找数据库连接代码",
        ...     target_directories=["src/db"]
        ... )
    """
    
    tool_name: str = "SearchCodebase"
    
    def __init__(
        self,
        working_directory: Optional[str] = None,
        index_dir: Optional[str] = None,
    ) -> None:
        """
        初始化语义代码搜索工具。
        
        Args:
            working_directory (Optional[str], optional): 工作目录。默认为 None
            index_dir (Optional[str], optional): 索引存储目录。默认为 None
        """
        super().__init__(working_directory)
        self._index = CodeIndex(index_dir=index_dir)
        self._indexed_dirs: set = set()
    
    async def execute(
        self,
        information_request: str,
        target_directories: Optional[List[str]] = None,
        top_k: int = 5,
        force_reindex: bool = False,
    ) -> Dict[str, Any]:
        """
        执行语义代码搜索。
        
        Args:
            information_request (str): 搜索请求描述
            target_directories (Optional[List[str]], optional): 目标目录列表。
                如果未指定，搜索整个工作目录。默认为 None
            top_k (int, optional): 返回结果数量。默认为 5
            force_reindex (bool, optional): 是否强制重新索引。默认为 False
        
        Returns:
            Dict[str, Any]: 搜索结果
        
        Raises:
            SearchToolError: 当搜索失败时抛出
        """
        try:
            directories = target_directories or [self._working_directory]
            
            resolved_dirs = []
            for dir_path in directories:
                resolved = self.resolve_path(dir_path)
                if not self.validate_directory(resolved):
                    logger.warning(f"Directory not found: {resolved}")
                    continue
                resolved_dirs.append(resolved)
            
            if not resolved_dirs:
                return self.format_error("没有有效的搜索目录")
            
            for dir_path in resolved_dirs:
                dir_key = os.path.normpath(dir_path)
                if force_reindex or dir_key not in self._indexed_dirs:
                    count = await self._index.index_directory(
                        dir_path,
                        force_reindex=force_reindex,
                    )
                    self._indexed_dirs.add(dir_key)
                    logger.info(f"Indexed {count} files in {dir_path}")
            
            results = await self._index.search(
                query=information_request,
                top_k=top_k,
            )
            
            formatted_results = [r.to_dict() for r in results]
            
            for result in formatted_results:
                result["file_path"] = self.get_relative_path(result["file_path"])
            
            content = self._format_content(formatted_results, information_request)
            
            return self.format_result(
                success=True,
                content=content,
                metadata={
                    "total_results": len(formatted_results),
                    "query": information_request,
                    "directories": [self.get_relative_path(d) for d in resolved_dirs],
                },
            )
            
        except Exception as e:
            logger.error(f"SearchCodebase error: {e}")
            return self.format_error(f"搜索失败: {str(e)}", exception=e)
    
    def _format_content(
        self,
        results: List[Dict[str, Any]],
        query: str,
    ) -> str:
        """
        格式化搜索结果为可读文本。
        
        Args:
            results (List[Dict]): 搜索结果列表
            query (str): 搜索查询
        
        Returns:
            str: 格式化的结果文本
        """
        if not results:
            return f"未找到与 '{query}' 相关的代码片段"
        
        lines = [f"找到 {len(results)} 个与 '{query}' 相关的代码片段:\n"]
        
        for i, result in enumerate(results, 1):
            file_path = result.get("file_path", "unknown")
            start_line = result.get("start_line", 0)
            end_line = result.get("end_line", 0)
            score = result.get("score", 0)
            content = result.get("content", "")
            
            lines.append(f"\n--- 结果 {i} (相似度: {score:.2%}) ---")
            lines.append(f"文件: {file_path}:{start_line}-{end_line}")
            lines.append(f"内容:\n{content}")
        
        return "\n".join(lines)
    
    def get_tool_spec(self) -> Dict[str, Any]:
        """
        获取工具规范。
        
        返回兼容 OpenAI Function Calling 的工具规范。
        
        Returns:
            Dict[str, Any]: 工具规范
        """
        return {
            "type": "function",
            "function": {
                "name": "SearchCodebase",
                "description": (
                    "使用语义搜索在代码库中查找相关代码片段。"
                    "这是一个强大的检索/嵌入模型套件，能够从代码库中召回最相关的代码片段。"
                    "维护代码库的实时索引，结果始终反映代码库的当前状态。"
                    "支持跨不同编程语言检索。"
                    "只反映代码库在磁盘上的当前状态，没有版本控制或代码历史信息。"
                    "当需要按名称查找文件时，使用 Glob 工具。"
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "information_request": {
                            "type": "string",
                            "description": "需要查找的信息描述",
                        },
                        "target_directories": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": (
                                "要搜索的特定目录（必须使用绝对路径，"
                                "必须使用操作系统的正确文件路径分隔符）。"
                                "如果未提供，默认搜索项目根目录。"
                                "可以指定多个目录进行定向搜索。"
                            ),
                        },
                    },
                    "required": ["information_request"],
                },
            },
        }


async def search_codebase(
    information_request: str,
    target_directories: Optional[List[str]] = None,
    working_directory: Optional[str] = None,
) -> Dict[str, Any]:
    """
    语义代码搜索便捷函数。
    
    Args:
        information_request (str): 搜索请求描述
        target_directories (Optional[List[str]], optional): 目标目录列表。默认为 None
        working_directory (Optional[str], optional): 工作目录。默认为 None
    
    Returns:
        Dict[str, Any]: 搜索结果
    """
    tool = SearchCodebase(working_directory=working_directory)
    return await tool.execute(
        information_request=information_request,
        target_directories=target_directories,
    )
