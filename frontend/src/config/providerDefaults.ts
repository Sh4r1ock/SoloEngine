import { APP_CONFIG } from './index';

export const PROVIDER_DEFAULTS: Record<string, string> = {
  openai:    APP_CONFIG.PROVIDER_OPENAI_BASE_URL,
  anthropic: APP_CONFIG.PROVIDER_ANTHROPIC_BASE_URL,
  qwen:      APP_CONFIG.PROVIDER_QWEN_BASE_URL,
  ollama:    APP_CONFIG.PROVIDER_OLLAMA_BASE_URL,
  deepseek:  APP_CONFIG.PROVIDER_DEEPSEEK_BASE_URL,
  zhipu:     APP_CONFIG.PROVIDER_ZHIPU_BASE_URL,
};

export function getProviderDefaultBaseUrl(provider: string): string {
  return PROVIDER_DEFAULTS[provider] || '';
}
