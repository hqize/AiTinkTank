/**
 * 界面状态：当前视图 + 设置面板开合。
 *
 * Electron 是单窗口应用，两个页面（对话 / 导入）用视图切换而不是路由跳转，
 * 这样切换时各自的状态（对话消息、上传任务）都留在 store 里，不会丢。
 */
import { create } from 'zustand'

/** 可切换的页面 */
export type AppView = 'chat' | 'import'

export interface UiState {
  view: AppView
  settingsOpen: boolean
  setView: (view: AppView) => void
  openSettings: () => void
  closeSettings: () => void
  toggleSettings: () => void
}

export const useUiStore = create<UiState>()((set) => ({
  view: 'chat',
  settingsOpen: false,
  setView: (view) => set({ view }),
  openSettings: () => set({ settingsOpen: true }),
  closeSettings: () => set({ settingsOpen: false }),
  toggleSettings: () => set((state) => ({ settingsOpen: !state.settingsOpen }))
}))
