/**
 * 时间与杂项格式化工具。
 *
 * 迁移自 backend/web/page/chat.js 的 nowTime / formatTime。
 */

/** 当前时间 HH:mm */
export function nowTime(): string {
  return new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

/**
 * 后端历史记录里的 ts 是「秒级时间戳」，转成 HH:mm。
 *
 * @param ts 秒级时间戳；缺失或非法时用当前时间兜底
 */
export function formatTime(ts?: number | null): string {
  if (!ts) return nowTime()
  const d = new Date(Number(ts) * 1000)
  if (Number.isNaN(d.getTime())) return nowTime()
  return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

/** 文件大小展示：与原先的 (size/1024).toFixed(2) + ' KB' 保持一致 */
export function formatFileSize(bytes: number): string {
  return `${(bytes / 1024).toFixed(2)} KB`
}

/** 生成本地唯一 id（仅用于 React key / DOM 定位，不需要全局唯一） */
export function createLocalId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 11)}${Date.now().toString(36)}`
}
