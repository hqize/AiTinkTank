/**
 * 应用外壳。
 *
 * 打开即进入对话页；导入页由对话页顶部的「导入」按钮进入
 * （视图状态在 uiStore 里，切换时对话消息 / 上传任务的进度都不会丢）。
 *
 * 同时负责两件全局的事：
 *   1) 每 5 秒探测一次两个后端的连通性（沿用网页版的定时间隔）；
 *   2) 窗口关闭前清掉导入页的轮询定时器。
 */
import { useEffect } from 'react'

import SettingsPanel from './SettingsPanel'
import ChatPage from './chat/ChatPage'
import ImportPage from './import/ImportPage'
import { useImportBase, useQueryBase } from '../stores/selectors'
import { useImportStore } from '../stores/importStore'
import { useSystemStore } from '../stores/systemStore'
import { useUiStore } from '../stores/uiStore'

/** 连通性探测间隔（ms），与网页版 setInterval(apiHealth, 5000) 一致 */
const HEALTH_INTERVAL_MS = 5000

function AppShell(): React.JSX.Element {
  const view = useUiStore((state) => state.view)
  const check = useSystemStore((state) => state.check)

  // 依赖两个 base：地址一改就立刻重新探测（不必等下一个 5 秒 tick）
  const queryBase = useQueryBase()
  const importBase = useImportBase()

  useEffect(() => {
    void check()
    const timer = setInterval(() => void check(), HEALTH_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [check, queryBase, importBase])

  useEffect(() => {
    const stopAllPolling = useImportStore.getState().stopAllPolling
    window.addEventListener('beforeunload', stopAllPolling)
    return () => {
      window.removeEventListener('beforeunload', stopAllPolling)
      stopAllPolling()
    }
  }, [])

  return (
    <div className="shell">
      <main className="workspace">{view === 'chat' ? <ChatPage /> : <ImportPage />}</main>
      <SettingsPanel />
    </div>
  )
}

export default AppShell
