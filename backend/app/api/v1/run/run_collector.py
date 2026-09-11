# -*- coding: utf-8 -*-
import asyncio
import json
import logging
import os
import time
from typing import Dict, List, Optional, Any, Set
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

logger = logging.getLogger("SoloEngine")


class ChunkCollector:
    """收集流式chunk并合并，按执行实例（message_id）独立收集（〇·2 + 〇·3 第 3 层）。

    根本重构：删除全局单一块 + 状态栈，块永远按 message_id 归位——
    agent 切换只更新 _current_message_id，无 push/pop；同一 agent 并发 N 实例 =
    N 个独立 message_id，块/pending/保存天然隔离（B9/B10 语义保持）。
    """

    def __init__(self):
        self._chunks = []
        self._agent_data = {}
        # per-execution：收集键为 message_id（每次 _execute_agent 调用唯一）
        self._current_message_id = None
        self._current_agent_name = None
        self._current_blocks = {}  # message_id -> 当前累积中的块
        self._pending_tool_calls = {}  # message_id -> pending tool_calls

    def add_chunk(self, delta: dict, agent_id: str = None, agent_name: str = None, message_id: str = None):
        """添加chunk，按 message_id 独立收集（agent 切换只更新当前执行标识，无状态栈）。"""
        # 实时 token 更新事件：非消息块（无 content/reasoning/tool_calls），
        # 仅转发前端用于流式 token 实时显示，不进入 collector 状态机
        #（必须在 agent switch 逻辑之前返回，否则 token 事件会触发执行标识切换污染状态）。
        if isinstance(delta, dict) and delta.get("type") == "agent_token_usage":
            return
        if agent_id and message_id:
            if self._current_message_id is None or message_id != self._current_message_id:
                self._current_message_id = message_id
                self._current_agent_name = agent_name
        
        if self._current_message_id and self._current_message_id not in self._agent_data:
            self._agent_data[self._current_message_id] = {
                'agent_name': self._current_agent_name,
                'data': []
            }
        
        chunk_type = self._normalize_type(delta)
        content = self._extract_content(delta, chunk_type)

        if chunk_type != 'tool_calls' and not content:
            return
        if chunk_type == 'tool_calls' and not content:
            return
        
        if chunk_type == 'tool_calls':
            self._process_tool_calls(content)
        else:
            current_block = self._current_blocks.get(self._current_message_id, {})
            if current_block and current_block.get('type') == chunk_type:
                current_block[chunk_type] = (current_block.get(chunk_type, "") or "") + content
            else:
                if current_block:
                    self._agent_data[self._current_message_id]['data'].append(current_block)
                    current_block['_added_to_agent_data'] = True
                new_block = {chunk_type: content, 'type': chunk_type}
                # 统一修复：压缩轮块的 _is_compaction 标记随数据自洽入库
                # （此前新建块丢弃该标记，回显靠 status='compacted' 事后补标——隐式依赖）。
                if delta.get('_is_compaction'):
                    new_block['_is_compaction'] = True
                self._current_blocks[self._current_message_id] = new_block
        
        self._chunks.append({'delta': delta, 'agent_id': agent_id, 'agent_name': agent_name})
    
    def remove_agent_data(self, message_id: str):
        """移除指定执行实例（message_id）的已保存数据（保留原始 _chunks 记录）。

        B10 语义保持（subagent resume 长内容丢失修复）：不再清空 _current_message_id。
        保存路径（get_agent_data 恒一模式）本身已 flush 并清空 current_block；
        此处移除已保存的 agent_data + 追加清理 _current_blocks[message_id]
        （resume 新块 add_chunk 自动重建，B10 语义保持）。
        """
        if message_id in self._agent_data:
            del self._agent_data[message_id]
        if self._pending_tool_calls and message_id in self._pending_tool_calls:
            del self._pending_tool_calls[message_id]
        if message_id in self._current_blocks:
            del self._current_blocks[message_id]
    
    def _process_tool_calls(self, tool_calls: list):
        """处理tool_calls，合并调用和result（按 message_id 独立收集，〇·3）。"""
        message_id = self._current_message_id
        if message_id not in self._pending_tool_calls:
            self._pending_tool_calls[message_id] = {}

        if 'index_to_id' not in self._pending_tool_calls[message_id]:
            self._pending_tool_calls[message_id]['index_to_id'] = {}

        for new_tc in tool_calls:
            tool_id = new_tc.get('id')
            tool_index = new_tc.get('index')
            has_result = 'result' in new_tc or 'error' in new_tc

            if tool_id and tool_index is not None:
                self._pending_tool_calls[message_id]['index_to_id'][tool_index] = tool_id

            if not tool_id and tool_index is not None:
                tool_id = self._pending_tool_calls[message_id]['index_to_id'].get(tool_index)

            if tool_id and tool_id in self._pending_tool_calls[message_id]:
                import copy
                existing_tc = self._pending_tool_calls[message_id][tool_id]
                for key, value in new_tc.items():
                    if key == 'function' and isinstance(value, dict):
                        if 'function' not in existing_tc:
                            existing_tc['function'] = {}
                        for func_key, func_value in value.items():
                            if func_key == 'arguments':
                                existing_tc['function']['arguments'] = existing_tc['function'].get('arguments', '') + func_value
                            else:
                                if func_key not in existing_tc['function']:
                                    existing_tc['function'][func_key] = func_value
                    elif key in ['result', 'error', 'status']:
                        existing_tc[key] = copy.deepcopy(value)
                    elif key not in existing_tc or existing_tc.get(key) is None:
                        existing_tc[key] = copy.deepcopy(value) if isinstance(value, (dict, list)) else value

                if has_result:
                    current_block = self._current_blocks.get(message_id, {})
                    if current_block and current_block.get('type') == 'tool_calls':
                        current_block['tool_calls'].append(existing_tc)
                    else:
                        if current_block:
                            self._agent_data[message_id]['data'].append(current_block)
                        self._current_blocks[message_id] = {'type': 'tool_calls', 'tool_calls': [existing_tc]}
                    del self._pending_tool_calls[message_id][tool_id]
            elif tool_id and not has_result:
                import copy
                self._pending_tool_calls[message_id][tool_id] = copy.deepcopy(new_tc)
            elif tool_id:
                import copy
                # B9 修复：同一 tool_call 的 result delta 重复到达（如 subagent 完成时 Task result
                # 被二次转发）时，若该 tool_id 已固化在当前 tool_calls 块中，仅更新 result/error 字段，
                # 不重复 append——防止数据库出现重复的相同 Task tool_call 块（回显出现空白 Task 徽标）。
                current_block = self._current_blocks.get(message_id, {})
                if has_result and current_block and current_block.get('type') == 'tool_calls':
                    existing_ids = [tc.get('id') for tc in current_block['tool_calls']]
                    if tool_id in existing_ids:
                        for tc in current_block['tool_calls']:
                            if tc.get('id') == tool_id:
                                if 'result' in new_tc:
                                    tc['result'] = copy.deepcopy(new_tc['result'])
                                if 'error' in new_tc:
                                    tc['error'] = copy.deepcopy(new_tc['error'])
                                break
                        self._pending_tool_calls[message_id].pop(tool_id, None)
                        continue
                self._pending_tool_calls[message_id][tool_id] = copy.deepcopy(new_tc)
                if has_result:
                    if current_block and current_block.get('type') == 'tool_calls':
                        current_block['tool_calls'].append(self._pending_tool_calls[message_id][tool_id])
                    else:
                        if current_block:
                            self._agent_data[message_id]['data'].append(current_block)
                        self._current_blocks[message_id] = {'type': 'tool_calls', 'tool_calls': [self._pending_tool_calls[message_id][tool_id]]}
                    del self._pending_tool_calls[message_id][tool_id]
            else:
                import copy
                copied_tc = copy.deepcopy(new_tc)
                current_block = self._current_blocks.get(message_id, {})
                if current_block and current_block.get('type') == 'tool_calls':
                    current_block['tool_calls'].append(copied_tc)
                else:
                    if current_block:
                        self._agent_data[message_id]['data'].append(current_block)
                    self._current_blocks[message_id] = {'type': 'tool_calls', 'tool_calls': [copied_tc]}
    
    def _normalize_type(self, delta: dict) -> str:
        if isinstance(delta, str):
            return 'content'
        raw_type = delta.get("type", None)
        if raw_type in ('thinking', 'think', 'reason', 'reasoning_content'):
            return 'reasoning_content'
        if raw_type in ('tool_call', 'tool_calls') or 'tool_calls' in delta:
            return 'tool_calls'
        if 'reasoning_content' in delta and delta.get('reasoning_content'):
            return 'reasoning_content'
        if 'content' in delta:
            return 'content'
        return 'content'

    def _extract_content(self, delta: dict, chunk_type: str):
        if isinstance(delta, str):
            return delta
        if chunk_type == 'reasoning_content':
            val = delta.get('reasoning_content') or delta.get('thinking')
            return val if val is not None else ''
        elif chunk_type == 'tool_calls':
            return delta.get('tool_calls', [])
        else:
            val = delta.get('content')
            return val if val is not None else ''
    
    def get_agent_data(self, message_id: str = None) -> dict:
        """收集指定执行实例（message_id）的数据（恒一模式，〇·2 + 〇·3 第 3 层）。

        与现状（agent_id=None 全量 pop 栈 + agent_id=X 中间保存）的根本区别：
        不再有全量/中间两种模式——per-execution 后每次保存只收自己 message_id 的
        数据（flush 该 key 的 current_block + 该 key 的 pending tool_calls），
        不触碰其他 message_id 的状态（并发实例保存互不污染，B9 语义保持）。
        无效 arguments 校验（原全量模式 L1837-1851）移植到本方法。
        """
        if message_id is None:
            # 无执行实例的保存路径（如 CancelledError 兜底空记录）：不收集任何块
            return {}

        # flush 该 message_id 的 current_block
        if message_id in self._current_blocks and self._current_blocks[message_id] and \
                not self._current_blocks[message_id].get('_added_to_agent_data'):
            if message_id not in self._agent_data:
                self._agent_data[message_id] = {'agent_name': self._current_agent_name, 'data': []}
            self._agent_data[message_id]['data'].append(self._current_blocks[message_id])
            self._current_blocks[message_id]['_added_to_agent_data'] = True
            self._current_blocks[message_id] = {}

        # flush 该 message_id 的 pending tool_calls（带无效 arguments 校验）
        pending = self._pending_tool_calls.get(message_id, {})
        if pending:
            if message_id not in self._agent_data:
                self._agent_data[message_id] = {'agent_name': None, 'data': []}

            existing_tool_ids = set()
            for block in self._agent_data[message_id]['data']:
                if block.get('type') == 'tool_calls':
                    for tc in block.get('tool_calls', []):
                        if tc.get('id'):
                            existing_tool_ids.add(tc['id'])

            new_tool_calls = []
            for tool_id, tc in pending.items():
                if tool_id == 'index_to_id':
                    continue
                if tool_id not in existing_tool_ids:
                    # 校验 tool_call arguments 是否为有效 JSON：LLM 输出因 max_output_tokens
                    # 截断会产生无效 arguments（如 Write 大文件内容）。此类 tool_call 从未被
                    # 后端执行，固化会污染 LLM 上下文（下次调用 400 invalid function arguments），
                    # 必须丢弃，只保留完整合法的 tool_call。
                    args = (tc.get('function') or {}).get('arguments')
                    if isinstance(args, str):
                        try:
                            json.loads(args)
                        except Exception:
                            logger.warning(
                                f"[ChunkCollector] Dropping truncated tool_call {tool_id} "
                                f"({(tc.get('function') or {}).get('name')}): invalid arguments JSON"
                            )
                            continue
                    new_tool_calls.append(tc)

            if new_tool_calls:
                self._agent_data[message_id]['data'].append({
                    'type': 'tool_calls',
                    'tool_calls': new_tool_calls
                })
                # 固化后清理 pending，防止多次收集重复固化同一 tool_call
                for tool_id in new_tool_calls:
                    pending.pop(tool_id, None)

        # 清理空块（仅该 message_id）
        if message_id in self._agent_data:
            cleaned_data = []
            for block in self._agent_data[message_id]['data']:
                block_type = block.get('type')
                if block_type == 'content' and not block.get('content', '').strip():
                    continue
                if block_type == 'reasoning_content':
                    pass
                if block_type == 'tool_calls' and not block.get('tool_calls', []):
                    continue
                cleaned_data.append(block)
            self._agent_data[message_id]['data'] = cleaned_data

        return {message_id: self._agent_data.get(message_id, {'agent_name': None, 'data': []})}
    
    def get_chunk_count(self) -> int:
        return len(self._chunks)
    
    def get_chunks_since(self, since_index: int) -> list:
        return self._chunks[since_index:]
