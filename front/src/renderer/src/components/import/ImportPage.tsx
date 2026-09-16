/**
 * 文件导入页。
 *
 * 对应 backend/web/page/import.html + import.js：
 *   - 拖拽 / 点击选择 PDF、MD
 *   - 每个文件独立上传进度 + 任务节点进度（轮询 /status/{task_id}）
 *
 * 顶部左上角是「返回对话」，这是导入页唯一的出口（应用打开时是对话页）。
 */
import { useMemo } from 'react'

import DropZone from './DropZone'
import FileTaskItem from './FileTaskItem'
import SettingsButton from '../SettingsButton'
import { useImportBase } from '../../stores/selectors'
import { useImportStore } from '../../stores/importStore'
import { useSystemStore } from '../../stores/systemStore'
import { useUiStore } from '../../stores/uiStore'

function ImportPage(): React.JSX.Element {
  const importBase = useImportBase()
  const tasks = useImportStore((state) => state.tasks)
  const addFiles = useImportStore((state) => state.addFiles)
  const toggleLog = useImportStore((state) => state.toggleLog)
  const clearFinished = useImportStore((state) => state.clearFinished)
  const importOnline = useSystemStore((state) => state.importOnline)
  const setView = useUiStore((state) => state.setView)

  const stats = useMemo(() => {
    const running = tasks.filter((t) => t.status === 'uploading' || t.status === 'processing').length
    const failed = tasks.filter((t) => t.status === 'error').length
    const finished = tasks.filter((t) => t.status === 'completed').length
    return { running, failed, finished }
  }, [tasks])

  const serviceLabel =
    importOnline === null ? '导入服务：检测中' : importOnline ? '导入服务：已连接' : '导入服务：未连接'

  return (
    <div className="import-page">
      <div className="container">
        <header className="import-header">
          <button
            className="btn btn-soft"
            type="button"
            title="回到知识库问答"
            onClick={() => setView('chat')}
          >
            ← 返回对话
          </button>
          <h1>📄 知识库文件导入</h1>
          <span className={`pill ${importOnline ? 'pill-online' : ''}`}>{serviceLabel}</span>
          <SettingsButton compact />
        </header>

        <DropZone disabled={importOnline === false} onFiles={(files) => void addFiles(files, importBase)} />

        {tasks.length > 0 && (
          <div className="list-toolbar">
            <span className="list-stats">
              共 {tasks.length} 个文件 · 处理中 {stats.running} · 已完成 {stats.finished} · 失败{' '}
              {stats.failed}
            </span>
            <button
              className="btn btn-ghost"
              type="button"
              onClick={clearFinished}
              disabled={stats.running === tasks.length}
            >
              清空已结束
            </button>
          </div>
        )}

        <div className="file-list">
          {tasks.map((task) => (
            <FileTaskItem key={task.id} task={task} onToggleLog={toggleLog} />
          ))}
        </div>
      </div>
    </div>
  )
}

export default ImportPage
