// 唯一入口：所有前端 env 变量在此集中读取，默认值唯一存在于此
export const APP_CONFIG = {
  // --- LLM 参数（表单初始值） ---
  LLM_DEFAULT_TEMPERATURE:       parseFloat(import.meta.env.VITE_LLM_DEFAULT_TEMPERATURE || '0.7'),
  LLM_DEFAULT_MAX_TOKENS:        parseInt(import.meta.env.VITE_LLM_DEFAULT_MAX_TOKENS || '128000'),
  LLM_MAX_TOKENS_LIMIT:          parseInt(import.meta.env.VITE_LLM_MAX_TOKENS_LIMIT || '10240000'),
  LLM_DEFAULT_TOP_P:             parseFloat(import.meta.env.VITE_LLM_DEFAULT_TOP_P || '1.0'),
  LLM_DEFAULT_FREQUENCY_PENALTY: parseFloat(import.meta.env.VITE_LLM_DEFAULT_FREQUENCY_PENALTY || '0.0'),
  LLM_DEFAULT_PRESENCE_PENALTY:  parseFloat(import.meta.env.VITE_LLM_DEFAULT_PRESENCE_PENALTY || '0.0'),
  LLM_DEFAULT_TIMEOUT:           parseInt(import.meta.env.VITE_LLM_DEFAULT_TIMEOUT || '60'),

  // --- WebSocket 参数 ---
  WS_RECONNECT_INTERVAL_MS:      parseInt(import.meta.env.VITE_WEBSOCKET_RECONNECT_INTERVAL_MS || '3000'),
  WS_MAX_RECONNECT_ATTEMPTS:     parseInt(import.meta.env.VITE_WEBSOCKET_MAX_RECONNECT_ATTEMPTS || '10'),
  WS_HEARTBEAT_INTERVAL_MS:      parseInt(import.meta.env.VITE_WEBSOCKET_HEARTBEAT_INTERVAL_MS || '15000'),
  WS_HEARTBEAT_TIMEOUT_MS:       parseInt(import.meta.env.VITE_WEBSOCKET_HEARTBEAT_TIMEOUT_MS || '45000'),
  WS_HEARTBEAT_CHECK_INTERVAL_MS: parseInt(import.meta.env.VITE_WEBSOCKET_HEARTBEAT_CHECK_INTERVAL_MS || '10000'),
  WS_MAX_RECONNECT_DELAY_MS:     parseInt(import.meta.env.VITE_WEBSOCKET_MAX_RECONNECT_DELAY_MS || '30000'),
  WS_EXECUTION_TIMEOUT:          parseInt(import.meta.env.VITE_EXECUTION_TIMEOUT || '1800'),
  WS_RESPONSE_TIMEOUT:           parseInt(import.meta.env.VITE_WEBSOCKET_RESPONSE_TIMEOUT || '120'),

  // --- API 参数 ---
  API_BASE_URL:                import.meta.env.VITE_API_BASE_URL || 'http://localhost:8990',
  API_REQUEST_TIMEOUT:         parseInt(import.meta.env.VITE_API_REQUEST_TIMEOUT || '30000'),
  MCP_REQUEST_TIMEOUT:         parseInt(import.meta.env.VITE_MCP_REQUEST_TIMEOUT || '30000'),

  // --- 画布默认设置 ---
  CANVAS_DEFAULT_MAX_CONTEXT_LENGTH: parseInt(import.meta.env.VITE_DEFAULT_MAX_CONTEXT_LENGTH || '4096'),
  CANVAS_DEFAULT_MAX_ITERATIONS:     parseInt(import.meta.env.VITE_DEFAULT_MAX_ITERATIONS || '100'),
  CANVAS_DEFAULT_TIMEOUT:            parseInt(import.meta.env.VITE_DEFAULT_TIMEOUT || '30000'),

  // --- OnlyOffice ---
  ONLYOFFICE_CHECK_INTERVAL:   parseInt(import.meta.env.VITE_ONLYOFFICE_CHECK_INTERVAL || '60000'),
  ONLYOFFICE_URL:              import.meta.env.VITE_ONLYOFFICE_URL || 'http://localhost:8080',
};