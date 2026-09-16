/**
 * 设置抽屉：后端地址 + 运行环境信息。
 *
 * 网页版把接口地址写死在代码里（同源 / 本机 8000、8001），
 * 桌面端把主机名和端口提出来，方便连局域网/远端部署的后端。
 */
import { useEffect, useState } from 'react'

import { DEFAULT_IMPORT_PORT, DEFAULT_QUERY_PORT, defaultHost } from '../api/base'
import { useEffectiveEndpoints } from '../stores/selectors'
import { useSettingsStore } from '../stores/settingsStore'
import { useUiStore } from '../stores/uiStore'
import { isPersistentStorageAvailable } from '../utils/storage'

/** 运行环境版本号（浏览器调试模式下由 browser-fallback 提供占位值） */
function runtimeVersions(): Array<{ label: string; value: string }> {
  const versions = window.electron?.process?.versions
  if (!versions) return []
  return [
    { label: 'Electron', value: versions.electron ?? '—' },
    { label: 'Chromium', value: versions.chrome ?? '—' },
    { label: 'Node', value: versions.node ?? '—' }
  ]
}

function SettingsPanel(): React.JSX.Element | null {
  const open = useUiStore((state) => state.settingsOpen)
  const closeSettings = useUiStore((state) => state.closeSettings)

  const host = useSettingsStore((state) => state.host)
  const queryPort = useSettingsStore((state) => state.queryPort)
  const importPort = useSettingsStore((state) => state.importPort)
  const setHost = useSettingsStore((state) => state.setHost)
  const setQueryPort = useSettingsStore((state) => state.setQueryPort)
  const setImportPort = useSettingsStore((state) => state.setImportPort)
  const reset = useSettingsStore((state) => state.reset)

  const { queryBase, importBase } = useEffectiveEndpoints()

  // 端口用草稿态，失焦/回车才写回 store，避免输入过程中的中间值被立刻规范化
  const [draft, setDraft] = useState({
    host,
    queryPort: String(queryPort),
    importPort: String(importPort)
  })

  // Esc 关闭
  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') closeSettings()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, closeSettings])

  if (!open) return null

  /** 提交端口：store 会把非法值规范化，随后把规范化后的结果同步回草稿 */
  const commitPorts = (): void => {
    setQueryPort(Number(draft.queryPort))
    setImportPort(Number(draft.importPort))
    const saved = useSettingsStore.getState()
    setDraft({
      host: saved.host,
      queryPort: String(saved.queryPort),
      importPort: String(saved.importPort)
    })
  }

  const versions = runtimeVersions()

  return (
    <div className="drawer-layer">
      <div className="drawer-mask" onClick={closeSettings} />

      <aside className="drawer">
        <header className="drawer-header">
          <strong>设置</strong>
          <button className="drawer-close" type="button" onClick={closeSettings} aria-label="关闭">
            ×
          </button>
        </header>

        <div className="drawer-body">
          <section className="field-group">
            <div className="field-group-title">后端地址</div>
            <p className="field-hint">
              留空表示自动：Electron 下为本机 127.0.0.1，浏览器下为页面所在主机（{defaultHost()}）。
            </p>

            <label className="field">
              <span>主机名</span>
              <input
                type="text"
                value={draft.host}
                placeholder={`自动（${defaultHost()}）`}
                onChange={(e) => {
                  setDraft((prev) => ({ ...prev, host: e.target.value }))
                  setHost(e.target.value)
                }}
              />
            </label>

            <label className="field">
              <span>查询服务端口</span>
              <input
                type="text"
                inputMode="numeric"
                value={draft.queryPort}
                placeholder={String(DEFAULT_QUERY_PORT)}
                onChange={(e) => setDraft((prev) => ({ ...prev, queryPort: e.target.value }))}
                onBlur={commitPorts}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitPorts()
                }}
              />
            </label>

            <label className="field">
              <span>导入服务端口</span>
              <input
                type="text"
                inputMode="numeric"
                value={draft.importPort}
                placeholder={String(DEFAULT_IMPORT_PORT)}
                onChange={(e) => setDraft((prev) => ({ ...prev, importPort: e.target.value }))}
                onBlur={commitPorts}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitPorts()
                }}
              />
            </label>

            <div className="endpoint-list">
              <div>
                <span>查询接口</span>
                <code>{queryBase || '（同源）'}</code>
              </div>
              <div>
                <span>导入接口</span>
                <code>{importBase || '（同源）'}</code>
              </div>
            </div>

            <div className="drawer-actions">
              <button
                className="btn btn-ghost"
                type="button"
                onClick={() => {
                  reset()
                  setDraft({
                    host: '',
                    queryPort: String(DEFAULT_QUERY_PORT),
                    importPort: String(DEFAULT_IMPORT_PORT)
                  })
                }}
              >
                恢复默认
              </button>
            </div>
          </section>

          <section className="field-group">
            <div className="field-group-title">运行环境</div>
            {versions.length > 0 ? (
              <div className="endpoint-list">
                {versions.map((item) => (
                  <div key={item.label}>
                    <span>{item.label}</span>
                    <code>{item.value}</code>
                  </div>
                ))}
              </div>
            ) : (
              <p className="field-hint">非 Electron 环境（浏览器调试模式）。</p>
            )}
            {!isPersistentStorageAvailable && (
              <p className="field-hint warn">本地存储不可用，设置仅在本次运行内生效。</p>
            )}
          </section>
        </div>
      </aside>
    </div>
  )
}

export default SettingsPanel
