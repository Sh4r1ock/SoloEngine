// LLM 默认值唯一来源（F9：合并 config/index.ts 的 LLM_DEFAULT_* 双层常量，只留本模块）
export const LLM_DEFAULTS = {
  TEMPERATURE:       parseFloat(import.meta.env.VITE_LLM_DEFAULT_TEMPERATURE || '0.7'),
  MAX_TOKENS:        parseInt(import.meta.env.VITE_LLM_DEFAULT_MAX_TOKENS || '128000'),
  MAX_TOKENS_LIMIT:  parseInt(import.meta.env.VITE_LLM_MAX_TOKENS_LIMIT || '10240000'),
  TOP_P:             parseFloat(import.meta.env.VITE_LLM_DEFAULT_TOP_P || '1.0'),
  FREQUENCY_PENALTY: parseFloat(import.meta.env.VITE_LLM_DEFAULT_FREQUENCY_PENALTY || '0.0'),
  PRESENCE_PENALTY:  parseFloat(import.meta.env.VITE_LLM_DEFAULT_PRESENCE_PENALTY || '0.0'),
  TIMEOUT:           parseInt(import.meta.env.VITE_LLM_DEFAULT_TIMEOUT || '60'),
  // 工具调用轮次默认值：一次 react_core 循环中 agent 允许调用 LLM API 的次数上限
  MAX_TOOL_CALLS:    parseInt(import.meta.env.VITE_LLM_DEFAULT_MAX_TOOL_CALLS || '30'),
};
