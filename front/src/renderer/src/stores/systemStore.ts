/**
 * 后端连通性状态。
 *
 * 浏览器版的顶栏只测了查询服务的 /health。这里两个服务都测：
 *   - 查询服务：GET /health
 *   - 导入服务：GET /status/__probe__（导入服务没有 /health，
 *     但按后端约定"未知 task_id 返回 200 且不落库"，正好可以当存活探针用）
 */
import { create } from 'zustand'

import { resolveApiBase } from '../api/base'
import { fetchHealth } from '../api/queryApi'
import { fetchTaskStatus } from '../api/importApi'
import { useSettingsStore } from './settingsStore'

/** 探测导入服务用的假 task_id：后端对未知任务返回 200 且不创建记录 */
const IMPORT_PROBE_TASK_ID = '__probe__'

export interface SystemState {
  /** null 表示还没检测过 */
  queryOnline: boolean | null
  importOnline: boolean | null
  lastCheckedAt: number | null
  /** 立刻检测一次两个服务 */
  check: () => Promise<void>
}

export const useSystemStore = create<SystemState>()((set) => ({
  queryOnline: null,
  importOnline: null,
  lastCheckedAt: null,

  check: async () => {
    const { host, queryPort, importPort } = useSettingsStore.getState()
    const queryBase = resolveApiBase(queryPort, host)
    const importBase = resolveApiBase(importPort, host)

    const [queryResult, importResult] = await Promise.allSettled([
      fetchHealth(queryBase),
      fetchTaskStatus(importBase, IMPORT_PROBE_TASK_ID)
    ])

    set({
      queryOnline: queryResult.status === 'fulfilled',
      importOnline: importResult.status === 'fulfilled',
      lastCheckedAt: Date.now()
    })
  }
}))
