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

from sqlalchemy.orm import Session
from sqlalchemy import func as sqlfunc

from app.core.database import AgenticFlowSessionModel, SessionMessageModel

# C11：aggregate_incremental_to_net_view（纯 dict 聚合，无 DB）已下移到
# services 层公共位置 app.services.file_change.aggregation，此处 re-export，
# 保持 api 层现有导入路径（run_context / run_api / run.__init__）不变，
# 同时消除 file_change_manager → api.v1.run 的反向依赖。
from app.services.file_change.aggregation import aggregate_incremental_to_net_view


def aggregate_token_totals(history: list) -> Dict[str, Any]:
    """从 token_usage_history 聚合 5 字段（后端聚合改造 3.3：前端不再求和）。

    聚合值在接口层实时计算（token_usage_history 已持久化，无需新增数据库列）。
    返回键名与前端 TokenTotals 一致：system_prompt/user_prompt/assistant_prompt/
    completion/total。整个后端 token 聚合的唯一函数（B2 路径合并）。
    """
    history = history or []
    return {
        "system_prompt": sum(h.get('system_prompt_token', 0) or 0 for h in history),
        "user_prompt": sum(h.get('user_prompt_token', 0) or 0 for h in history),
        "assistant_prompt": sum(h.get('assistant_prompt_token', 0) or 0 for h in history),
        "completion": sum(h.get('completion_tokens', 0) or 0 for h in history),
        "total": sum(h.get('total_tokens', 0) or 0 for h in history),
    }


async def save_session_message(
    db: Session, session_id: str, user_id: str, role: str,
    data: list, status: str = "completed", agent_id: str = "default",
    tokens: dict = None,
    agentic_flow_id: str = None,
    run_project_id: str = None,
    parent_message_id: str = None,
    parent_agent_id: str = None,
    llm_config_id: str = None,
    error: str = None,
    id: str = None,
):
    from app.core.database import AgenticFlowSessionModel, db_manager
    
    if data is None:
        data = []
    
    if not agent_id:
        agent_id = "default"
    
    try:
        session = db_manager.get_session(db, session_id)
        
        if not session:
            if not agentic_flow_id or not run_project_id:
                raise ValueError("agentic_flow_id and run_project_id are required to create a new session")
            session = db_manager.create_session(
                db, session_id, user_id, agentic_flow_id, run_project_id,
                status="pending",
            )
            logger.info(f"Created new session {session_id} when saving message")
        
        token_usage_history = tokens.get('token_usage_history') if tokens else None

        message = db_manager.add_session_message(
            db=db, session_id=session_id, user_id=user_id, role=role,
            data=data, status=status, agent_id=agent_id,
            parent_message_id=parent_message_id, parent_agent_id=parent_agent_id,
            token_usage_history=token_usage_history,
            llm_config_id=llm_config_id,
            error=error,
            id=id,
        )
        logger.info(f"Saved {role} message to session {session_id}: message_id={message.id}, {len(data)} blocks, status={status}")
        return message
    except Exception as e:
        logger.error(f"Failed to save message: {e}")
        db.rollback()
        raise


async def load_and_distribute_memories(
    db: Session,
    session_id: str,
    user_id: str
) -> Dict[str, List[Dict]]:
    """从数据库读取记忆并按 agent_id 分发

    应用过滤模式：tool_calls[].result 中的完整 JSON 只提取 content 字段

    关键修复：对于包含 tool_calls 的 assistant 消息，必须在后面添加对应的 tool 结果消息，
    以满足 OpenAI API 的要求（tool_calls 后必须有 tool 消息响应）

    修复：保持消息的时间顺序，将 shared_memories 和 agent_memories 按 message_index 排序合并
    """
    from app.core.database import SessionMessageModel

    # 查询所有未压缩的消息（包括最新的压缩摘要和压缩后新增的消息）
    # 设计：压缩完成后，旧消息被批量更新为 is_compressed=True，
    # 最新压缩摘要本身 is_compressed=False（默认值），压缩后新增的消息也是 is_compressed=False
    # 所以查询 is_compressed=False 即可获取所有需要加载到 LLM 上下文的消息
    records = db.query(SessionMessageModel).filter(
        SessionMessageModel.session_id == session_id,
        SessionMessageModel.user_id == user_id,
        SessionMessageModel.is_deleted == False,
        SessionMessageModel.is_compressed == False
    ).order_by(SessionMessageModel.message_index).all()
    all_records = list(records)

    # 所有消息按时间顺序存储，每个agent维护自己的完整对话历史
    all_messages = []
    excluded_empty_state_ids = []

    for record in all_records:
        data = record.data or []
        if isinstance(data, str):
            try:
                data = json.loads(data)
            except:
                data = []

        # ★ 修复 3：空 assistant 状态记录（error/stop 时保存的占位记录，data=[]，无有效内容）
        # 不能进入 LLM 上下文。判断条件：role=assistant 且 data 为空列表（或解析为空列表）。
        # 数据库保留该记录用于前端状态展示。
        if record.role == "assistant":
            normalized = data if isinstance(data, list) else []
            has_content = any(
                isinstance(b, dict) and (
                    (b.get('type') == 'content' and b.get('content'))
                    or (b.get('type') == 'reasoning_content' and b.get('reasoning_content'))
                    or (b.get('type') == 'tool_calls' and b.get('tool_calls'))
                )
                for b in normalized
            )
            if not has_content:
                excluded_empty_state_ids.append(str(record.id))
                continue
        filtered_data = _filter_tool_results(data)

        message = {
            "role": record.role,
            "data": filtered_data,
            "agent_id": record.agent_id,
            "parent_agent_id": record.parent_agent_id,
            "message_index": record.message_index
        }

        all_messages.append(message)

        # 关键修复：如果消息包含 tool_calls，在其后添加对应的 tool 结果消息
        if record.role == "assistant":
            for block in filtered_data:
                if block.get("type") == "tool_calls":
                    for tc in block.get("tool_calls", []):
                        tool_call_id = tc.get("id")
                        result = tc.get("result")
                        tool_name = tc.get("function", {}).get("name", "")

                        # result 已经被 _filter_tool_results 处理，直接取 content 或转为字符串
                        if tool_call_id and result is not None:
                            tool_content = result if isinstance(result, str) else str(result)

                            tool_msg = {
                                "role": "tool",
                                "tool_call_id": tool_call_id,
                                "content": tool_content,
                                "name": tool_name,
                                "message_index": record.message_index + 0.5  # 确保在assistant消息之后
                            }
                            all_messages.append(tool_msg)

    if excluded_empty_state_ids:
        logger.info(
            f"[load_and_distribute_memories] excluded empty assistant state records from LLM context: "
            f"{excluded_empty_state_ids} (kept in DB for status display)"
        )

    # 按 message_index 排序，保持时间顺序
    all_messages.sort(key=lambda x: x.get("message_index", 0))

    # 构建 agent_memories：每个agent获得完整的对话历史
    agent_memories = {}
    default_agent_id = "default"

    # 找到所有agent_id（包括 default）
    agent_ids = set()
    for msg in all_messages:
        agent_id = msg.get("agent_id")
        if agent_id:  # 不过滤 default
            agent_ids.add(agent_id)

    # 如果没有特定agent，使用default
    if not agent_ids:
        agent_ids = {default_agent_id}

    # 〇·5 统一分发：每个 agent 只收自己的消息（user 消息归属 = 接收 agent：
    # 人类输入已由 on_flow_created 回填为入口 agent_id，task 输入 agent_id=subagent_id）。
    # 上下文隔离天然保持（agent_id 不同即隔离），无 is_subagent / 'default' 分支。
    for agent_id in agent_ids:
        agent_memories[agent_id] = []
        for msg in all_messages:
            if msg.get('agent_id') == agent_id:
                # 移除内部字段
                clean_msg = {k: v for k, v in msg.items() if k not in ("message_index", "parent_agent_id")}
                agent_memories[agent_id].append(clean_msg)

    return agent_memories

def _filter_tool_results(data: list) -> list:
    """
    过滤 tool_calls 中的 result，提取 content 字段。
    
    当 tool_calls[].result 是 dict 时，只提取 content 字段传递给模型。
    这样模型上下文中只包含 content 字段，而数据库中存储完整 JSON。
    
    Args:
        data (list): 消息数据块列表。
    
    Returns:
        list: 过滤后的数据块列表。
    """
    if not isinstance(data, list):
        return data
    
    filtered = []
    for block in data:
        if not isinstance(block, dict):
            filtered.append(block)
            continue
            
        if block.get("type") == "tool_calls":
            filtered_block = {"type": "tool_calls", "tool_calls": []}
            for tc in block.get("tool_calls", []):
                # 防御性过滤：arguments 非有效 JSON 的 tool_call（LLM 输出截断产物）禁止进入
                # LLM 上下文，否则 LLM API 会因 invalid function arguments json string 返回 400。
                # 历史坏数据（固化校验前已保存）在此统一拦截。
                args = (tc.get("function") or {}).get("arguments")
                if isinstance(args, str):
                    try:
                        json.loads(args)
                    except Exception:
                        logger.warning(
                            f"[_filter_tool_results] Skipping invalid tool_call "
                            f"{tc.get('id')} ({(tc.get('function') or {}).get('name')}): invalid arguments JSON"
                        )
                        continue
                filtered_tc = tc.copy()
                if "result" in tc and isinstance(tc["result"], dict):
                    if "content" in tc["result"]:
                        filtered_tc["result"] = tc["result"]["content"]
                    elif "result" in tc["result"]:
                        filtered_tc["result"] = tc["result"]["result"]
                filtered_block["tool_calls"].append(filtered_tc)
            filtered.append(filtered_block)
        else:
            filtered.append(block)
    return filtered
