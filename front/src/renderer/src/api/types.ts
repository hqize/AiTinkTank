/**
 * 后端接口的数据结构定义。
 *
 * 与 backend/web/api 下的 Pydantic 模型 / 返回体一一对应，
 * 改动后端返回体时只需要动这里。
 */

/** 联网搜索实现，对应 query_service.QueryRequest.web_search_provider */
export type WebSearchProvider = 'mcp' | 'llm' | 'off'

/** GET /health */
export interface HealthResponse {
  ok: boolean
}

/** POST /query 的请求体 */
export interface QueryRequest {
  query: string
  session_id: string
  is_stream: boolean
  /** 空字符串表示"用后端环境变量的默认配置" */
  web_search_provider: string
}

/**
 * POST /query 的返回体。
 *
 * 流式时后端只返回 { message, session_id, web_search_provider }，
 * 因此除 session_id 外全部可选。
 */
export interface QueryResponse {
  message?: string
  session_id: string
  answer?: string
  image_urls?: string[]
  error?: string
  status?: string
  done_list?: string[]
  running_list?: string[]
  web_search_provider?: string
}

/** GET /history/{session_id} 中的单条记录 */
export interface HistoryItem {
  _id?: string
  session_id?: string
  role: string
  text?: string
  rewritten_query?: string
  item_names?: string[]
  image_urls?: string[]
  ts?: number
}

/** GET /history/{session_id} */
export interface HistoryResponse {
  session_id: string
  items: HistoryItem[]
}

/** DELETE /history/{session_id} */
export interface ClearHistoryResponse {
  message: string
  deleted_count: number
}

/** POST /upload */
export interface UploadResponse {
  code?: number
  message?: string
  task_ids?: string[]
}

/** 任务全局状态，对应 utils/task_utils 里的常量 */
export type TaskStatus = '' | 'pending' | 'processing' | 'completed' | 'failed'

/** GET /status/{task_id} */
export interface TaskStatusResponse {
  code?: number
  task_id?: string
  status?: TaskStatus
  done_list?: string[]
  running_list?: string[]
  error?: string
}

/** SSE 事件名，对应 utils/sse_utils.SSEEvent */
export type SseEventName = 'ready' | 'progress' | 'delta' | 'final' | 'final_answer' | 'error'

/** progress / final / error 事件的 data 结构（取并集，按事件类型取用） */
export interface SseEventPayload {
  /** progress：已完成节点 */
  done_list?: string[]
  /** progress：进行中节点 */
  running_list?: string[]
  /** progress：任务状态 */
  status?: string
  /** delta：本次增量文本 */
  delta?: string
  /** final / final_answer：完整答案 */
  answer?: string
  /** final / final_answer：候选图片 */
  image_urls?: string[]
  /** error：错误信息 */
  error?: string
}
