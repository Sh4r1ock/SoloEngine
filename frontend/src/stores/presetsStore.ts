import { AgentPreset } from '../services/toolsApi';

export const getPresets = (): AgentPreset[] => {
  return __AGENT_TYPE_PRESETS__ || [];
};
