/**
 * @file hooks/useCallRecords.ts
 * @description 工具调用记录 Hook
 */

import { useCallback } from 'react';
import { useRunPanelStore } from '../stores/runPanelStore';
import type { CallRecord, SubagentOutput } from '../types';

export const useCallRecords = () => {
  const {
    callRecords,
    setCallRecords,
    subagentOutputs,
    setSubagentOutputs,
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

  const addSubagentOutput = useCallback((output: SubagentOutput) => {
    setSubagentOutputs(prev => [...prev, output]);
  }, [setSubagentOutputs]);

  const updateSubagentOutput = useCallback((id: string, updates: Partial<SubagentOutput>) => {
    setSubagentOutputs(prev => prev.map(output => {
      if (output.id === id) {
        return { ...output, ...updates };
      }
      return output;
    }));
  }, [setSubagentOutputs]);

  const clearSubagentOutputs = useCallback(() => {
    setSubagentOutputs([]);
  }, [setSubagentOutputs]);

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

  const handleSubagentEvent = useCallback((event: any) => {
    if (event.event_type === 'subagent_start') {
      const output: SubagentOutput = {
        id: event.agent_id || `agent_${Date.now()}`,
        name: event.agent_name,
        status: 'running',
        input: event.input,
        startTime: Date.now(),
      };
      addSubagentOutput(output);
    } else if (event.event_type === 'subagent_end') {
      updateSubagentOutput(event.agent_id, {
        status: event.error ? 'error' : 'completed',
        output: event.output,
        error: event.error,
        duration: event.duration,
      });
    }
  }, [addSubagentOutput, updateSubagentOutput]);

  return {
    callRecords,
    subagentOutputs,
    addCallRecord,
    updateCallRecord,
    clearCallRecords,
    addSubagentOutput,
    updateSubagentOutput,
    clearSubagentOutputs,
    handleToolCallEvent,
    handleSubagentEvent,
  };
};
