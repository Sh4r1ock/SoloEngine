import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync, existsSync } from 'fs'
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

function getEnvPort(key: string, defaultValue: number): number {
  const envPath = resolve(__dirname, '../.env')
  if (existsSync(envPath)) {
    try {
      const content = readFileSync(envPath, 'utf-8')
      const lines = content.split('\n')
      for (const line of lines) {
        const trimmed = line.trim()
        if (trimmed.startsWith(`${key}=`)) {
          const value = trimmed.split('=')[1]
          const port = parseInt(value, 10)
          if (!isNaN(port) && port > 0 && port < 65536) {
            return port
          }
        }
      }
    } catch (e) {
      console.warn(`Failed to read .env file, using default ${key}`)
    }
  }
  return defaultValue
}

const FRONTEND_PORT = getEnvPort('FRONTEND_PORT', 8991)
const BACKEND_PORT = getEnvPort('BACKEND_PORT', 8990)

export default defineConfig({
  plugins: [react()],
  define: {
    '__AGENT_TYPE_PRESETS__': agentTypePresets
  },
  publicDir: '../icon',
  server: {
    port: FRONTEND_PORT,
    proxy: {
      '/api': {
        target: `http://localhost:${BACKEND_PORT}`,
        changeOrigin: true,
        ws: true
      }
    }
  },
  preview: {
    port: FRONTEND_PORT,
    proxy: {
      '/api': {
        target: `http://localhost:${BACKEND_PORT}`,
        changeOrigin: true,
        ws: true
      }
    }
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          if (id.includes('@ant-design/icons')) {
            return 'antd';
          }
          if (id.includes('antd') || id.includes('@ant-design')) {
            return 'antd';
          }
          if (id.includes('echarts')) {
            return 'echarts';
          }
          if (id.includes('reactflow')) {
            return 'reactflow';
          }
          if (id.includes('react-router-dom')) {
            return 'react-router';
          }
          if (id.includes('zustand')) {
            return 'zustand';
          }
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