/**
 * 应用设置（接口地址、请求选项）——客户端状态统一走 zustand。
 *
 * 浏览器版把这些散在 localStorage 的裸键上（kb_web_search_provider），
 * 这里用 zustand/persist 统一收敛，键名换成语义清晰的 kb-front-settings。
 */
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

import { DEFAULT_IMPORT_PORT, DEFAULT_QUERY_PORT } from '../api/base'
import type { WebSearchProvider } from '../api/types'
import { safeStateStorage } from '../utils/storage'

export interface SettingsState {
  /** 后端主机名；留空表示自动推导（Electron 下为本机，浏览器下为页面所在主机） */
  host: string
  /** 查询服务端口 */
  queryPort: number
  /** 导入服务端口 */
  importPort: number
  /** 是否流式输出（对应原页面的"流式输出"勾选框） */
  isStream: boolean
  /** 联网搜索实现（对应原页面的"联网"下拉框） */
  webSearchProvider: WebSearchProvider
  setHost: (host: string) => void
  setQueryPort: (port: number) => void
  setImportPort: (port: number) => void
  setStream: (isStream: boolean) => void
  setWebSearchProvider: (provider: WebSearchProvider) => void
  reset: () => void
}

const DEFAULTS = {
  host: '',
  queryPort: DEFAULT_QUERY_PORT,
  importPort: DEFAULT_IMPORT_PORT,
  isStream: true,
  webSearchProvider: 'mcp' as WebSearchProvider
}

/** 端口输入框的兜底：非法值直接退回默认端口 */
function normalizePort(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback
  const port = Math.trunc(value)
  if (port <= 0 || port > 65535) return fallback
  return port
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      ...DEFAULTS,
      setHost: (host) => set({ host }),
      setQueryPort: (port) => set({ queryPort: normalizePort(port, DEFAULT_QUERY_PORT) }),
      setImportPort: (port) => set({ importPort: normalizePort(port, DEFAULT_IMPORT_PORT) }),
      setStream: (isStream) => set({ isStream }),
      setWebSearchProvider: (webSearchProvider) => set({ webSearchProvider }),
      reset: () => set({ ...DEFAULTS })
    }),
    {
      name: 'kb-front-settings',
      storage: createJSONStorage(() => safeStateStorage),
      version: 1
    }
  )
)
