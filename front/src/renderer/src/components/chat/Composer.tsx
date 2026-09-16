/**
 * 输入区。
 *
 * 迁移自 chat.js 的 composer：Enter 发送、Shift+Enter 换行。
 * 额外加了「停止」——RAG 流程冷启动可能跑很久，能中断比只能干等更实用。
 */
import { useEffect, useRef, useState } from 'react'

interface ComposerProps {
  /** 是否有请求在飞 */
  sending: boolean
  /** 页面是否可见（切走时不要抢焦点） */
  active: boolean
  onSend: (text: string) => void
  onStop: () => void
}

function Composer({ sending, active, onSend, onStop }: ComposerProps): React.JSX.Element {
  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // 对应原页面的 setTimeout(() => inputEl.focus(), 200)
  useEffect(() => {
    if (!active) return
    const timer = setTimeout(() => inputRef.current?.focus(), 200)
    return () => clearTimeout(timer)
  }, [active])

  const submit = (): void => {
    const text = value.trim()
    if (!text || sending) return
    setValue('')
    onSend(text)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  return (
    <div className="composer">
      <textarea
        ref={inputRef}
        value={value}
        placeholder="请输入问题（Enter 发送，Shift+Enter 换行）"
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
      />
      {sending ? (
        <button className="send stop" type="button" onClick={onStop}>
          停止
        </button>
      ) : (
        <button className="send" type="button" onClick={submit} disabled={value.trim().length === 0}>
          发送
        </button>
      )}
    </div>
  )
}

export default Composer
