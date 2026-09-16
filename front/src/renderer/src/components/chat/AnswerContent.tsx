/**
 * 答案正文 + 参考图片。
 *
 * 迁移自 chat.js 的 renderAnswerWithImages：正文里的「【图片】」标记段会被剥掉，
 * 图片来自三处并集（标记段 / 接口候选 image_urls / 正文里零散的图片链接）。
 *
 * 与 JS 版的区别：React 天然按文本渲染，不再需要手工 escapeHtml。
 */
import { useMemo } from 'react'

import { resolveAnswerContent } from '../../utils/answer'

interface AnswerContentProps {
  /** 后端答案原文（流式过程中是已累加的增量） */
  text: string
  /** 接口返回的候选图片 */
  images: string[]
  /** 正文为空时的占位文案 */
  placeholder?: string
}

function AnswerContent({ text, images, placeholder }: AnswerContentProps): React.JSX.Element {
  const { text: body, images: resolved } = useMemo(
    () => resolveAnswerContent(text, images),
    [text, images]
  )

  const trimmed = body.trim()
  const bodyText = trimmed.length > 0 ? body : (placeholder ?? '（已完成，但未返回答案）')

  return (
    <>
      <div className="answer-text">{bodyText}</div>

      {resolved.length > 0 && (
        <div className="answer-images">
          {resolved.map((url) => (
            <div className="answer-image" key={url}>
              <img
                loading="lazy"
                src={url}
                alt="参考图片"
                referrerPolicy="no-referrer"
                // 图裂了就直接隐藏，避免留一个破图占位（与原实现一致）
                onError={(e) => {
                  e.currentTarget.style.display = 'none'
                }}
              />
              {/* target=_blank 会被主进程的 setWindowOpenHandler 转交给系统浏览器打开 */}
              <a href={url} target="_blank" rel="noopener noreferrer">
                {url}
              </a>
            </div>
          ))}
        </div>
      )}
    </>
  )
}

export default AnswerContent
