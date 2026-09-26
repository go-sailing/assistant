import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    host: true,
    port: 5173,
    proxy: {
      // 开发环境把 /api 转发到后端服务
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      // 开发环境把 /mcp（智能体代理 MCP 端点）转发到后端服务，与生产 nginx 一致
      '/mcp': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  build: {
    target: 'es2018',
    outDir: 'dist',
  },
})