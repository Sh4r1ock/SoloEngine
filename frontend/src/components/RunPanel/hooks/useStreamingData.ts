/**
 * @file hooks/useStreamingData.ts
 * @description 流式数据处理 Hook
 */

import { useRef, useCallback } from 'react';
import { useRunPanelStore, generateId } from '../stores/runPanelStore';
import type { DataBlock, DataBlockType, ToolCall } from '../types';

type ChunkType = 'reasoning_content' | 'content' | 'tool_calls' | null;

export const useStreamingData = () => {
  const {
    streamingData,
    setStreamingData,
    clearStreamingData,
    expandedReasoning,
    expandedToolCalls,
    streamingExpandedKeys,
    setStreamingExpandedKeys,
    setExpandedReasoning,
    setExpandedToolCalls,
    currentMsgId,
  } = useRunPanelStore();

  const lastChunkTypeRef = useRef<ChunkType>(null);
  const streamingDataRef = useRef<DataBlock[]>([]);
  const streamingToolCallIdsRef = useRef<Set<string>>(new Set());
  const streamingExpandedKeysRef = useRef<Set<string>>(new Set());
  const currentMsgIdRef = useRef<string>('');

  const detectChunkType = (delta: any): ChunkType => {
    if (delta.reasoning_content) {
      return 'reasoning_content';
    }
    if (delta.tool_calls) {
      return 'tool_calls';
    }
    if (delta.content) {
      return 'content';
    }
    return null;
  };

  const mergeStreamingData = useCallback((
    prev: DataBlock[],
    delta: any,
    currentType: ChunkType,
    prevType: ChunkType
  ): DataBlock[] => {
    const newData = [...prev];

    if (prevType !== currentType) {
      if (currentType === 'reasoning_content') {
        newData.push({
          type: 'reasoning_content',
          reasoning_content: delta.reasoning_content,
        });
      } else if (currentType === 'tool_calls') {
        const toolCalls = delta.tool_calls || [];
        const lastBlockIdx = newData.length - 1;

        if (lastBlockIdx >= 0 && newData[lastBlockIdx].type === 'tool_calls') {
          const existingToolCalls = newData[lastBlockIdx].tool_calls || [];
          const updatedToolCalls = [...existingToolCalls];

          toolCalls.forEach((tc: ToolCall) => {
            const existingIdx = updatedToolCalls.findIndex(
              (existingTc) => existingTc.id === tc.id
            );

            if (existingIdx >= 0) {
              const existingTc = updatedToolCalls[existingIdx];
              updatedToolCalls[existingIdx] = {
                ...existingTc,
                ...tc,
                function: {
                  ...existingTc.function,
                  ...tc.function,
                  arguments: (existingTc.function?.arguments || '') + (tc.function?.arguments || ''),
                },
              };
            } else {
              updatedToolCalls.push(tc);
            }
          });

          newData[lastBlockIdx] = {
            ...newData[lastBlockIdx],
            tool_calls: updatedToolCalls,
          };
        } else {
          newData.push({
            type: 'tool_calls',
            tool_calls: toolCalls,
          });
        }
      } else if (currentType === 'content') {
        newData.push({
          type: 'content',
          content: delta.content,
        });
      }
    } else if (prevType && prevType === currentType && newData.length > 0) {
      const lastIdx = newData.length - 1;

      if (currentType === 'reasoning_content') {
        newData[lastIdx] = {
          ...newData[lastIdx],
          reasoning_content: (newData[lastIdx].reasoning_content || '') + delta.reasoning_content,
        };
      } else if (currentType === 'tool_calls') {
        const toolCalls = delta.tool_calls || [];
        const existingToolCalls = newData[lastIdx].tool_calls || [];
        const updatedToolCalls = [...existingToolCalls];

        toolCalls.forEach((tc: ToolCall) => {
          const existingIdx = updatedToolCalls.findIndex(
            (existingTc) => existingTc.id === tc.id
          );

          if (existingIdx >= 0) {
            const existingTc = updatedToolCalls[existingIdx];
            updatedToolCalls[existingIdx] = {
              ...existingTc,
              ...tc,
              function: {
                ...existingTc.function,
                ...tc.function,
                arguments: (existingTc.function?.arguments || '') + (tc.function?.arguments || ''),
              },
            };
          } else {
            updatedToolCalls.push(tc);
          }
        });

        newData[lastIdx] = {
          ...newData[lastIdx],
          tool_calls: updatedToolCalls,
        };
      } else if (currentType === 'content') {
        newData[lastIdx] = {
          ...newData[lastIdx],
          content: (newData[lastIdx].content || '') + delta.content,
        };
      }
    }

    streamingDataRef.current = newData;
    return newData;
  }, []);

  const collapsePreviousBlocks = useCallback(() => {
    const keysToCollapse = Array.from(streamingExpandedKeysRef.current);
    if (keysToCollapse.length > 0) {
      setExpandedReasoning((prev) => {
        const newSet = new Set(prev);
        keysToCollapse.forEach((key) => newSet.delete(key));
        return newSet;
      });
      setExpandedToolCalls((prev) => {
        const newSet = new Set(prev);
        keysToCollapse.forEach((key) => newSet.delete(key));
        return newSet;
      });
    }
    setStreamingExpandedKeys(new Set());
    streamingExpandedKeysRef.current = new Set();
  }, [setExpandedReasoning, setExpandedToolCalls, setStreamingExpandedKeys]);

  const expandCurrentBlock = useCallback((blockIdx: number, block: DataBlock) => {
    const msgId = currentMsgIdRef.current;
    if (block.type === 'reasoning_content') {
      const key = `${msgId}-reasoning-${blockIdx}`;
      setStreamingExpandedKeys((prev) => {
        const newSet = new Set(prev).add(key);
        streamingExpandedKeysRef.current = newSet;
        return newSet;
      });
      setExpandedReasoning((prev) => new Set(prev).add(key));
    } else if (block.type === 'tool_calls') {
      block.tool_calls?.forEach((tc, tcIdx) => {
        const key = `${msgId}-${blockIdx}-${tcIdx}`;
        setStreamingExpandedKeys((prev) => {
          const newSet = new Set(prev).add(key);
          streamingExpandedKeysRef.current = newSet;
          return newSet;
        });
        setExpandedToolCalls((prev) => new Set(prev).add(key));
      });
    }
  }, [setStreamingExpandedKeys, setExpandedReasoning, setExpandedToolCalls]);

  const processStreamChunk = useCallback((delta: any) => {
    const currentType = detectChunkType(delta);
    const prevType = lastChunkTypeRef.current;
    const chunkTypeChanged = prevType && prevType !== currentType;

    if (currentType) {
      if (chunkTypeChanged) {
        collapsePreviousBlocks();
      }

      setStreamingData((prev) => mergeStreamingData(prev, delta, currentType, prevType));

      setTimeout(() => {
        const currentData = streamingDataRef.current;
        if (currentData.length === 0) return;

        const lastBlockIdx = currentData.length - 1;
        const lastBlock = currentData[lastBlockIdx];
        expandCurrentBlock(lastBlockIdx, lastBlock);
      }, 0);

      lastChunkTypeRef.current = currentType;
    }
  }, [mergeStreamingData, collapsePreviousBlocks, expandCurrentBlock, setStreamingData]);

  const processLegacyStream = useCallback((content: string, contentType: string) => {
    const legacyType = contentType === 'thinking' ? 'reasoning_content' : 'content';
    const prevType = lastChunkTypeRef.current;
    const chunkTypeChanged = prevType && prevType !== legacyType;

    if (chunkTypeChanged) {
      collapsePreviousBlocks();
    }

    setStreamingData((prev) => {
      const newData = [...prev];

      if (prevType !== legacyType) {
        if (legacyType === 'reasoning_content') {
          newData.push({
            type: 'reasoning_content',
            reasoning_content: content,
          });
        } else {
          newData.push({
            type: 'content',
            content,
          });
        }
      } else if (prevType && prevType === legacyType && newData.length > 0) {
        const lastIdx = newData.length - 1;
        if (legacyType === 'reasoning_content') {
          newData[lastIdx] = {
            ...newData[lastIdx],
            reasoning_content: (newData[lastIdx].reasoning_content || '') + content,
          };
        } else {
          newData[lastIdx] = {
            ...newData[lastIdx],
            content: (newData[lastIdx].content || '') + content,
          };
        }
      }

      streamingDataRef.current = newData;
      return newData;
    });

    setTimeout(() => {
      const currentData = streamingDataRef.current;
      if (currentData.length === 0) return;

      const lastBlockIdx = currentData.length - 1;
      const lastBlock = currentData[lastBlockIdx];
      expandCurrentBlock(lastBlockIdx, lastBlock);
    }, 0);

    lastChunkTypeRef.current = legacyType;
  }, [collapsePreviousBlocks, expandCurrentBlock, setStreamingData]);

  const finalizeStream = useCallback((): DataBlock[] => {
    const finalData = streamingDataRef.current.length > 0 
      ? streamingDataRef.current 
      : streamingData;
    clearStreamingData();
    lastChunkTypeRef.current = null;
    streamingDataRef.current = [];
    streamingToolCallIdsRef.current.clear();
    setStreamingExpandedKeys(new Set());
    streamingExpandedKeysRef.current = new Set();
    return finalData;
  }, [streamingData, clearStreamingData, setStreamingExpandedKeys]);

  const resetStream = useCallback(() => {
    clearStreamingData();
    lastChunkTypeRef.current = null;
    streamingDataRef.current = [];
    streamingToolCallIdsRef.current.clear();
    setStreamingExpandedKeys(new Set());
    streamingExpandedKeysRef.current = new Set();
  }, [clearStreamingData, setStreamingExpandedKeys]);

  const setCurrentMsgIdRef = useCallback((msgId: string) => {
    currentMsgIdRef.current = msgId;
  }, []);

  return {
    streamingData,
    streamingDataRef,
    processStreamChunk,
    processLegacyStream,
    finalizeStream,
    resetStream,
    lastChunkType: lastChunkTypeRef.current,
    currentMsgIdRef,
    setCurrentMsgIdRef,
  };
};
