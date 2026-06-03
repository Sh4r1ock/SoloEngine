/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_WEBSOCKET_RECONNECT_INTERVAL_MS?: string;
  readonly VITE_WEBSOCKET_MAX_RECONNECT_ATTEMPTS?: string;
  readonly VITE_WEBSOCKET_HEARTBEAT_INTERVAL_MS?: string;
  readonly VITE_WEBSOCKET_HEARTBEAT_TIMEOUT_MS?: string;
  readonly VITE_WEBSOCKET_HEARTBEAT_CHECK_INTERVAL_MS?: string;
  readonly VITE_WEBSOCKET_MAX_RECONNECT_DELAY_MS?: string;
  readonly VITE_WEBSOCKET_RESPONSE_TIMEOUT?: string;
  readonly VITE_API_REQUEST_TIMEOUT?: string;
  readonly VITE_MCP_REQUEST_TIMEOUT?: string;
  readonly VITE_ONLYOFFICE_CHECK_INTERVAL?: string;
  readonly VITE_ONLYOFFICE_URL?: string;
  readonly VITE_DEFAULT_MAX_ITERATIONS?: string;
  readonly VITE_DEFAULT_MAX_CONTEXT_LENGTH?: string;
  readonly VITE_DEFAULT_TIMEOUT?: string;
  readonly VITE_LLM_DEFAULT_TEMPERATURE?: string;
  readonly VITE_LLM_DEFAULT_MAX_TOKENS?: string;
  readonly VITE_LLM_MAX_TOKENS_LIMIT?: string;
  readonly VITE_LLM_DEFAULT_TOP_P?: string;
  readonly VITE_LLM_DEFAULT_FREQUENCY_PENALTY?: string;
  readonly VITE_LLM_DEFAULT_PRESENCE_PENALTY?: string;
  readonly VITE_LLM_DEFAULT_TIMEOUT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
