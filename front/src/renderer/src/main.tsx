import './assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
// 纯浏览器开发模式(npm run dev:react)时 preload 不会执行,
// 这里给 window.electron 补一个替身;Electron 环境下自动跳过。
import { installBrowserFallbacks } from './browser-fallback'

installBrowserFallbacks()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
