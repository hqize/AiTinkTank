/**
 * 对话页（应用首页）。
 *
 * 对应 backend/web/page/chat.html + chat.js：
 *   - 顶部：品牌、流式开关、联网实现下拉、API 状态、导入入口、设置、清空对话
 *   - 中间：消息列表（含阶段进度、参考图片）
 *   - 底部：输入区 + 快捷键提示
 *
 * 所有业务状态都在 chatStore / settingsStore / systemStore 里，
 * 组件只做渲染与事件转发。
 */
import { useEffect, useRef, useState } from 'react'

import Composer from './Composer'
import MessageItem from './MessageItem'
import SettingsButton from '../SettingsButton'
import { useChatStore } from '../../stores/chatStore'
import { useQueryBase } from '../../stores/selectors'
import { useSettingsStore } from '../../stores/settingsStore'
import { useSystemStore } from '../../stores/systemStore'
import { useUiStore } from '../../stores/uiStore'
import type { WebSearchProvider } from '../../api/types'

/** 联网搜索的实现选项，文案与网页版一致 */
const WEB_SEARCH_OPTIONS: Array<{ value: WebSearchProvider; label: string }> = [
  { value: 'mcp', label: '千帆 MCP' },
  { value: 'llm', label: '模型自带' },
  { value: 'off', label: '关闭' }
]

function ChatPage(): React.JSX.Element {
  const queryBase = useQueryBase()
  const isStream = useSettingsStore((state) => state.isStream)
  const setStream = useSettingsStore((state) => state.setStream)
  const webSearchProvider = useSettingsStore((state) => state.webSearchProvider)
  const setWebSearchProvider = useSettingsStore((state) => state.setWebSearchProvider)

  const messages = useChatStore((state) => state.messages)
  const sending = useChatStore((state) => state.sending)
  const notice = useChatStore((state) => state.notice)
  const loadHistory = useChatStore((state) => state.loadHistory)
  const send = useChatStore((state) => state.send)
  const cancelStream = useChatStore((state) => state.cancelStream)
  const clearAll = useChatStore((state) => state.clearAll)
  const dismissNotice = useChatStore((state) => state.dismissNotice)

  const queryOnline = useSystemStore((state) => state.queryOnline)
  const setView = useUiStore((state) => state.setView)

  const chatRef = useRef<HTMLDivElement>(null)
  const [confirmingClear, setConfirmingClear] = useState(false)

  // 首次进入（或改了服务地址）时拉一次历史；store 内部做了去重与并发保护
  useEffect(() => {
    void loadHistory(queryBase)
  }, [loadHistory, queryBase])

  // 消息有任何变化（新增 / 流式增量）都滚到底部
  useEffect(() => {
    const el = chatRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages])

  const handleSend = (text: string): void => {
    void send(queryBase, text, { isStream, webSearchProvider })
  }

  const handleClear = async (): Promise<void> => {
    setConfirmingClear(false)
    await clearAll(queryBase)
  }

  const apiLabel =
    queryOnline === null ? 'API: 检测中' : queryOnline ? 'API: 已连接' : 'API: 未连接'

  return (
    <div className="app">
      <div className="topbar">
        <div className="brand">
          <div className="logo" />
          <div className="title">
            <strong>RAG智库客服</strong>
            <span>在线 · 可查询知识库与联网信息</span>
          </div>
        </div>

        <div className="top-actions">
          <label className="toggle" title="关闭后为一次性返回，便于对比两种模式">
            <input
              type="checkbox"
              checked={isStream}
              onChange={(e) => setStream(e.target.checked)}
            />
            流式输出
          </label>

          <label className="toggle" title="切换联网搜索实现，方便对比两种方案的效果">
            联网：
            <select
              value={webSearchProvider}
              onChange={(e) => setWebSearchProvider(e.target.value as WebSearchProvider)}
            >
              {WEB_SEARCH_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <span className={`pill ${queryOnline ? 'pill-online' : ''}`}>{apiLabel}</span>

          {/* 进入知识库文件导入页 */}
          <button
            className="btn btn-soft"
            type="button"
            title="上传 PDF / MD 到知识库"
            onClick={() => setView('import')}
          >
            📄 导入
          </button>

          <SettingsButton compact />

          {confirmingClear ? (
            <span className="confirm-group">
              <button className="btn btn-ghost" type="button" onClick={() => setConfirmingClear(false)}>
                取消
              </button>
              <button className="btn btn-danger" type="button" onClick={() => void handleClear()}>
                确认清空
              </button>
            </span>
          ) : (
            <button className="btn" type="button" onClick={() => setConfirmingClear(true)}>
              清空对话
            </button>
          )}
        </div>
      </div>

      {notice && (
        <div className="notice">
          <span>{notice}</span>
          <button className="notice-close" type="button" onClick={dismissNotice} aria-label="关闭提示">
            ×
          </button>
        </div>
      )}

      <div className="chat" ref={chatRef}>
        <div className="dayline">今天</div>
        {messages.map((message) => (
          <MessageItem key={message.id} message={message} />
        ))}
      </div>

      <Composer sending={sending} active onSend={handleSend} onStop={cancelStream} />

      <div className="hint">
        快捷键：<span className="kbd">Enter</span> 发送，<span className="kbd">Shift</span>+
        <span className="kbd">Enter</span> 换行
      </div>
    </div>
  )
}

export default ChatPage
