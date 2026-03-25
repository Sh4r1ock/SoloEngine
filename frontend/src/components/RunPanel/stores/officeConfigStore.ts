import { create } from 'zustand';

interface OfficeConfig {
  enabled: boolean;
  url: string | null;
  checkStatus: 'idle' | 'checking' | 'available' | 'unavailable';
  lastChecked: number | null;
}

interface OfficeConfigState {
  config: OfficeConfig;
  checkAvailability: () => Promise<boolean>;
  setEnabled: (enabled: boolean) => void;
  setUrl: (url: string) => void;
  reset: () => void;
}

const ONLYOFFICE_CHECK_INTERVAL = 60000;

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

    const onlyOfficeUrl = config.url || 'http://localhost:8080';

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

  setEnabled: (enabled) => set(state => ({
    config: { ...state.config, enabled }
  })),

  setUrl: (url) => set(state => ({
    config: { ...state.config, url, checkStatus: 'idle', lastChecked: null }
  })),

  reset: () => set({ config: { ...defaultConfig } }),
}));
