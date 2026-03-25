import type { Extension } from '@codemirror/state';
import { StreamLanguage } from '@codemirror/language';
import { yaml } from '@codemirror/legacy-modes/mode/yaml';
import { shell } from '@codemirror/legacy-modes/mode/shell';
import { properties } from '@codemirror/legacy-modes/mode/properties';

type LanguageLoader = () => Promise<{ default: Extension }>;

interface LanguageCache {
  [key: string]: Extension | null;
}

const languageCache: LanguageCache = {};

const builtinLanguages: Record<string, Extension> = {
  yaml: StreamLanguage.define(yaml),
  shell: StreamLanguage.define(shell),
  properties: StreamLanguage.define(properties),
};

const languageLoaders: Record<string, LanguageLoader> = {
  javascript: async () => {
    const m = await import('@codemirror/lang-javascript');
    return { default: m.javascript() };
  },
  typescript: async () => {
    const m = await import('@codemirror/lang-javascript');
    return { default: m.javascript({ jsx: false, typescript: true }) };
  },
  jsx: async () => {
    const m = await import('@codemirror/lang-javascript');
    return { default: m.javascript({ jsx: true }) };
  },
  tsx: async () => {
    const m = await import('@codemirror/lang-javascript');
    return { default: m.javascript({ jsx: true, typescript: true }) };
  },
  python: async () => {
    const m = await import('@codemirror/lang-python');
    return { default: m.python() };
  },
  java: async () => {
    const m = await import('@codemirror/lang-java');
    return { default: m.java() };
  },
  cpp: async () => {
    const m = await import('@codemirror/lang-cpp');
    return { default: m.cpp() };
  },
  c: async () => {
    const m = await import('@codemirror/lang-cpp');
    return { default: m.cpp() };
  },
  go: async () => {
    const m = await import('@codemirror/lang-go');
    return { default: m.go() };
  },
  rust: async () => {
    const m = await import('@codemirror/lang-rust');
    return { default: m.rust() };
  },
  html: async () => {
    const m = await import('@codemirror/lang-html');
    return { default: m.html() };
  },
  css: async () => {
    const m = await import('@codemirror/lang-css');
    return { default: m.css() };
  },
  json: async () => {
    const m = await import('@codemirror/lang-json');
    return { default: m.json() };
  },
  xml: async () => {
    const m = await import('@codemirror/lang-xml');
    return { default: m.xml() };
  },
  sql: async () => {
    const m = await import('@codemirror/lang-sql');
    return { default: m.sql() };
  },
  markdown: async () => {
    const m = await import('@codemirror/lang-markdown');
    return { default: m.markdown() };
  },
  php: async () => {
    const m = await import('@codemirror/lang-php');
    return { default: m.php() };
  },
  vue: async () => {
    const m = await import('@codemirror/lang-vue');
    return { default: m.vue() };
  },
};

export const loadLanguage = async (lang: string): Promise<Extension | null> => {
  if (languageCache[lang] !== undefined) {
    return languageCache[lang];
  }

  if (builtinLanguages[lang]) {
    languageCache[lang] = builtinLanguages[lang];
    return builtinLanguages[lang];
  }

  const loader = languageLoaders[lang];
  if (!loader) {
    languageCache[lang] = null;
    return null;
  }

  try {
    const module = await loader();
    languageCache[lang] = module.default;
    return module.default;
  } catch (error) {
    console.error(`Failed to load language: ${lang}`, error);
    languageCache[lang] = null;
    return null;
  }
};

export const preloadCommonLanguages = async (): Promise<void> => {
  const commonLanguages = ['javascript', 'typescript', 'json', 'html', 'css'];
  await Promise.all(commonLanguages.map(lang => loadLanguage(lang)));
};

export const getLoadedLanguages = (): string[] => {
  return Object.keys(languageCache).filter(key => languageCache[key] !== null);
};

export const clearLanguageCache = (): void => {
  Object.keys(languageCache).forEach(key => {
    delete languageCache[key];
  });
};
