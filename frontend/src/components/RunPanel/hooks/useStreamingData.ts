/**
 * @file hooks/useStreamingData.ts
 * @description 流式数据处理 Hook - 方案2：引用方式实现流式输出接续
 * 
 * 核心设计：
 * - pushScope：currentBlock 追加到 completedBlocks（显示），保存引用到堆栈
 * - popScope：恢复 currentBlock 引用，继续增量更新
 * - JavaScript 引用机制：堆栈中的引用和数组中的块是同一个对象
 */

import { useRef, useCallback } from 'react';
import { useRunPanelStore, generateId } from '../stores/runPanelStore';
import type { DataBlock, DataBlockType, ToolCall } from '../types';

type ChunkType = 'reasoning_content' | 'content' | 'tool_calls' | null;

interface StreamingState {
  completedBlocks: DataBlock[];
  /** 〇·3 并发修复：按 execution_key 隔离的"进行中块"（每实例一个）。
   * 并发实例交错 chunk 时各实例的增量只追加到自己的 slot（互不打断/不碎片化），
   * 实例结束/阶段切换时才 finalize 到 completedBlocks。key 为 executionKey，
   * 无 execution_key（mainagent 兜底/legacy）用 ''。 */
  currentBlocks: Record<string, InstanceSlot>;
}

interface InstanceSlot {
  block: DataBlock | null;
  lastChunkType: ChunkType;
}

interface ScopeState {
  currentBlock: DataBlock | null;
  lastChunkType: ChunkType;
  executionKey: string;
  pendingToolCalls: Map<string, ToolCall>;
}

// 流式消息生命周期状态机（业界标准：idle → streaming → finalized）。
// 生命周期是「chunk 该渲染还是该丢弃」的唯一状态来源：
// - resetStream（execution_start）→ streaming（活性态）：chunk 正常渲染；
// - finalizeStream（执行收尾：execution_stopped / execution_complete /
//   execution_error / 暂停收尾）→ finalized（终态）：后续到达的 chunk
//   （暂停瞬间已到前端、仍在 JS 事件队列的缓冲）一律不再渲染——
//   保留已生成内容、丢弃迟到数据（Stop Generation 标准语义）。
// 终态判断收敛为状态机的固有守卫，而非散落的补丁式 if。
type StreamPhase = 'idle' | 'streaming' | 'finalized';

export const useStreamingData = () => {
  const {
    streamingData,
    setStreamingData,
    clearStreamingData,
    currentMsgId,
  } = useRunPanelStore();

  const stateRef = useRef<StreamingState>({
    completedBlocks: [],
    currentBlocks: {},
  });
  const scopeStackRef = useRef<ScopeState[]>([]);
  // agent 层级栈：栈元素为 execution_key（〇·3 并发方案——同一 agent 并发 N 实例 =
  // N 个独立 execution_key，栈元素按 key 区分实例，同 agent_id 并发实例层级不混写）。
  // 栈深 = 当前流式块的 agent_level（mainagent=0、subagent=1...）。
  // 由 index.tsx 在 agent_start / agent_complete(subagent 完成) 事件时 push/pop，
  // 不依赖「第一个 WS 块 = root」的流式顺序推断（mainagent 无流式输出时 subagent 不再误判为 root）。
  const agentStackRef = useRef<string[]>([]);
  const currentExecutionKeyRef = useRef<string | null>(null);
  const rootAgentIdRef = useRef<string | null>(null);
  // 生命周期状态机实例（初始 idle：无执行时 chunk 一律不渲染）。
  // 状态转换唯一发生在 resetStream（→ streaming）与 finalizeStream（→ finalized）。
  const streamPhaseRef = useRef<StreamPhase>('idle');
  const pendingToolCallsRef = useRef<Map<string, ToolCall>>(new Map());
  const currentMsgIdRef = useRef<string>('');
  // agent 级流式 token 阶段状态（问题 1/统一性修复）：
  // 后端 agent_token_usage 推送携带 usage_phase（独立快照阶段计数，take 消费清空时
  // +1）。前端据此精确识别阶段边界（压缩轮 stop/compacted/resume 各自独立阶段，
  // 与回显逐消息 build_flattened_blocks 语义一致）——不能用推送值递减/iteration
  // 重置推断：压缩轮生成摘要的输入含完整历史，其 total 可能 ≥ 前一阶段末值。
  // 阶段切换时锁定上一阶段已产生 token 的块（_stageDone），保持块级阶段值。
  const agentTokenStateRef = useRef<Map<string, { phase: number }>>(new Map());
  const resetAgentTokenState = useCallback(() => {
    agentTokenStateRef.current = new Map();
  }, []);

  const detectChunkType = (delta: any): ChunkType => {
    if (delta.reasoning_content !== undefined && delta.reasoning_content !== null) return 'reasoning_content';
    if (delta.tool_calls !== undefined && delta.tool_calls !== null) return 'tool_calls';
    if (delta.content !== undefined && delta.content !== null) return 'content';
    return null;
  };

  const collectAllBlocks = (): DataBlock[] => {
    const allBlocks = [...stateRef.current.completedBlocks];
    // 〇·3 并发修复：收集所有实例的进行中块（各 slot 独立，交错 chunk 互不覆盖）
    for (const key of Object.keys(stateRef.current.currentBlocks)) {
      const slot = stateRef.current.currentBlocks[key];
      if (slot.block) {
        const isInCompleted = stateRef.current.completedBlocks.includes(
          slot.block
        );
        if (!isInCompleted) {
          // 使用展开运算符创建新对象引用，确保 React.memo 的引用比较能检测到变化
          allBlocks.push({ ...slot.block });
        } else {
          // slot.block 已在 completedBlocks 中（pushScope 后），替换为新引用以触发重渲染
          const idx = allBlocks.indexOf(slot.block);
          if (idx >= 0) {
            allBlocks[idx] = { ...slot.block };
          }
        }
      }
    }
    return allBlocks;
  };

  const updateStreamingDataRafRef = useRef<number | null>(null);

  const updateStreamingData = useCallback(() => {
    if (updateStreamingDataRafRef.current !== null) return;
    updateStreamingDataRafRef.current = requestAnimationFrame(() => {
      updateStreamingDataRafRef.current = null;
      setStreamingData(collectAllBlocks());
    });
  }, [setStreamingData]);

  const flushStreamingData = useCallback(() => {
    setStreamingData(collectAllBlocks());
  }, [setStreamingData]);

  // 〇·3 并发修复：获取/创建某 execution_key 的进行中 slot（'' 兜底 mainagent/legacy）
  const getSlot = useCallback((executionKey?: string): InstanceSlot => {
    const key = executionKey || '';
    let slot = stateRef.current.currentBlocks[key];
    if (!slot) {
      slot = { block: null, lastChunkType: null };
      stateRef.current.currentBlocks[key] = slot;
    }
    return slot;
  }, []);

  // 〇·3 并发修复：finalize 某实例的进行中块（push 到 completedBlocks 并清空该 slot）
  const finalizeSlot = useCallback((slot: InstanceSlot) => {
    if (slot.block) {
      // 检查是否已经在completedBlocks中（引用比较）
      const isInCompleted = stateRef.current.completedBlocks.includes(
        slot.block
      );
      if (!isInCompleted) {
        stateRef.current.completedBlocks.push(slot.block);
      }
      // 清空该 slot，确保后续逻辑正确创建新块
      slot.block = null;
    }
    slot.lastChunkType = null;
  }, []);

  const finalizeCurrentBlock = useCallback((executionKey?: string) => {
    finalizeSlot(getSlot(executionKey));
  }, [finalizeSlot, getSlot]);

  const mergeToolCall = (existing: ToolCall, incoming: ToolCall): ToolCall => {
    const result: ToolCall = { ...existing, ...incoming };
    if (incoming.function && existing.function) {
      result.function = {
        ...existing.function,
        ...incoming.function,
        arguments: (existing.function.arguments || '') + (incoming.function.arguments || ''),
      };
    }
    return result;
  };

  /**
   * 在completedBlocks中查找指定toolId的tool_call所在的块
   * 用于堆栈恢复后，找到之前创建的tool_calls块并更新
   */
  const findToolCallBlockInCompleted = useCallback((toolId: string): { block: DataBlock | null, blockIndex: number, toolIndex: number } => {
    for (let i = 0; i < stateRef.current.completedBlocks.length; i++) {
      const block = stateRef.current.completedBlocks[i];
      if (block.type === 'tool_calls' && block.tool_calls) {
        const toolIndex = block.tool_calls.findIndex((tc) => tc.id === toolId);
        if (toolIndex >= 0) {
          return { block, blockIndex: i, toolIndex };
        }
      }
    }
    return { block: null, blockIndex: -1, toolIndex: -1 };
  }, []);

  const addOrUpdateToolCallInCurrentBlock = useCallback((tc: ToolCall, agentId?: string, agentName?: string, agentLevel?: number, executionKey?: string) => {
    const toolId = tc.id;
    const slot = getSlot(executionKey);

    if (slot.block?.type === 'tool_calls') {
      const existingIdx = slot.block.tool_calls?.findIndex(
        (existing) => existing.id === toolId
      );

      if (existingIdx !== undefined && existingIdx >= 0) {
        slot.block.tool_calls![existingIdx] = tc;
      } else {
        slot.block.tool_calls = [
          ...(slot.block.tool_calls || []),
          tc,
        ];
      }
    } else {
      // 当前块不是tool_calls类型，尝试在completedBlocks中查找
      // 这可能发生在堆栈恢复后，currentBlock被设置为其他类型的块
      const { block: existingBlock, toolIndex } = findToolCallBlockInCompleted(toolId);

      if (existingBlock && existingBlock.type === 'tool_calls') {
        // 在completedBlocks中找到对应的块，更新它
        existingBlock.tool_calls![toolIndex] = tc;
        // 将当前块设置为这个块，以便后续更新
        slot.block = existingBlock;
      } else {
        // 没有找到对应的块，创建新块
        if (slot.block) {
          stateRef.current.completedBlocks.push(slot.block);
        }
        slot.block = {
          type: 'tool_calls',
          tool_calls: [tc],
          agent_id: agentId,
          agent_name: agentName,
          agent_level: agentLevel,
          // 〇·3：块级 execution_key（并发实例归属，updateAgentTokens 匹配键）
          execution_key: executionKey,
        };
      }
    }
  }, [findToolCallBlockInCompleted, getSlot]);

  const processToolCalls = useCallback((toolCalls: ToolCall[], agentId?: string, agentName?: string, agentLevel?: number, executionKey?: string) => {
    for (const tc of toolCalls) {
      const toolId = tc.id;
      const hasResult = 'result' in tc || 'error' in tc;

      if (toolId && pendingToolCallsRef.current.has(toolId)) {
        const existingTc = pendingToolCallsRef.current.get(toolId)!;
        const mergedTc = mergeToolCall(existingTc, tc);
        pendingToolCallsRef.current.set(toolId, mergedTc);
        addOrUpdateToolCallInCurrentBlock(mergedTc, agentId, agentName, agentLevel, executionKey);

        if (hasResult) {
          pendingToolCallsRef.current.delete(toolId);
        }
      } else if (toolId && !hasResult) {
        pendingToolCallsRef.current.set(toolId, { ...tc });
        addOrUpdateToolCallInCurrentBlock({ ...tc }, agentId, agentName, agentLevel, executionKey);
      } else if (toolId) {
        // 带有result但不在pending中，可能是堆栈恢复后的情况
        // 首先尝试在completedBlocks中查找
        const { block: existingBlock, toolIndex } = findToolCallBlockInCompleted(toolId);

        if (existingBlock && existingBlock.type === 'tool_calls') {
          // 找到对应的块，更新tool_call
          const existingTc = existingBlock.tool_calls![toolIndex];
          const mergedTc = mergeToolCall(existingTc, tc);
          existingBlock.tool_calls![toolIndex] = mergedTc;
          // 〇·3 并发修复：设置该实例的当前块为这个块（slot 隔离）
          getSlot(executionKey).block = existingBlock;
        } else {
          // 没有找到，创建新的
          pendingToolCallsRef.current.set(toolId, { ...tc });
          addOrUpdateToolCallInCurrentBlock({ ...tc }, agentId, agentName, agentLevel, executionKey);
        }
        pendingToolCallsRef.current.delete(toolId);
      }
    }
  }, [addOrUpdateToolCallInCurrentBlock, findToolCallBlockInCompleted, getSlot]);

  const processContentChunk = useCallback((delta: any, chunkType: 'reasoning_content' | 'content', agentId?: string, agentName?: string, agentLevel?: number, executionKey?: string) => {
    const content = delta[chunkType] || '';
    // 压缩摘要标记：react_core compact() 发射的格式化摘要 content 携带 _is_compaction，
    // 前端据此渲染「上下文已压缩」气泡（与回显路径 build_flattened_blocks 同构）
    const isCompactionBlock = !!(delta as any)._is_compaction;

    // 〇·3 并发修复：各实例的进行中块独立（slot.block 同实例类型一致才追加，
    // 交错 chunk 只更新自己实例的 slot，互不打断/不碎片化）
    const slot = getSlot(executionKey);
    if (slot.block?.type === chunkType) {
      slot.block[chunkType] =
        (slot.block[chunkType] || '') + content;
    } else {
      if (slot.block) {
        stateRef.current.completedBlocks.push(slot.block);
      }
      slot.block = {
        type: chunkType,
        [chunkType]: content,
        agent_id: agentId,
        agent_name: agentName,
        agent_level: agentLevel,
        // 〇·3：块级 execution_key（并发实例归属，updateAgentTokens 匹配键）
        execution_key: executionKey,
        ...(isCompactionBlock ? { _is_compaction: true } : {}),
      };
    }
  }, [getSlot]);



  const pushScope = useCallback((newExecutionKey: string, newAgentName: string) => {
    // 〇·3 并发修复：操作的是当前实例的 slot（prevKey 对应的进行中块）
    const prevKey = currentExecutionKeyRef.current || '';
    const prevSlot = getSlot(prevKey);

    // 1. 折叠当前实例正在增量的块（仅当用户未手动操作时）
    if (prevSlot.block && !prevSlot.block._userToggled) {
      prevSlot.block._isExpanding = false;
    }

    // 2. 如果有进行中块，追加到 completedBlocks
    if (prevSlot.block) {
      const isInCompleted = stateRef.current.completedBlocks.includes(
        prevSlot.block
      );
      if (!isInCompleted) {
        stateRef.current.completedBlocks.push(prevSlot.block);
      }
      prevSlot.block = null;
    }

    // 3. 保存 executionKey 到堆栈（slot 已在 currentBlocks 中，按 key 恢复）
    scopeStackRef.current.push({
      currentBlock: prevSlot.block,
      lastChunkType: prevSlot.lastChunkType,
      executionKey: prevKey,
      pendingToolCalls: new Map(pendingToolCallsRef.current),
    });

    // 4. 清空 pendingToolCalls 并切换当前实例（新实例 slot 由 getSlot 惰性创建）
    pendingToolCallsRef.current = new Map();
    currentExecutionKeyRef.current = newExecutionKey;

    // 5. 更新 UI
    flushStreamingData();
  }, [flushStreamingData, getSlot]);

  const popScope = useCallback(() => {
    // 〇·3 并发修复：finalize 当前实例的进行中块（并折叠）
    const curKey = currentExecutionKeyRef.current || '';
    const curSlot = getSlot(curKey);
    if (curSlot.block) {
      if (!curSlot.block._userToggled) {
        curSlot.block._isExpanding = false;
      }
      stateRef.current.completedBlocks.push(curSlot.block);
      curSlot.block = null;
    }

    // 2. 从堆栈恢复
    if (scopeStackRef.current.length > 0) {
      const parentState = scopeStackRef.current.pop()!;

      // 3. 恢复父实例：slot 按 executionKey 定位（pushScope 时已 finalize 到
      // completedBlocks，栈快照的 currentBlock 是同一对象引用；此处恢复 lastChunkType
      // 供父实例后续 chunk 的类型连续性判断）
      currentExecutionKeyRef.current = parentState.executionKey;
      pendingToolCallsRef.current = new Map(parentState.pendingToolCalls);
      const parentSlot = getSlot(parentState.executionKey);
      parentSlot.lastChunkType = parentState.lastChunkType;

      // 4. 恢复父实例的块为展开状态（仅当用户未手动操作时）
      if (parentSlot.block && !parentSlot.block._userToggled) {
        parentSlot.block._isExpanding = true;
      }

      // 5. 更新 UI（MainAgent + SubAgent 数据都显示）
      flushStreamingData();
    }
  }, [flushStreamingData, getSlot]);

  const enterRootAgent = useCallback((agentId: string, executionKey: string) => {
    // mainagent 进入（agent_start 事件，parent_agent_id 为空）。
    // rootAgentIdRef 存 agentId（消息级归属）；agentStackRef 存 executionKey（层级）。
    if (!rootAgentIdRef.current) {
      rootAgentIdRef.current = agentId;
      currentExecutionKeyRef.current = executionKey;
      agentStackRef.current = [executionKey];
    }
  }, []);

  const enterSubAgent = useCallback((agentId: string, agentName?: string, executionKey?: string) => {
    // subagent 进入（agent_start 事件，parent_agent_id 非空）。
    // 栈元素为 executionKey（〇·3：同一 agent 并发 N 实例各自独立层级）
    if (!executionKey) return;
    if (!rootAgentIdRef.current) {
      // 防御：mainagent 的 agent_start 未到达（罕见），把 subagent 作为 root 处理
      rootAgentIdRef.current = agentId;
      currentExecutionKeyRef.current = executionKey;
      agentStackRef.current = [executionKey];
      return;
    }
    if (executionKey === currentExecutionKeyRef.current) return;
    pushScope(executionKey, agentName || agentId);
    agentStackRef.current.push(executionKey);
    currentExecutionKeyRef.current = executionKey;
  }, [pushScope]);

  const exitAgent = useCallback((executionKey: string) => {
    // subagent 完成（agent_complete status=completed 且 parent_agent_id 非空）：pop 回父级。
    // 栈元素为 executionKey（并发实例独立出栈）
    if (currentExecutionKeyRef.current !== executionKey) return;
    const idx = agentStackRef.current.lastIndexOf(executionKey);
    if (idx > 0) {
      popScope();
      agentStackRef.current.pop();
      currentExecutionKeyRef.current = agentStackRef.current[agentStackRef.current.length - 1] || null;
    }
    // idx === 0（root/mainagent）不 pop
  }, [popScope]);

  const updateAgentTokens = useCallback((agentId: string, usage: any, agentUsage?: any, executionKey?: string) => {
    // 统一性修复：流式 token 唯一注入路径（问题 1 修复）。
    // 数据源统一为后端 _accumulated_usage 快照（均携带 usage_phase）：
    //  - agent_token_usage 事件（每次 LLM 迭代结束推送）
    //  - agent_complete 事件（agent 完成时 metadata.tokens，含压缩轮 stop/compacted/
    //    completed 各阶段；stop 拦截阶段无迭代推送，仅由此处补写，值含 intercepted_entry
    //    与回显完全一致）。
    // 阶段语义（与回显逐消息 build_flattened_blocks 完全同构）：
    //  - 每个独立快照阶段（stop / 压缩轮 / resume，由后端 take_accumulated_usage
    //    消费清空划分，usage_phase+1）产生该阶段的块，块级 agent_tokens/history
    //    = 本阶段累计值（回显：各消息块 = 该消息 token_usage_history）
    //  - 阶段切换（usage_phase 变化）时：锁定已有 agent_tokens 的块（_stageDone），
    //    保持其阶段值不被后续阶段覆盖；同一阶段内多次迭代（如压缩轮 2 次 LLM 调用）
    //    持续更新（推送值为阶段累计，最终 = 阶段末值，与回显该消息求和一致）
    //  - 整轮累计（消息头/组头）由 agent_usage（agent 级整轮，后端聚合）经
    //    setAgentUsage 写入 agentUsageMap（后端聚合改造 4.3-2，前端不再拼接）
    // 〇·3：块匹配键为块级 execution_key（executionKey 参数，与流式块同源）——
    // 同一 agent 并发 N 实例时块级 token 不混写；阶段状态按 executionKey 隔离。
    const totalTokens = usage?.total_tokens;
    const history = (usage?.token_usage_history || []) as any[];
    const usagePhase = usage?.usage_phase ?? 0;
    if (totalTokens == null) return;

    // 后端聚合改造（4.3-2）：agent 级整轮累计写入 agentUsageMap（消息头/组头整轮显示）。
    // 数据源为 agent_usage（agent_token_usage 推送）或 agent_complete metadata.agent_usage。
    // 〇·3 并发修复：executionKey 一并写入（setAgentUsage 双键），同 agent 多实例组头
    // 按实例 executionKey 查询，互不覆盖。
    if (agentUsage) {
      useRunPanelStore.getState().setAgentUsage(agentId, agentUsage, executionKey);
    }

    if (executionKey == null) return;
    const state = agentTokenStateRef.current.get(executionKey) || { phase: -1 as number };
    if (state.phase >= 0 && usagePhase !== state.phase) {
      // 阶段切换：锁定已有 token 的块（普通块 + 压缩块统一），
      // 保持各自阶段值不被后续阶段覆盖（压缩气泡 token = 压缩轮累计）。
      // 新阶段刚产生的块尚无 agent_tokens，不锁定，由本次推送写入本阶段值。
      for (const block of stateRef.current.completedBlocks) {
        if (block.execution_key === executionKey && block.agent_tokens != null) {
          block._stageDone = true;
        }
      }
      if (getSlot(executionKey).block && getSlot(executionKey).block!.execution_key === executionKey
        && getSlot(executionKey).block!.agent_tokens != null) {
        getSlot(executionKey).block!._stageDone = true;
      }
    }
    state.phase = usagePhase;
    agentTokenStateRef.current.set(executionKey, state);

    // 同阶段内持续更新未锁定块（普通块 + 压缩块统一：阶段内多次推送递增更新，
    // 推送值为本阶段累计；跨阶段后 _stageDone 锁定不被后续阶段覆盖）。
    for (const block of stateRef.current.completedBlocks) {
      if (block.execution_key === executionKey && !block._stageDone) {
        block.agent_tokens = totalTokens;
        block.agent_token_history = history.length > 0 ? [...history] : undefined;
        // 后端聚合改造（4.3-1）：块级本阶段聚合（压缩气泡 hover 用）
        block.agent_token_totals = {
          system_prompt: usage.system_prompt_token ?? 0,
          user_prompt: usage.user_prompt_token ?? 0,
          assistant_prompt: usage.assistant_prompt_token ?? 0,
          completion: usage.completion_tokens ?? 0,
          total: totalTokens,
        };
      }
    }
    const curSlot = getSlot(executionKey);
    if (curSlot.block && curSlot.block.execution_key === executionKey
      && !curSlot.block._stageDone) {
      curSlot.block.agent_tokens = totalTokens;
      curSlot.block.agent_token_history = history.length > 0 ? [...history] : undefined;
      curSlot.block.agent_token_totals = {
        system_prompt: usage.system_prompt_token ?? 0,
        user_prompt: usage.user_prompt_token ?? 0,
        assistant_prompt: usage.assistant_prompt_token ?? 0,
        completion: usage.completion_tokens ?? 0,
        total: totalTokens,
      };
    }
    updateStreamingData();
  }, [updateStreamingData, getSlot]);

  const getRootAgentId = useCallback((): string | null => {
    // 消息级 agent 归属：取 root agent（mainagent，由 agent_start parent_agent_id=None 建立）。
    // 用于 commit 时消息头显示（mainagent 无流式块时避免误取第一个 subagent 块）。
    return rootAgentIdRef.current;
  }, []);

  const handleAgentSwitch = useCallback((newAgentId: string, newAgentName: string, newExecutionKey: string) => {
    // 流式块驱动的层级校正：确保 agent 栈与当前流式块一致（〇·3 栈元素 = execution_key）。
    // root 优先由 enterRootAgent（agent_start 事件）建立；此处兜底。
    if (!rootAgentIdRef.current) {
      rootAgentIdRef.current = newAgentId;
      currentExecutionKeyRef.current = newExecutionKey;
      agentStackRef.current = [newExecutionKey];
      return;
    }
    // 〇·3 并发修复：此处**只切换**（改栈 + 当前 key），**不 finalize**——
    // 并发实例交错 chunk 时各实例的进行中块保留在自己的 slot（由 processContentChunk
    // 按 execution_key 独立追加），实例结束（agent_complete → exitAgent → popScope）
    // 或事件驱动进入新实例（agent_start → enterSubAgent → pushScope）时才 finalize，
    // 避免交错 chunk 频繁 finalize 导致同一实例内容碎片化（TA10 并发 3 实例）。
    const idx = agentStackRef.current.indexOf(newExecutionKey);
    if (idx >= 0) {
      // 已在栈中（回到已有层级）：pop 到该层级（只收栈，不 finalize）
      while (agentStackRef.current.length > idx + 1) {
        agentStackRef.current.pop();
      }
      currentExecutionKeyRef.current = newExecutionKey;
    } else if (newExecutionKey !== currentExecutionKeyRef.current) {
      // 新执行实例：进入（push）
      agentStackRef.current.push(newExecutionKey);
      currentExecutionKeyRef.current = newExecutionKey;
    }
  }, []);

  // 使用 useRef 存储所有回调函数，避免依赖链问题
  const callbacksRef = useRef({
    updateStreamingData,
    flushStreamingData,
    finalizeCurrentBlock,
    processContentChunk,
    processToolCalls,
    handleAgentSwitch,
    enterRootAgent,
    enterSubAgent,
    exitAgent,
    updateAgentTokens,
    getRootAgentId,
    getSlot,
  });

  callbacksRef.current = {
    updateStreamingData,
    flushStreamingData,
    finalizeCurrentBlock,
    processContentChunk,
    processToolCalls,
    handleAgentSwitch,
    enterRootAgent,
    enterSubAgent,
    exitAgent,
    updateAgentTokens,
    getRootAgentId,
    getSlot,
  };

  // 使用 useRef 定义 processStreamChunk，避免依赖链问题
  const processStreamChunkRef = useRef((delta: any, agentId?: string, agentName?: string, executionKey?: string) => {
    // 生命周期守卫：仅 streaming（活性态）接受 chunk；finalized（终态）到达的
    // chunk 一律丢弃（暂停后缓冲 chunk 不渲染新流式区、不重建 agent 头像）。
    if (streamPhaseRef.current !== 'streaming') return;
    const callbacks = callbacksRef.current;

    if (agentId && executionKey) {
      callbacks.handleAgentSwitch(agentId, agentName || agentId, executionKey);
    }

    // 计算当前 agent 的 level（agent 栈深度 0 基：mainagent=0、subagent=1...）。
    // 栈深从 1 开始（enterRootAgent 设 agentStackRef=[executionKey]），agent_level 语义为 0 基，
    // 与回显 build_flattened_blocks 一致（mainagent=0、subagent=agent_level+1）。
    // B7 修复：此前直接用 length（mainagent=1）导致 mainagent 块被渲染为 subagent 组（组头+边框）。
    const agentLevel = Math.max(0, agentStackRef.current.length - 1);

    const currentType = detectChunkType(delta);
    if (!currentType) return;

    // 〇·3 并发修复：类型连续性基于当前实例的 slot（交错 chunk 各实例独立判断，
    // 互不打断；实例切换由 handleAgentSwitch 负责）
    const slot = callbacks.getSlot(executionKey);
    const prevType = slot.lastChunkType;
    const chunkTypeChanged = prevType && prevType !== currentType;

    if (chunkTypeChanged) {
      // 类型变化：折叠之前的块（仅当用户未手动操作）
      if (slot.block && !slot.block._userToggled) {
        slot.block._isExpanding = false;
      }
      callbacks.finalizeCurrentBlock(executionKey);
    }

    if (currentType === 'tool_calls') {
      callbacks.processToolCalls(delta.tool_calls || [], agentId, agentName, agentLevel, executionKey);
    } else {
      callbacks.processContentChunk(delta, currentType, agentId, agentName, agentLevel, executionKey);
    }

    slot.lastChunkType = currentType;

    // 设置当前块为展开状态（仅当用户未手动操作）。
    // thought 块保持折叠（Ⓢ Thought 标题可见、内容点击展开）：
    // ① 与回显路径一致（历史消息 thought 默认折叠）；
    // ② 避免压缩摘要超长 thought 全文渲染导致流式卡顿（B3）。
    if (slot.block && !slot.block._userToggled) {
      slot.block._isExpanding = slot.block.type !== 'reasoning_content';
    }

    // 更新 UI
    callbacks.updateStreamingData();
  });

  // 返回稳定的函数引用
  const processStreamChunk = useCallback((delta: any, agentId?: string, agentName?: string, executionKey?: string) => {
    processStreamChunkRef.current(delta, agentId, agentName, executionKey);
  }, []);

  // 使用 useRef 定义 processLegacyStream，避免依赖链问题
  const processLegacyStreamRef = useRef((content: string, contentType: string) => {
    // 生命周期守卫：仅 streaming（活性态）接受 legacy chunk
    if (streamPhaseRef.current !== 'streaming') return;
    const callbacks = callbacksRef.current;

    const legacyType = contentType === 'thinking' ? 'reasoning_content' : 'content';
    // 〇·3 并发修复：legacy 事件无 executionKey，统一归入 ''（mainagent 兜底）slot
    const slot = callbacks.getSlot('');
    const prevType = slot.lastChunkType;
    const chunkTypeChanged = prevType && prevType !== legacyType;

    if (chunkTypeChanged) {
      // 类型变化：折叠之前的块（仅当用户未手动操作）
      if (slot.block && !slot.block._userToggled) {
        slot.block._isExpanding = false;
      }
      callbacks.finalizeCurrentBlock('');
    }

    callbacks.processContentChunk({ [legacyType]: content }, legacyType);
    slot.lastChunkType = legacyType;

    // 设置当前块为展开状态（仅当用户未手动操作）
    if (slot.block && !slot.block._userToggled) {
      slot.block._isExpanding = true;
    }

    callbacks.updateStreamingData();
  });

  // 返回稳定的函数引用
  const processLegacyStream = useCallback((content: string, contentType: string) => {
    processLegacyStreamRef.current(content, contentType);
  }, []);

  const finalizeStream = useCallback((): DataBlock[] => {
    while (scopeStackRef.current.length > 0) {
      popScope();
    }

    // 〇·3 并发修复：finalize 所有实例的进行中块
    for (const key of Object.keys(stateRef.current.currentBlocks)) {
      const slot = stateRef.current.currentBlocks[key];
      if (slot.block) {
        const isInCompleted = stateRef.current.completedBlocks.includes(
          slot.block
        );
        if (!isInCompleted) {
          stateRef.current.completedBlocks.push(slot.block);
        }
        slot.block = null;
      }
    }

    const finalData = [...stateRef.current.completedBlocks];

    for (const block of finalData) {
      if (!block._userToggled) {
        block._isExpanding = false;
      }
    }

    clearStreamingData();
    // 状态转换：finalize → finalized（终态），后续到达的流式 chunk 由生命周期守卫丢弃
    streamPhaseRef.current = 'finalized';
    stateRef.current = {
      completedBlocks: [],
      currentBlocks: {},
    };
    pendingToolCallsRef.current = new Map();
    scopeStackRef.current = [];
    agentStackRef.current = [];
    currentExecutionKeyRef.current = null;
    rootAgentIdRef.current = null;

    // 修复：移除 fallbackData 兜底（finalData 为空时回退到旧的 streamingData 闭包值）。
    // 该兜底会在「本轮 LLM 报错无任何流式输出」时把上一次正常轮次的 streamingData
    // 当作本轮内容 commit，导致前端显示上一次正常运行返回的 LLM 内容（bug）。
    // 本轮无输出就返回空数组，由 commit 侧按 hasLLM/error 创建空占位消息 + 错误提示。
    resetAgentTokenState();
    return finalData;
  }, [clearStreamingData, popScope, resetAgentTokenState]);

  const resetStream = useCallback(() => {
    clearStreamingData();
    // 状态转换：reset → streaming（活性态），新一轮执行开始，流式 chunk 正常渲染
    streamPhaseRef.current = 'streaming';
    stateRef.current = {
      completedBlocks: [],
      currentBlocks: {},
    };
    pendingToolCallsRef.current = new Map();
    scopeStackRef.current = [];
    agentStackRef.current = [];
    currentExecutionKeyRef.current = null;
    rootAgentIdRef.current = null;
    resetAgentTokenState();
  }, [clearStreamingData, resetAgentTokenState]);

  const addFileChangePreview = useCallback((fileChanges: any[], agentId?: string, agentName?: string) => {
    const mappedChanges = fileChanges.map(fc => ({
      file_path: fc.file_path,
      operation: fc.operation,
      content_type: fc.content_type || 'text',
      diff: fc.diff ? {
        lines_added: fc.diff.lines_added ?? 0,
        lines_removed: fc.diff.lines_removed ?? 0,
      } : undefined,
      tool_call_id: fc.tool_call_id,
      _preview: true,
    }));

    // 〇·3 并发修复：finalize 当前实例的进行中块（file_changes 独立成块，不混入内容块）
    const fcSlot = getSlot(currentExecutionKeyRef.current || undefined);
    if (fcSlot.block) {
      const isInCompleted = stateRef.current.completedBlocks.includes(
        fcSlot.block
      );
      if (!isInCompleted) {
        stateRef.current.completedBlocks.push(fcSlot.block);
      }
      fcSlot.block = null;
    }

    const existingFcBlockIndex = stateRef.current.completedBlocks.findIndex(
      b => b.type === 'file_changes' && b.agent_id === agentId
    );
    if (existingFcBlockIndex >= 0) {
      const existingBlock = stateRef.current.completedBlocks[existingFcBlockIndex];
      const existingMap = new Map(
        (existingBlock.file_changes || []).map((fc: any) => [fc.tool_call_id || fc.file_path, fc])
      );
      for (const fc of mappedChanges) {
        existingMap.set(fc.tool_call_id || fc.file_path, fc);
      }
      existingBlock.file_changes = Array.from(existingMap.values());
    } else {
      const previewBlock: DataBlock = {
        type: 'file_changes',
        file_changes: mappedChanges,
        agent_id: agentId,
        agent_name: agentName,
        agent_level: scopeStackRef.current.length,
      };
      stateRef.current.completedBlocks.push(previewBlock);
    }
    flushStreamingData();
  }, [flushStreamingData, getSlot]);

  const setCurrentMsgIdRef = useCallback((msgId: string) => {
    currentMsgIdRef.current = msgId;
  }, []);

  // 使用useRef保持streamingDataRef的稳定性
  const streamingDataRefStable = useRef({ current: streamingData });
  streamingDataRefStable.current = { current: streamingData };

  return {
    streamingData,
    streamingDataRef: streamingDataRefStable.current,
    processStreamChunk,
    processLegacyStream,
    finalizeStream,
    resetStream,
    addFileChangePreview,
    enterRootAgent,
    enterSubAgent,
    exitAgent,
    updateAgentTokens,
    getRootAgentId,
    currentMsgIdRef,
    setCurrentMsgIdRef,
  };
};
