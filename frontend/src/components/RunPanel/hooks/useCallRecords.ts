/**
 * @file hooks/useCallRecords.ts
 * @description 工具调用记录 Hook
 */

import { useCallback } from 'react';
import { useRunPanelStore } from '../stores/runPanelStore';
import type { CallRecord, ChildAgentOutput } from '../types';

export const useCallRecords = () => {
  const {
    callRecords,
    setCallRecords,
    childAgentOutputs,
    setChildAgentOutputs,
  } = useRunPanelStore();

  const addCallRecord = useCallback((record: CallRecord) => {
    setCallRecords(prev => [...prev, record]);
  }, [setCallRecords]);

  const updateCallRecord = useCallback((id: string, updates: Partial<CallRecord>) => {
    setCallRecords(prev => prev.map(record => {
      if (record.id === id) {
        return { ...record, ...updates };
      }
      return record;
    }));
  }, [setCallRecords]);

  const clearCallRecords = useCallback(() => {
    setCallRecords([]);
  }, [setCallRecords]);

  const addChildAgentOutput = useCallback((output: ChildAgentOutput) => {
    setChildAgentOutputs(prev => [...prev, output]);
  }, [setChildAgentOutputs]);

  const updateChildAgentOutput = useCallback((id: string, updates: Partial<ChildAgentOutput>) => {
    setChildAgentOutputs(prev => prev.map(output => {
      if (output.id === id) {
        return { ...output, ...updates };
      }
      return output;
    }));
  }, [setChildAgentOutputs]);

  const clearChildAgentOutputs = useCallback(() => {
    setChildAgentOutputs([]);
  }, [setChildAgentOutputs]);

  const handleToolCallEvent = useCallback((event: any) => {
    if (event.event_type === 'tool_call_start') {
      const record: CallRecord = {
        id: event.call_id || `call_${Date.now()}`,
        name: event.tool_name,
        type: event.tool_type || 'tool',
        arguments: event.arguments,
        status: 'running',
        timestamp: new Date().toISOString(),
      };
      addCallRecord(record);
    } else if (event.event_type === 'tool_call_end') {
      updateCallRecord(event.call_id, {
        status: event.error ? 'error' : 'success',
        result: event.result,
        error: event.error,
        duration: event.duration,
      });
    }
  }, [addCallRecord, updateCallRecord]);

  const handleChildAgentEvent = useCallback((event: any) => {
    if (event.event_type === 'child_agent_start') {
      const output: ChildAgentOutput = {
        id: event.agent_id || `agent_${Date.now()}`,
        name: event.agent_name,
        status: 'running',
        input: event.input,
        startTime: Date.now(),
      };
      addChildAgentOutput(output);
    } else if (event.event_type === 'child_agent_end') {
      updateChildAgentOutput(event.agent_id, {
        status: event.error ? 'error' : 'completed',
        output: event.output,
        error: event.error,
        duration: event.duration,
      });
    }
  }, [addChildAgentOutput, updateChildAgentOutput]);

  return {
    callRecords,
    childAgentOutputs,
    addCallRecord,
    updateCallRecord,
    clearCallRecords,
    addChildAgentOutput,
    updateChildAgentOutput,
    clearChildAgentOutputs,
    handleToolCallEvent,
    handleChildAgentEvent,
  };
};
