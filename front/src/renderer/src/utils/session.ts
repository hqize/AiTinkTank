/**
 * 会话 id 的取得与保存。
 *
 * 沿用浏览器版的 localStorage 键名 kb_session_id：用户在网页版里积累的历史记录，
 * 换到 Electron 客户端后仍然能加载出来。
 */
import { safeStateStorage } from './storage'

const SESSION_KEY = 'kb_session_id'

/** 读会话 id；没有就生成一个并落盘 */
export function ensureSessionId(): string {
  const saved = safeStateStorage.getItem(SESSION_KEY)
  if (typeof saved === 'string' && saved.length > 0) return saved
  const created = `sess-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`
  safeStateStorage.setItem(SESSION_KEY, created)
  return created
}

/** 换一个全新的会话 id（清空对话时用，可避免把已删的历史又写回同一个 session） */
export function renewSessionId(): string {
  const created = `sess-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`
  safeStateStorage.setItem(SESSION_KEY, created)
  return created
}
