import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const CUSTOM_PRESET = {
  id: 'custom',
  name: '自定义',
  name_en: 'Custom',
  description: '用户自定义配置的Agent',
  icon: 'SettingOutlined',
  color: '#3F51B5',
  tools: [],
  skills: [],
  mcp_tools: [],
  system_prompt: '',
};

const presetsPath = resolve(__dirname, '../data/config/agent_presets.json')
let agentTypePresets: any[] = [CUSTOM_PRESET]

try {
  const content = readFileSync(presetsPath, 'utf-8')
  const data = JSON.parse(content)
  const jsonPresets = (data.presets || []).filter((p: any) => p.id !== 'custom')
  agentTypePresets = [CUSTOM_PRESET, ...jsonPresets]
} catch (e) {
  console.warn('Failed to load agent_presets.json, using Custom only')
}

export default defineConfig({
  plugins: [react()],
  define: {
    '__AGENT_TYPE_PRESETS__': agentTypePresets
  },
  server: {
    port: 8991,
    proxy: {
      '/api': {
        target: 'http://localhost:8990',
        changeOrigin: true,
        ws: true
      }
    }
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          if (id.includes('@codemirror')) {
            if (id.includes('@codemirror/lang-')) {
              const match = id.match(/@codemirror\/lang-(\w+)/);
              if (match) {
                return `cm-lang-${match[1]}`;
              }
            }
            return 'codemirror-core';
          }
          if (id.includes('@uiw/react-codemirror')) {
            return 'codemirror-react';
          }
          if (id.includes('docx-preview')) {
            return 'office-docx';
          }
          if (id.includes('xlsx')) {
            return 'office-xlsx';
          }
          if (id.includes('react-pdf') || id.includes('pdfjs-dist')) {
            return 'pdf';
          }
          if (id.includes('react-markdown') || id.includes('remark') || id.includes('rehype')) {
            return 'markdown';
          }
        },
      },
    },
    chunkSizeWarningLimit: 1000,
  },
})
