/**
 * 由设置推导出的接口地址。
 *
 * 单独放在这里而不是塞进组件，是因为「设置 → 地址 → 请求」这条链路
 * 对话页和导入页都要用，集中一处避免两边算得不一样。
 */
import { useMemo } from 'react'

import { resolveApiBase } from '../api/base'
import { useSettingsStore } from './settingsStore'

/** 查询服务 base url（如 http://127.0.0.1:8001） */
export function useQueryBase(): string {
  return useSettingsStore((state) => resolveApiBase(state.queryPort, state.host))
}

/** 导入服务 base url（如 http://127.0.0.1:8000） */
export function useImportBase(): string {
  return useSettingsStore((state) => resolveApiBase(state.importPort, state.host))
}

/** 一次拿到两个服务的地址，供设置面板展示 */
export function useEffectiveEndpoints(): { queryBase: string; importBase: string } {
  const queryBase = useQueryBase()
  const importBase = useImportBase()
  return useMemo(() => ({ queryBase, importBase }), [queryBase, importBase])
}
