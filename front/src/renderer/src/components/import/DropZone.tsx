/**
 * 拖拽 / 点击上传区。
 *
 * 对应 import.html 的 .upload-area：点击触发隐藏的 file input，
 * 拖拽进入时高亮，松手后把文件交给 store。
 */
import { useRef, useState } from 'react'

interface DropZoneProps {
  /** 是否禁用（例如导入服务未连接） */
  disabled?: boolean
  /** 选中的文件（点击选择或拖拽松手） */
  onFiles: (files: File[]) => void
}

function DropZone({ disabled, onFiles }: DropZoneProps): React.JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  const pick = (): void => {
    if (!disabled) inputRef.current?.click()
  }

  const handleDrop = (e: React.DragEvent<HTMLDivElement>): void => {
    e.preventDefault()
    setDragging(false)
    if (disabled) return
    onFiles(Array.from(e.dataTransfer.files))
  }

  return (
    <div
      className={`upload-area${dragging ? ' drop-active' : ''}${disabled ? ' is-disabled' : ''}`}
      onClick={pick}
      onDragOver={(e) => {
        e.preventDefault()
        if (!disabled) setDragging(true)
      }}
      onDragLeave={(e) => {
        e.preventDefault()
        setDragging(false)
      }}
      onDrop={handleDrop}
    >
      <div className="upload-icon">☁️</div>
      <p>点击或拖拽文件到此处 (PDF/MD)</p>
      <p className="upload-sub">上传后自动进入解析 → 切分 → 向量化 → 入库流程</p>

      <input
        ref={inputRef}
        className="file-input"
        type="file"
        multiple
        accept=".pdf,.md"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? [])
          // 清空 value，保证连续选择同一个文件也能再次触发 change
          e.target.value = ''
          if (files.length > 0) onFiles(files)
        }}
      />
    </div>
  )
}

export default DropZone
