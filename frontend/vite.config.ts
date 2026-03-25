import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
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
