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
  currentBlock: DataBlock | null;
  lastChunkType: ChunkType;
}

interface ScopeState {
  currentBlock: DataBlock | null;
  lastChunkType: ChunkType;
  agentId: string;
  pendingToolCalls: Map<string, ToolCall>;
}

export const useStreamingData = () => {
  const {
    streamingData,
    setStreamingData,
    clearStreamingData,
    currentMsgId,
  } = useRunPanelStore();

  const stateRef = useRef<StreamingState>({
    completedBlocks: [],
    currentBlock: null,
    lastChunkType: null,
  });
  const scopeStackRef = useRef<ScopeState[]>([]);
  const currentAgentIdRef = useRef<string | null>(null);
  const rootAgentIdRef = useRef<string | null>(null);
  const pendingToolCallsRef = useRef<Map<string, ToolCall>>(new Map());
  const currentMsgIdRef = useRef<string>('');

  const detectChunkType = (delta: any): ChunkType => {
    if (delta.reasoning_content !== undefined && delta.reasoning_content !== null) return 'reasoning_content';
    if (delta.tool_calls !== undefined && delta.tool_calls !== null) return 'tool_calls';
    if (delta.content !== undefined && delta.content !== null) return 'content';
    return null;
  };

  const collectAllBlocks = (): DataBlock[] => {
    const allBlocks = [...stateRef.current.completedBlocks];
    if (stateRef.current.currentBlock) {
      const isInCompleted = stateRef.current.completedBlocks.includes(
        stateRef.current.currentBlock
      );
      if (!isInCompleted) {
        // 使用展开运算符创建新对象引用，确保 React.memo 的引用比较能检测到变化
        allBlocks.push({ ...stateRef.current.currentBlock });
      } else {
        // currentBlock 已在 completedBlocks 中（pushScope 后），替换为新引用以触发重渲染
        const idx = allBlocks.indexOf(stateRef.current.currentBlock);
        if (idx >= 0) {
          allBlocks[idx] = { ...stateRef.current.currentBlock };
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

  const finalizeCurrentBlock = useCallback(() => {
    if (stateRef.current.currentBlock) {
      // 检查currentBlock是否已经在completedBlocks中（引用比较）
      const isInCompleted = stateRef.current.completedBlocks.includes(
        stateRef.current.currentBlock
      );
      if (!isInCompleted) {
        stateRef.current.completedBlocks.push(stateRef.current.currentBlock);
      }
      // 无论如何，都将currentBlock设为null，确保后续逻辑正确创建新块
      stateRef.current.currentBlock = null;
    }
  }, []);

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

  const addOrUpdateToolCallInCurrentBlock = useCallback((tc: ToolCall, agentId?: string, agentName?: string, agentLevel?: number) => {
    const toolId = tc.id;

    if (stateRef.current.currentBlock?.type === 'tool_calls') {
      const existingIdx = stateRef.current.currentBlock.tool_calls?.findIndex(
        (existing) => existing.id === toolId
      );

      if (existingIdx !== undefined && existingIdx >= 0) {
        stateRef.current.currentBlock.tool_calls![existingIdx] = tc;
      } else {
        stateRef.current.currentBlock.tool_calls = [
          ...(stateRef.current.currentBlock.tool_calls || []),
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
        // 将currentBlock设置为这个块，以便后续更新
        stateRef.current.currentBlock = existingBlock;
      } else {
        // 没有找到对应的块，创建新块
        if (stateRef.current.currentBlock) {
          stateRef.current.completedBlocks.push(stateRef.current.currentBlock);
        }
        stateRef.current.currentBlock = {
          type: 'tool_calls',
          tool_calls: [tc],
          agent_id: agentId,
          agent_name: agentName,
          agent_level: agentLevel,
        };
      }
    }
  }, [findToolCallBlockInCompleted]);

  const processToolCalls = useCallback((toolCalls: ToolCall[], agentId?: string, agentName?: string, agentLevel?: number) => {
    for (const tc of toolCalls) {
      const toolId = tc.id;
      const hasResult = 'result' in tc || 'error' in tc;

      if (toolId && pendingToolCallsRef.current.has(toolId)) {
        const existingTc = pendingToolCallsRef.current.get(toolId)!;
        const mergedTc = mergeToolCall(existingTc, tc);
        pendingToolCallsRef.current.set(toolId, mergedTc);
        addOrUpdateToolCallInCurrentBlock(mergedTc, agentId, agentName, agentLevel);

        if (hasResult) {
          pendingToolCallsRef.current.delete(toolId);
        }
      } else if (toolId && !hasResult) {
        pendingToolCallsRef.current.set(toolId, { ...tc });
        addOrUpdateToolCallInCurrentBlock({ ...tc }, agentId, agentName, agentLevel);
      } else if (toolId) {
        // 带有result但不在pending中，可能是堆栈恢复后的情况
        // 首先尝试在completedBlocks中查找
        const { block: existingBlock, toolIndex } = findToolCallBlockInCompleted(toolId);

        if (existingBlock && existingBlock.type === 'tool_calls') {
          // 找到对应的块，更新tool_call
          const existingTc = existingBlock.tool_calls![toolIndex];
          const mergedTc = mergeToolCall(existingTc, tc);
          existingBlock.tool_calls![toolIndex] = mergedTc;
          // 设置currentBlock为这个块
          stateRef.current.currentBlock = existingBlock;
        } else {
          // 没有找到，创建新的
          pendingToolCallsRef.current.set(toolId, { ...tc });
          addOrUpdateToolCallInCurrentBlock({ ...tc }, agentId, agentName, agentLevel);
        }
        pendingToolCallsRef.current.delete(toolId);
      }
    }
  }, [addOrUpdateToolCallInCurrentBlock, findToolCallBlockInCompleted]);

  const processContentChunk = useCallback((delta: any, chunkType: 'reasoning_content' | 'content', agentId?: string, agentName?: string, agentLevel?: number) => {
    const content = delta[chunkType] || '';

    if (stateRef.current.currentBlock?.type === chunkType) {
      stateRef.current.currentBlock[chunkType] =
        (stateRef.current.currentBlock[chunkType] || '') + content;
    } else {
      if (stateRef.current.currentBlock) {
        stateRef.current.completedBlocks.push(stateRef.current.currentBlock);
      }
      stateRef.current.currentBlock = {
        type: chunkType,
        [chunkType]: content,
        agent_id: agentId,
        agent_name: agentName,
        agent_level: agentLevel,
      };
    }
  }, []);



  const pushScope = useCallback((newAgentId: string, newAgentName: string) => {
    // 1. 折叠 MainAgent 正在增量的块（仅当用户未手动操作时）
    if (stateRef.current.currentBlock && !stateRef.current.currentBlock._userToggled) {
      stateRef.current.currentBlock._isExpanding = false;
    }

    // 2. 如果有 currentBlock，追加到 completedBlocks
    if (stateRef.current.currentBlock) {
      const isInCompleted = stateRef.current.completedBlocks.includes(
        stateRef.current.currentBlock
      );
      if (!isInCompleted) {
        stateRef.current.completedBlocks.push(stateRef.current.currentBlock);
      }
    }

    // 3. 保存引用到堆栈
    scopeStackRef.current.push({
      currentBlock: stateRef.current.currentBlock,
      lastChunkType: stateRef.current.lastChunkType,
      agentId: currentAgentIdRef.current || '',
      pendingToolCalls: new Map(pendingToolCallsRef.current),
    });

    // 4. 清空 currentBlock 和 lastChunkType
    stateRef.current.currentBlock = null;
    stateRef.current.lastChunkType = null;
    pendingToolCallsRef.current = new Map();
    currentAgentIdRef.current = newAgentId;

    // 5. 更新 UI
    flushStreamingData();
  }, [flushStreamingData]);

  const popScope = useCallback(() => {
    // 1. SubAgent 的 currentBlock 追加到 completedBlocks（并折叠）
    if (stateRef.current.currentBlock) {
      if (!stateRef.current.currentBlock._userToggled) {
        stateRef.current.currentBlock._isExpanding = false;
      }
      stateRef.current.completedBlocks.push(stateRef.current.currentBlock);
    }

    // 2. 从堆栈恢复
    if (scopeStackRef.current.length > 0) {
      const parentState = scopeStackRef.current.pop()!;

      // 3. 恢复 currentBlock 引用（指向 completedBlocks 中的同一个对象）
      stateRef.current.currentBlock = parentState.currentBlock;
      stateRef.current.lastChunkType = parentState.lastChunkType;
      pendingToolCallsRef.current = new Map(parentState.pendingToolCalls);
      currentAgentIdRef.current = parentState.agentId;

      // 4. 恢复 MainAgent 的块为展开状态（仅当用户未手动操作时）
      if (stateRef.current.currentBlock && !stateRef.current.currentBlock._userToggled) {
        stateRef.current.currentBlock._isExpanding = true;
      }

      // 5. 更新 UI（MainAgent + SubAgent 数据都显示）
      flushStreamingData();
    }
  }, [flushStreamingData]);

  const handleAgentSwitch = useCallback((newAgentId: string, newAgentName: string) => {
    if (!rootAgentIdRef.current) {
      rootAgentIdRef.current = newAgentId;
      currentAgentIdRef.current = newAgentId;
      return;
    }

    if (newAgentId === rootAgentIdRef.current) {
      while (scopeStackRef.current.length > 0) {
        popScope();
      }
    } else if (newAgentId !== currentAgentIdRef.current) {
      pushScope(newAgentId, newAgentName);
    }
  }, [pushScope, popScope]);

  // 使用 useRef 存储所有回调函数，避免依赖链问题
  const callbacksRef = useRef({
    updateStreamingData,
    flushStreamingData,
    finalizeCurrentBlock,
    processContentChunk,
    processToolCalls,
    handleAgentSwitch,
  });

  callbacksRef.current = {
    updateStreamingData,
    flushStreamingData,
    finalizeCurrentBlock,
    processContentChunk,
    processToolCalls,
    handleAgentSwitch,
  };

  // 使用 useRef 定义 processStreamChunk，避免依赖链问题
  const processStreamChunkRef = useRef((delta: any, agentId?: string, agentName?: string) => {
    const callbacks = callbacksRef.current;

    if (agentId) {
      callbacks.handleAgentSwitch(agentId, agentName || agentId);
    }

    // 计算当前 agent 的 level（堆栈深度）
    const agentLevel = scopeStackRef.current.length;

    const currentType = detectChunkType(delta);
    const prevType = stateRef.current.lastChunkType;
    const chunkTypeChanged = prevType && prevType !== currentType;

    if (!currentType) return;

    if (chunkTypeChanged) {
      // 类型变化：折叠之前的块（仅当用户未手动操作）
      if (stateRef.current.currentBlock && !stateRef.current.currentBlock._userToggled) {
        stateRef.current.currentBlock._isExpanding = false;
      }
      callbacks.finalizeCurrentBlock();
    }

    if (currentType === 'tool_calls') {
      callbacks.processToolCalls(delta.tool_calls || [], agentId, agentName, agentLevel);
    } else {
      callbacks.processContentChunk(delta, currentType, agentId, agentName, agentLevel);
    }

    stateRef.current.lastChunkType = currentType;

    // 设置当前块为展开状态（仅当用户未手动操作）
    if (stateRef.current.currentBlock && !stateRef.current.currentBlock._userToggled) {
      stateRef.current.currentBlock._isExpanding = true;
    }

    // 更新 UI
    callbacks.updateStreamingData();
  });

  // 返回稳定的函数引用
  const processStreamChunk = useCallback((delta: any, agentId?: string, agentName?: string) => {
    processStreamChunkRef.current(delta, agentId, agentName);
  }, []);

  // 使用 useRef 定义 processLegacyStream，避免依赖链问题
  const processLegacyStreamRef = useRef((content: string, contentType: string) => {
    const callbacks = callbacksRef.current;

    const legacyType = contentType === 'thinking' ? 'reasoning_content' : 'content';
    const prevType = stateRef.current.lastChunkType;
    const chunkTypeChanged = prevType && prevType !== legacyType;

    if (chunkTypeChanged) {
      // 类型变化：折叠之前的块（仅当用户未手动操作）
      if (stateRef.current.currentBlock && !stateRef.current.currentBlock._userToggled) {
        stateRef.current.currentBlock._isExpanding = false;
      }
      callbacks.finalizeCurrentBlock();
    }

    callbacks.processContentChunk({ [legacyType]: content }, legacyType);
    stateRef.current.lastChunkType = legacyType;

    // 设置当前块为展开状态（仅当用户未手动操作）
    if (stateRef.current.currentBlock && !stateRef.current.currentBlock._userToggled) {
      stateRef.current.currentBlock._isExpanding = true;
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

    if (stateRef.current.currentBlock) {
      const isInCompleted = stateRef.current.completedBlocks.includes(
        stateRef.current.currentBlock
      );
      if (!isInCompleted) {
        stateRef.current.completedBlocks.push(stateRef.current.currentBlock);
      }
    }

    const finalData = [...stateRef.current.completedBlocks];

    for (const block of finalData) {
      if (!block._userToggled) {
        block._isExpanding = false;
      }
    }

    clearStreamingData();
    stateRef.current = {
      completedBlocks: [],
      currentBlock: null,
      lastChunkType: null,
    };
    pendingToolCallsRef.current = new Map();
    scopeStackRef.current = [];
    currentAgentIdRef.current = null;
    rootAgentIdRef.current = null;

    const latestZustand = useRunPanelStore.getState().streamingData;
    const fallbackData = streamingData || latestZustand;
    return finalData.length > 0 ? finalData : fallbackData;
  }, [streamingData, clearStreamingData, popScope]);

  const resetStream = useCallback(() => {
    clearStreamingData();
    stateRef.current = {
      completedBlocks: [],
      currentBlock: null,
      lastChunkType: null,
    };
    pendingToolCallsRef.current = new Map();
    scopeStackRef.current = [];
    currentAgentIdRef.current = null;
    rootAgentIdRef.current = null;
  }, [clearStreamingData]);

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

    if (stateRef.current.currentBlock) {
      const isInCompleted = stateRef.current.completedBlocks.includes(
        stateRef.current.currentBlock
      );
      if (!isInCompleted) {
        stateRef.current.completedBlocks.push(stateRef.current.currentBlock);
      }
      stateRef.current.currentBlock = null;
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
  }, [flushStreamingData]);

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
    lastChunkType: stateRef.current.lastChunkType,
    currentMsgIdRef,
    setCurrentMsgIdRef,
  };
};
