/**
 * 查询服务（query_service.py，默认 8001）的接口封装。
 *
 * 对应迁移自 backend/web/page/chat.js 里的 fetch / EventSource 调用，
 * 这里只负责"发请求 + 解析响应"，不持有任何 UI 状态。
 */
import { joinUrl } from './base'
import type {
  ClearHistoryResponse,
  HealthResponse,
  HistoryResponse,
  QueryRequest,
  QueryResponse,
  SseEventPayload,
  WebSearchProvider
} from './types'

/** 把非 2xx 响应转成带后端 message 的异常 */
async function throwHttpError(res: Response, fallback: string): Promise<never> {
  let detail = ''
  try {
    detail = (await res.text()).trim()
  } catch {
    detail = ''
  }
  throw new Error(detail || fallback)
}

/** GET /health —— 用于顶栏的「API: 已连接 / 未连接」 */
export async function fetchHealth(base: string): Promise<HealthResponse> {
  const res = await fetch(joinUrl(base, '/health'))
  if (!res.ok) throw new Error('health not ok')
  return (await res.json()) as HealthResponse
}

/** GET /history/{session_id} —— 拉取当前会话的历史消息 */
export async function fetchHistory(base: string, sessionId: string, limit = 50): Promise<HistoryResponse> {
  const res = await fetch(joinUrl(base, `/history/${encodeURIComponent(sessionId)}?limit=${limit}`))
  if (!res.ok) await throwHttpError(res, `历史记录加载失败，HTTP ${res.status}`)
  return (await res.json()) as HistoryResponse
}

/** DELETE /history/{session_id} —— 清空当前会话的历史记录 */
export async function clearHistory(base: string, sessionId: string): Promise<ClearHistoryResponse> {
  const res = await fetch(joinUrl(base, `/history/${encodeURIComponent(sessionId)}`), { method: 'DELETE' })
  if (!res.ok) await throwHttpError(res, `历史记录清空失败，HTTP ${res.status}`)
  return (await res.json()) as ClearHistoryResponse
}

/**
 * POST /query —— 提交问题。
 *
 * 流式时后端立刻返回 session_id，答案随后通过 /stream/{session_id} 推送；
 * 非流式时后端同步跑完整个图，一次性把答案 / 错误 / 图片返回。
 */
export async function submitQuery(
  base: string,
  payload: { query: string; sessionId: string; isStream: boolean; webSearchProvider: WebSearchProvider | '' }
): Promise<QueryResponse> {
  const body: QueryRequest = {
    query: payload.query,
    session_id: payload.sessionId,
    is_stream: payload.isStream,
    // 空字符串表示"用后端默认配置"（后端会回落到 WEB_SEARCH_PROVIDER 环境变量）
    web_search_provider: payload.webSearchProvider
  }

  const res = await fetch(joinUrl(base, '/query'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  if (!res.ok) await throwHttpError(res, '请求失败')
  return (await res.json()) as QueryResponse
}

/** 流式回调：与 chat.js 里的四个 addEventListener 一一对应 */
export interface QueryStreamHandlers {
  /** progress：节点进度变化 */
  onProgress: (payload: SseEventPayload) => void
  /** delta：答案增量 */
  onDelta: (delta: string) => void
  /** final / final_answer：最终完整答案 */
  onFinal: (payload: SseEventPayload) => void
  /** error：后端错误事件或 SSE 连接中断 */
  onError: (message: string) => void
}

/** 流式句柄：组件卸载 / 用户取消时调用 close() 释放连接 */
export interface QueryStreamHandle {
  close: () => void
}

/** 安全解析 SSE 的 data 字段（后端保证是 JSON，但坏数据不应该炸掉 UI） */
function parsePayload(event: Event): SseEventPayload {
  const data = (event as MessageEvent<string>).data
  if (typeof data !== 'string' || data.length === 0) return {}
  try {
    const parsed: unknown = JSON.parse(data)
    if (parsed && typeof parsed === 'object') return parsed as SseEventPayload
    return {}
  } catch {
    return {}
  }
}

/**
 * 打开 /stream/{session_id} 的 SSE 连接。
 *
 * 服务端推送 final 后会主动关闭连接，浏览器会再派发一次原生 error 事件，
 * 所以这里用 finished 标记区分"正常收尾后的断开"和"真的中断"，避免污染已渲染的答案。
 */
export function openQueryStream(
  base: string,
  sessionId: string,
  handlers: QueryStreamHandlers
): QueryStreamHandle {
  const es = new EventSource(joinUrl(base, `/stream/${encodeURIComponent(sessionId)}`))
  let finished = false
  let closed = false

  const close = (): void => {
    if (closed) return
    closed = true
    es.close()
  }

  const finish = (payload: SseEventPayload): void => {
    finished = true
    handlers.onFinal(payload)
    close()
  }

  es.addEventListener('progress', (e) => {
    handlers.onProgress(parsePayload(e))
  })

  es.addEventListener('delta', (e) => {
    const { delta } = parsePayload(e)
    if (delta) handlers.onDelta(delta)
  })

  es.addEventListener('final', (e) => {
    finish(parsePayload(e))
  })

  // 后端另有一个 final_answer 别名事件，语义与 final 相同（见 chat.js）
  es.addEventListener('final_answer', (e) => {
    finish(parsePayload(e))
  })

  es.addEventListener('error', (e) => {
    // 正常收尾后服务端主动断开：直接关闭，绝不能当成失败处理
    if (finished) {
      close()
      return
    }
    const payload = parsePayload(e)
    handlers.onError(payload.error || 'SSE 连接中断/失败')
    close()
  })

  return { close }
}
