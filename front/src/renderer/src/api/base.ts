/**
 * 接口地址解析。
 *
 * 迁移自 backend/web/page/*.js 里的 resolveApiBase，兼容三种打开方式：
 *   1) 页面由服务自己提供（浏览器直接访问 chat.html / import.html）→ 同源相对路径，局域网/域名访问都不用改
 *   2) 页面被别的端口打开（Vite dev server，5566/5173 之类）→ 指向同一主机的服务端口
 *   3) Electron 打包后从 file:// 加载 → 兜底到本机 127.0.0.1
 *
 * 不要写死 http://127.0.0.1:8001：局域网访问时它会指向访问者自己的机器。
 * Electron 里默认就是本机，所以额外允许在「设置」里显式覆盖主机名。
 */

/** 查询服务默认端口（query_service.py） */
export const DEFAULT_QUERY_PORT = 8001

/** 导入服务默认端口（import_service.py） */
export const DEFAULT_IMPORT_PORT = 8000

/** 页面所在主机名；file:// 或拿不到时退回本机回环地址 */
export function defaultHost(): string {
  if (typeof location === 'undefined') return '127.0.0.1'
  if (location.protocol === 'file:') return '127.0.0.1'
  return location.hostname || '127.0.0.1'
}

/**
 * 解析某个服务的 base url。
 *
 * @param port 服务端口
 * @param overrideHost 用户在设置里填写的主机名，留空表示自动推导
 */
export function resolveApiBase(port: number, overrideHost?: string): string {
  const customHost = (overrideHost || '').trim()

  // 页面本身就是这个服务提供的 → 走同源相对路径（浏览器直开场景）
  if (
    !customHost &&
    typeof location !== 'undefined' &&
    location.protocol !== 'file:' &&
    location.hostname !== '' &&
    location.port === String(port)
  ) {
    return ''
  }

  const host = customHost || defaultHost()
  const scheme = typeof location !== 'undefined' && location.protocol === 'file:' ? 'http:' : location.protocol
  const safeScheme = scheme === 'http:' || scheme === 'https:' ? scheme : 'http:'
  return `${safeScheme}//${host}:${port}`
}

/** 拼接完整接口地址（base 为空时就是相对路径） */
export function joinUrl(base: string, path: string): string {
  return `${base}${path}`
}
