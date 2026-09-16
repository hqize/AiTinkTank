/**
 * 对话页状态机。
 *
 * 迁移自 backend/web/page/chat.js：把关命令式 DOM 操作（insertAdjacentHTML /
 * renderProgress / finalizeBotAnswer）换成「不可变消息列表 + zustand set」，
 * 组件只负责按 state 渲染。
 *
 * 关键点（与原实现保持一致）：
 *   - 非流式：/query 一次性返回答案、错误、图片；
 *   - 流式：/query 只回 session_id，答案由 /stream/{session_id} 的 SSE 推送；
 *   - SSE 在服务端 final 之后会主动断开，浏览器仍会补一个原生 error 事件，
 *     因此必须区分"正常收尾断开"和"真的中断"（由 queryApi 里的 finished 标记处理）。
 */
import { create } from 'zustand'

import { clearHistory, fetchHistory, openQueryStream, submitQuery } from '../api/queryApi'
import type { QueryStreamHandle } from '../api/queryApi'
import type { HistoryItem, SseEventPayload, WebSearchProvider } from '../api/types'
import { createLocalId, formatTime, nowTime } from '../utils/format'
import { ensureSessionId, renewSessionId } from '../utils/session'

/** 消息角色 */
export type ChatRole = 'user' | 'bot'

/** pending=已入列等待返回；streaming=正在流式输出；done/error=本轮结束 */
export type ChatMessageStatus = 'pending' | 'streaming' | 'done' | 'error'

/** 阶段进度面板的数据 */
export interface ChatProgress {
  done: string[]
  running: string[]
  status: string
}

export interface ChatMessage {
  id: string
  role: ChatRole
  /** 用户消息=提问原文；机器人消息=后端答案原文（可能带【图片】标记段） */
  text: string
  /** 后端单独返回的候选图片地址 */
  images: string[]
  /** 展示用的 HH:mm */
  time: string
  /** 有值时替代时间显示（首条欢迎语用） */
  hint?: string
  status: ChatMessageStatus
  /** 是否显示打字动画 */
  waiting: boolean
  /** 阶段进度；历史消息没有进度面板，为 null */
  progress: ChatProgress | null
  /** 进度面板是否展开 */
  progressOpen: boolean
  /** 失败原因（展示在气泡里） */
  error: string
}

/** 发送请求时需要用到的选项，来自设置面板 */
export interface SendOptions {
  isStream: boolean
  webSearchProvider: WebSearchProvider
}

/** 清空历史的返回结果，供页面提示用 */
export interface ClearResult {
  ok: boolean
  message?: string
}

export interface ChatState {
  sessionId: string
  messages: ChatMessage[]
  /** 有请求在飞（含 SSE 未收尾），用于禁用发送按钮 */
  sending: boolean
  historyLoaded: boolean
  historyLoading: boolean
  /** 顶栏的一次性提示（例如"服务端清空失败"） */
  notice: string
  loadHistory: (base: string) => Promise<void>
  send: (base: string, text: string, options: SendOptions) => Promise<void>
  cancelStream: () => void
  /** 用户手动开合某条消息的阶段进度面板 */
  setProgressOpen: (messageId: string, open: boolean) => void
  clearAll: (base: string) => Promise<ClearResult>
  dismissNotice: () => void
}

const WELCOME_MESSAGE: ChatMessage = {
  id: 'welcome',
  role: 'bot',
  text: '你好，我是RAG智库客服。你可以直接提问，我会在“阶段进度”里展示处理过程。',
  images: [],
  time: '',
  hint: '提示：可以问“如何使用万用表测量电压？”',
  status: 'done',
  waiting: false,
  progress: null,
  progressOpen: false,
  error: ''
}

/**
 * 当前正在进行的 SSE 连接。
 *
 * 放在 store 外面：它是命令式的网络资源，不需要参与渲染，
 * 也不需要被 React 的不可变更新追着跑。
 */
let activeStream: QueryStreamHandle | null = null

/** 正在流式输出的那条机器人消息 id，供"停止生成"定位 */
let activeBotId: string | null = null

/** 按 id 局部更新一条消息，其余消息保持引用不变 */
function patchMessage(
  messages: ChatMessage[],
  id: string,
  updater: (message: ChatMessage) => ChatMessage
): ChatMessage[] {
  return messages.map((message) => (message.id === id ? updater(message) : message))
}

/** 历史记录 → 消息模型 */
function historyItemToMessage(item: HistoryItem): ChatMessage {
  return {
    id: item._id || createLocalId('his'),
    role: item.role === 'user' ? 'user' : 'bot',
    text: item.text || '',
    images: item.image_urls || [],
    time: formatTime(item.ts),
    status: 'done',
    waiting: false,
    progress: null,
    progressOpen: false,
    error: ''
  }
}

/** 统一取错误信息文本 */
function errorText(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  return String(error)
}

export const useChatStore = create<ChatState>()((set, get) => ({
  sessionId: ensureSessionId(),
  messages: [WELCOME_MESSAGE],
  sending: false,
  historyLoaded: false,
  historyLoading: false,
  notice: '',

  loadHistory: async (base) => {
    const { historyLoaded, historyLoading, sending } = get()
    // 发送中不覆盖当前消息；已经加载过就不重复拉取（StrictMode 下 effect 会跑两遍）
    if (historyLoaded || historyLoading || sending) return

    set({ historyLoading: true })
    try {
      const data = await fetchHistory(base, get().sessionId)
      const items = Array.isArray(data.items) ? data.items : []
      set({
        messages: [WELCOME_MESSAGE, ...items.map(historyItemToMessage)],
        historyLoaded: true
      })
    } catch {
      // 与原页面一致：历史拉取失败静默忽略，不影响当前提问
    } finally {
      set({ historyLoading: false })
    }
  },

  send: async (base, text, options) => {
    const query = (text || '').trim()
    if (!query || get().sending) return

    const sessionId = get().sessionId
    const botId = createLocalId('bot')

    set((state) => ({
      sending: true,
      notice: '',
      messages: [
        ...state.messages,
        {
          id: createLocalId('user'),
          role: 'user',
          text: query,
          images: [],
          time: nowTime(),
          status: 'done',
          waiting: false,
          progress: null,
          progressOpen: false,
          error: ''
        },
        {
          id: botId,
          role: 'bot',
          text: '',
          images: [],
          time: nowTime(),
          status: 'pending',
          waiting: true,
          progress: { done: [], running: [], status: 'pending' },
          progressOpen: true,
          error: ''
        }
      ]
    }))

    try {
      const data = await submitQuery(base, {
        query,
        sessionId,
        isStream: options.isStream,
        webSearchProvider: options.webSearchProvider
      })

      // ---- 非流式：/query 已经把答案、错误、图片一并返回 ----
      if (!options.isStream) {
        const finalStatus = data.error ? 'failed' : data.status || 'completed'
        set((state) => ({
          sending: false,
          messages: patchMessage(state.messages, botId, (message) => ({
            ...message,
            waiting: false,
            progressOpen: false,
            progress: {
              done: data.done_list || [],
              running: data.running_list || [],
              status: finalStatus
            },
            text: data.error ? '' : data.answer || '',
            images: data.error ? [] : data.image_urls || [],
            status: data.error ? 'error' : 'done',
            error: data.error ? `抱歉，本次处理失败：\n${data.error}` : ''
          }))
        }))
        return
      }

      // ---- 流式：先重置进度面板，再订阅 SSE ----
      set((state) => ({
        messages: patchMessage(state.messages, botId, (message) => ({
          ...message,
          progress: { done: [], running: [], status: 'pending' },
          progressOpen: true
        }))
      }))

      const streamSessionId = data.session_id || sessionId
      if (streamSessionId !== sessionId) set({ sessionId: streamSessionId })

      activeStream?.close()
      activeBotId = botId
      activeStream = openQueryStream(base, streamSessionId, {
        onProgress: (payload: SseEventPayload) => {
          const completed = payload.status === 'completed'
          set((state) => ({
            // 后端可能没发 final 就结束，这里提前解锁发送按钮，避免按钮一直禁用
            sending: completed ? false : state.sending,
            messages: patchMessage(state.messages, botId, (message) => ({
              ...message,
              waiting: completed ? false : message.waiting,
              progress: {
                done: payload.done_list || [],
                running: payload.running_list || [],
                status: payload.status || 'pending'
              }
            }))
          }))
        },

        onDelta: (delta: string) => {
          set((state) => ({
            messages: patchMessage(state.messages, botId, (message) => ({
              ...message,
              text: message.text + delta,
              status: 'streaming',
              waiting: false
            }))
          }))
        },

        onFinal: (payload: SseEventPayload) => {
          activeStream = null
          activeBotId = null
          set((state) => ({
            sending: false,
            messages: patchMessage(state.messages, botId, (message) => ({
              ...message,
              // 流式增量里没有【图片】段，最终包才是完整答案，优先用它
              text:
                typeof payload.answer === 'string' && payload.answer.trim().length > 0
                  ? payload.answer
                  : message.text,
              images: payload.image_urls || [],
              status: 'done',
              waiting: false,
              progressOpen: false
            }))
          }))
        },

        onError: (message: string) => {
          activeStream = null
          activeBotId = null
          set((state) => ({
            sending: false,
            messages: patchMessage(state.messages, botId, (prev) => ({
              ...prev,
              // 已经流出来的内容保留，只在后面追加错误说明
              text: prev.text ? `${prev.text}\n\n（错误：${message}）` : `（错误：${message}）`,
              status: 'error',
              waiting: false,
              progressOpen: false
            }))
          }))
        }
      })
    } catch (error) {
      // 请求本身失败（后端没起、网络不通）：保留进度面板，方便展开看走到哪一步
      set((state) => ({
        sending: false,
        messages: patchMessage(state.messages, botId, (message) => ({
          ...message,
          status: 'error',
          waiting: false,
          error: `请求失败：${errorText(error)}`
        }))
      }))
    }
  },

  cancelStream: () => {
    if (!activeStream) return
    const botId = activeBotId
    activeStream.close()
    activeStream = null
    activeBotId = null
    set((state) => ({
      sending: false,
      notice: '已停止接收本次回答（后端仍可能继续处理）',
      messages: botId
        ? patchMessage(state.messages, botId, (message) => ({
            ...message,
            text: message.text ? `${message.text}\n\n（已停止生成）` : '（已停止生成）',
            status: 'done',
            waiting: false,
            progressOpen: false
          }))
        : state.messages
    }))
  },

  setProgressOpen: (messageId, open) => {
    set((state) => {
      const target = state.messages.find((message) => message.id === messageId)
      // details 的 toggle 事件在 React 写入 open 属性时也会触发一次，
      // 值没变就直接返回原 state，避免多余的重渲染
      if (!target || target.progressOpen === open) return state
      return {
        messages: patchMessage(state.messages, messageId, (message) => ({
          ...message,
          progressOpen: open
        }))
      }
    })
  },

  clearAll: async (base) => {
    const sessionId = get().sessionId
    let result: ClearResult = { ok: true }
    try {
      await clearHistory(base, sessionId)
    } catch (error) {
      result = { ok: false, message: `服务端清空失败，仅清空本地显示：${errorText(error)}` }
    }

    // 换一个新 session id：旧会话在 Mongo 里已清空/清理失败，继续复用会把它再写回来
    activeStream?.close()
    activeStream = null
    activeBotId = null
    set({
      sessionId: renewSessionId(),
      messages: [WELCOME_MESSAGE],
      sending: false,
      historyLoaded: true,
      notice: result.ok ? '' : result.message || ''
    })
    return result
  },

  dismissNotice: () => set({ notice: '' })
}))
