/**
 * 本地持久化的安全封装。
 *
 * Electron 打包后渲染层从 file:// 加载，个别环境下 localStorage 会直接抛
 * SecurityError（Chromium 对不透明源的策略），一旦抛错整个 store 初始化都会挂掉。
 * 这里统一 try/catch，并在不可用时退回内存实现：功能不丢，只是刷新后不再保留。
 */
import type { StateStorage } from 'zustand/middleware'

const memory = new Map<string, string>()

function probeLocalStorage(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null
    const probeKey = '__kb_probe__'
    localStorage.setItem(probeKey, '1')
    localStorage.removeItem(probeKey)
    return localStorage
  } catch {
    return null
  }
}

const backing = probeLocalStorage()

/** localStorage 是否可用（不可用时设置面板会提示"仅本次运行内生效"） */
export const isPersistentStorageAvailable = backing !== null

/** 供 zustand persist 使用的 storage（localStorage 不可用时自动退回内存） */
export const safeStateStorage: StateStorage = {
  getItem: (name) => {
    try {
      const value = backing ? backing.getItem(name) : (memory.get(name) ?? null)
      return value
    } catch {
      return memory.get(name) ?? null
    }
  },
  setItem: (name, value) => {
    memory.set(name, value)
    try {
      backing?.setItem(name, value)
    } catch {
      /* 配额满 / 隐私模式：内存里已经有值，忽略 */
    }
  },
  removeItem: (name) => {
    memory.delete(name)
    try {
      backing?.removeItem(name)
    } catch {
      /* 同上 */
    }
  }
}
