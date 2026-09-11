import { create } from 'zustand';
import { APP_CONFIG } from '../../../config/index';

interface OfficeConfig {
  enabled: boolean;
  url: string | null;
  checkStatus: 'idle' | 'checking' | 'available' | 'unavailable';
  lastChecked: number | null;
}

interface OfficeConfigState {
  config: OfficeConfig;
  checkAvailability: () => Promise<boolean>;
}

const ONLYOFFICE_CHECK_INTERVAL = APP_CONFIG.ONLYOFFICE_CHECK_INTERVAL;

const defaultConfig: OfficeConfig = {
  enabled: false,
  url: null,
  checkStatus: 'idle',
  lastChecked: null,
};

export const useOfficeConfigStore = create<OfficeConfigState>((set, get) => ({
  config: { ...defaultConfig },

  checkAvailability: async () => {
    const { config } = get();
    
    if (config.lastChecked && Date.now() - config.lastChecked < ONLYOFFICE_CHECK_INTERVAL) {
      return config.checkStatus === 'available';
    }

    set(state => ({
      config: { ...state.config, checkStatus: 'checking' }
    }));

    const onlyOfficeUrl = config.url || APP_CONFIG.ONLYOFFICE_URL;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);

      const response = await fetch(`${onlyOfficeUrl}/health`, {
        method: 'GET',
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const available = response.ok;
      set(state => ({
        config: {
          ...state.config,
          enabled: available,
          checkStatus: available ? 'available' : 'unavailable',
          lastChecked: Date.now(),
        }
      }));

      return available;
    } catch {
      set(state => ({
        config: {
          ...state.config,
          enabled: false,
          checkStatus: 'unavailable',
          lastChecked: Date.now(),
        }
      }));
      return false;
    }
  },
}));
