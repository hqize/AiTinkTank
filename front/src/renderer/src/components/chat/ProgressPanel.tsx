/**
 * 阶段进度面板。
 *
 * 迁移自 chat.js 的 renderProgress：文案、图标、状态映射保持一致。
 * 展开状态由 store 持有（等待中展开、收尾后收起），用户手动开合也写回 store，
 * 这样面板是纯粹受控的，不需要在组件里再存一份副本。
 */
import type { ChatProgress } from '../../stores/chatStore'

interface ProgressPanelProps {
  progress: ChatProgress
  /** store 里的展开状态 */
  open: boolean
  onToggle: (open: boolean) => void
}

/** 后端任务状态 → 中文展示 */
const STATUS_LABELS: Record<string, string> = {
  processing: '处理中',
  completed: '已完成',
  failed: '失败',
  pending: '等待中'
}

function ProgressPanel({ progress, open, onToggle }: ProgressPanelProps): React.JSX.Element {
  const done = Array.isArray(progress.done) ? progress.done : []
  const running = Array.isArray(progress.running) ? progress.running : []
  const statusLabel = STATUS_LABELS[progress.status] || progress.status || 'unknown'
  const lines = [...done.map((x) => `✅ ${x}`), ...running.map((x) => `⏳ ${x}`)]

  return (
    <details className="progress" open={open} onToggle={(e) => onToggle(e.currentTarget.open)}>
      <summary>{`阶段进度（已完成${done.length}，进行中${running.length}，状态：${statusLabel}）`}</summary>
      <ul>
        {lines.length === 0 ? (
          <li>暂无进度</li>
        ) : (
          lines.map((line, index) => <li key={`${index}-${line}`}>{line}</li>)
        )}
      </ul>
    </details>
  )
}

export default ProgressPanel
