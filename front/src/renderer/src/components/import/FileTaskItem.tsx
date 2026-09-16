/**
 * 单个文件的上传 / 处理进度项。
 *
 * 迁移自 import.js 的 createFileItem + renderLogs + setProgressBar + setStatus，
 * DOM 操作换成 props 驱动的渲染。
 */
import { normalizeDoneLog, normalizeRunningLog } from '../../stores/importStore'
import type { ImportTask } from '../../stores/importStore'
import { formatFileSize } from '../../utils/format'

interface FileTaskItemProps {
  task: ImportTask
  onToggleLog: (id: string, open: boolean) => void
}

/** 状态 → 角标文案与样式 */
const STATUS_META: Record<ImportTask['status'], { text: string; className: string }> = {
  uploading: { text: '上传中...', className: 'status-uploading' },
  processing: { text: '处理中...', className: 'status-processing' },
  completed: { text: '已完成', className: 'status-completed' },
  error: { text: '失败', className: 'status-error' }
}

/** 进度条颜色：进行中橘色 / 完成绿色 / 失败红色（与 import.js 的常量一致） */
const PROGRESS_COLOR: Record<ImportTask['status'], string> = {
  uploading: '#f39c12',
  processing: '#f39c12',
  completed: '#2ecc71',
  error: '#e74c3c'
}

function FileTaskItem({ task, onToggleLog }: FileTaskItemProps): React.JSX.Element {
  const meta = STATUS_META[task.status]
  const percent = Math.max(0, Math.min(100, Math.round(task.progress)))

  const lines = [
    ...task.doneList.map(normalizeDoneLog),
    ...task.runningList.map(normalizeRunningLog)
  ]
  if (task.error) lines.push(`失败原因：${task.error}`)

  const summary = task.error
    ? `日志（已完成${task.doneList.length}，进行中${task.runningList.length}，失败，点击展开）`
    : `日志（已完成${task.doneList.length}，进行中${task.runningList.length}，点击展开）`

  return (
    <div className="file-item">
      <div className="file-info">
        <span className="file-name">{task.fileName}</span>
        <span className="file-size">{formatFileSize(task.fileSize)}</span>

        <div className="progress-bar-container">
          <div
            className="progress-bar"
            style={{ width: `${percent}%`, backgroundColor: PROGRESS_COLOR[task.status] }}
          />
        </div>

        <details
          className="log-details"
          open={task.logOpen}
          onToggle={(e) => onToggleLog(task.id, e.currentTarget.open)}
        >
          <summary>{summary}</summary>
          <ul className="log-list">
            {lines.length === 0 ? (
              <li>暂无日志</li>
            ) : (
              lines.map((line, index) => <li key={`${index}-${line}`}>{line}</li>)
            )}
          </ul>
        </details>
      </div>

      <div className={`status-badge ${meta.className}`}>{meta.text}</div>
    </div>
  )
}

export default FileTaskItem
