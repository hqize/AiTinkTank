import { resolve } from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 纯浏览器开发配置(供 `npm run dev:react` 使用):
// 只启动 React 渲染层,不启动 Electron —— 适合先单独调 UI/样式。
// Electron 的开发与构建仍走 electron.vite.config.ts(electron-vite 只识别
// electron.vite.config.*),两者互不影响、可共存。
// 注意:浏览器里没有 preload,依赖 window.electron 的代码由
// src/renderer/src/browser-fallback.ts 注入替身兜底。
export default defineConfig({
  root: resolve('src/renderer'),
  plugins: [react()],
  resolve: {
    alias: {
      '@renderer': resolve('src/renderer/src')
    }
  },
  server: {
    port: 5173
  }
})
