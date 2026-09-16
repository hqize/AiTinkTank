/**
 * 答案文本 → (正文, 图片列表) 的解析。
 *
 * 迁移自 backend/web/page/chat.js 里的 isImageUrl / normalizeUrl /
 * dedupeKeepOrder / extractUrlsLoose / parseAnswerAndImages / renderAnswerWithImages。
 *
 * 后端答案的约定：正文后面可能跟一段「【图片】」标记，标记之后每行一个图片 URL；
 * 同时接口还会单独回一个 image_urls 候选数组。两者都要兼容（并集，避免漏图）。
 */

const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|bmp|svg)$/i

/** 宽松判断是不是图片地址（兼容 URL 后面带 ? # 参数、或非法字符导致 new URL 失败的情况） */
export function isImageUrl(url: string): boolean {
  const raw = String(url || '')
  if (!raw) return false
  try {
    return IMAGE_EXT_RE.test(new URL(raw).pathname)
  } catch {
    return /\.(png|jpe?g|gif|webp|bmp|svg)(\?|#|$)/i.test(raw)
  }
}

/** 把空格编码掉，避免直接塞进 img src 时请求失败 */
export function normalizeUrl(rawUrl: string): string {
  const s = String(rawUrl || '').trim()
  if (!s) return ''
  return s.replace(/\s/g, '%20')
}

/** 去重并保持原有顺序 */
export function dedupeKeepOrder(arr: unknown[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of Array.isArray(arr) ? arr : []) {
    const value = String(item || '')
    if (!value || seen.has(value)) continue
    seen.add(value)
    out.push(value)
  }
  return out
}

/** 从任意文本里宽松提取 http(s) 链接（会去掉首尾混入的标点） */
export function extractUrlsLoose(text: string): string[] {
  const s = String(text || '')
  const matches = s.match(/https?:\/\/[^\s]+/g) || []

  const trimTailPunct = (u: string): string => u.replace(/[)\]}'">，。,;；\]】）＞]+$/g, '')
  const trimHeadPunct = (u: string): string => u.replace(/^[<([{'"]+|^[＜（【[]+/g, '')

  const urls: string[] = []
  for (const m of matches) {
    const u = trimHeadPunct(trimTailPunct(m))
    if (u) urls.push(u)
  }
  return dedupeKeepOrder(urls)
}

/** 找最后一个「【图片】/ [图片]」标记的位置（正文与图片列表的分界） */
function findLastImageMarkerIndex(raw: string): { idx: number; len: number } {
  const re = /【\s*图片\s*】|\[\s*图片\s*\]/g
  let m: RegExpExecArray | null
  let idx = -1
  let len = 0
  while ((m = re.exec(raw)) !== null) {
    idx = m.index
    len = m[0].length
  }
  return { idx, len }
}

/** 把「【图片】」标记之后的文本按行拆成图片 URL 列表 */
function parseAnswerAndImages(text: string): { text: string; images: string[] } {
  const raw = String(text || '')
  const { idx, len } = findLastImageMarkerIndex(raw)
  if (idx === -1) return { text: raw, images: [] }

  const before = raw.slice(0, idx).trimEnd()
  const after = raw.slice(idx + len).trim()

  const urls: string[] = []
  for (const line of after.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)) {
    if (line.startsWith('http://') || line.startsWith('https://')) {
      // 优先按"每行一个 URL"解析，允许 URL 里包含空格
      urls.push(line)
    } else {
      urls.push(...extractUrlsLoose(line))
    }
  }

  const seen = new Set<string>()
  const images: string[] = []
  for (const u of urls) {
    const normalized = normalizeUrl(u)
    if (!isImageUrl(normalized) || seen.has(normalized)) continue
    seen.add(normalized)
    images.push(normalized)
  }
  return { text: before, images }
}

/**
 * 汇总「最终要展示的正文 + 图片」。
 *
 * 优先级取并集：正文里的「【图片】」块 > 接口返回的候选 image_urls > 正文中零散出现的图片链接，
 * 只要后端给了候选图就展示（答案没写"如图"时用户同样需要看图）。
 *
 * @param answerText 后端返回的答案原文
 * @param candidateImageUrls 接口返回的 image_urls
 */
export function resolveAnswerContent(
  answerText: string,
  candidateImageUrls?: string[] | null
): { text: string; images: string[] } {
  const { text, images: imagesFromBlock } = parseAnswerAndImages(answerText)

  const candidates = Array.isArray(candidateImageUrls)
    ? candidateImageUrls.map(normalizeUrl).filter(isImageUrl)
    : []
  const looseImages = extractUrlsLoose(answerText).map(normalizeUrl).filter(isImageUrl)

  const all = new Set<string>([...imagesFromBlock, ...candidates, ...looseImages])
  return { text, images: Array.from(all) }
}
