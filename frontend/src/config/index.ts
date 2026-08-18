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
  // 工具调用轮次：一次 react_core 循环中 agent 允许调用 LLM API 的次数上限（LLM 配置默认值）
  LLM_DEFAULT_MAX_TOOL_CALLS:    parseInt(import.meta.env.VITE_LLM_DEFAULT_MAX_TOOL_CALLS || '30'),

  // --- 命令权限默认配置 ---
  // 默认命令白名单（权限模式=白名单模式时画布初始显示；逗号分隔的命令前缀）
  // 综合主流 AI IDE（Claude Code / Cursor / CodeBuddy / mmi 等）默认安全命令：
  // 只读命令 + 构建/包管理/版本控制命令，不含 rm/sudo 等破坏性命令
  DEFAULT_COMMAND_ALLOWLIST: (import.meta.env.VITE_DEFAULT_COMMAND_ALLOWLIST || '').split(',').map((s: string) => s.trim()).filter(Boolean),

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

  // --- OnlyOffice ---
  ONLYOFFICE_CHECK_INTERVAL:   parseInt(import.meta.env.VITE_ONLYOFFICE_CHECK_INTERVAL || '60000'),
  ONLYOFFICE_URL:              import.meta.env.VITE_ONLYOFFICE_URL || 'http://localhost:8080',
};