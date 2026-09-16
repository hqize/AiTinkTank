/**
 * 文件导入页状态机。
 *
 * 迁移自 backend/web/page/import.js：原版是「一个文件项 = 一段 DOM + 一个 setInterval」，
 * 这里换成「任务列表 state + store 内部统一轮询」，组件卸载后轮询不会泄漏。
 *
 * 进度条口径与原实现完全一致：
 *   上传阶段占 0~20%，节点处理阶段占 20~95%（按已完成节点数推进），完成时 100%。
 */
import { create } from 'zustand'

import { fetchTaskStatus, isAllowedFile, uploadWithProgress, ALLOWED_EXTENSIONS } from '../api/importApi'
import { createLocalId } from '../utils/format'

/** 轮询间隔（ms） */
const POLL_INTERVAL_MS = 2000
/** 最多轮询次数（约 30 分钟），避免异常时无限轮询 */
const MAX_POLL_TIMES = 900

/** 上传阶段占进度条的比例上限 */
const UPLOAD_PHASE_MAX = 20
/** 节点处理阶段占进度条的比例上限 */
const PROCESS_PHASE_MAX = 95
/** 图中节点总数：上传阶段 1 个 + 图中 7 个（MD 文件跳过 PDF 转 Markdown 属正常偏差） */
const PROCESS_NODE_TOTAL = 8

/** uploading=上传中；processing=排队/处理中；completed/error=终态 */
export type ImportTaskStatus = 'uploading' | 'processing' | 'completed' | 'error'

export interface ImportTask {
  /** 前端本地 id，用作 React key 与轮询索引 */
  id: string
  /** 后端任务 id，上传成功后才会有 */
  taskId: string
  fileName: string
  fileSize: number
  status: ImportTaskStatus
  /** 0~100 */
  progress: number
  doneList: string[]
  runningList: string[]
  /** 失败原因 */
  error: string
  /** 日志面板是否展开 */
  logOpen: boolean
}

export interface ImportState {
  tasks: ImportTask[]
  /** 是否有任务在上传/处理（用于统计展示） */
  addFiles: (files: File[], base: string) => Promise<void>
  toggleLog: (id: string, open: boolean) => void
  /** 清空已结束（已完成/失败）的任务项 */
  clearFinished: () => void
  /** 停止所有轮询（页面卸载时调用） */
  stopAllPolling: () => void
}

/**
 * 轮询定时器：localId → intervalId。
 *
 * 放在 store 外面，因为定时器句柄不参与渲染，也不该触发重渲染。
 */
const pollTimers = new Map<string, ReturnType<typeof setInterval>>()

/** 后端返回的节点名可能已带"已完成"，这里统一补全 */
export function normalizeDoneLog(text: string): string {
  if (typeof text !== 'string') return String(text)
  return text.endsWith('已完成') ? text : `${text}已完成`
}

/** 后端返回的节点名可能已带"正在进行"，这里统一补全 */
export function normalizeRunningLog(text: string): string {
  if (typeof text !== 'string') return String(text)
  if (text.startsWith('正在进行')) return text.endsWith('...') ? text : `${text}...`
  return `正在进行${text}...`
}

export const useImportStore = create<ImportState>()((set, get) => {
  /** 局部更新一个任务 */
  const patchTask = (id: string, patch: Partial<ImportTask>): void => {
    set((state) => ({
      tasks: state.tasks.map((task) => (task.id === id ? { ...task, ...patch } : task))
    }))
  }

  /** 停掉某个任务的轮询 */
  const stopPolling = (id: string): void => {
    const timer = pollTimers.get(id)
    if (timer !== undefined) {
      clearInterval(timer)
      pollTimers.delete(id)
    }
  }

  /** 失败收尾：进度条填满变红 + 状态置失败 + 日志展开 */
  const finishWithError = (id: string, message: string, doneList?: string[]): void => {
    stopPolling(id)
    patchTask(id, {
      status: 'error',
      progress: 100,
      error: message,
      logOpen: true,
      ...(doneList ? { doneList, runningList: [] } : {})
    })
  }

  /** 轮询单个任务的处理进度 */
  const startPolling = (id: string, taskId: string, base: string): void => {
    stopPolling(id)
    let pollTimes = 0

    const timer = setInterval(async () => {
      pollTimes += 1
      if (pollTimes > MAX_POLL_TIMES) {
        finishWithError(id, '轮询超时，任务可能已被中断（如后端服务重启），请刷新页面后重新上传')
        return
      }

      try {
        const data = await fetchTaskStatus(base, taskId)
        const done = Array.isArray(data.done_list) ? data.done_list : []
        const running = Array.isArray(data.running_list) ? data.running_list : []

        if (data.status === 'completed') {
          stopPolling(id)
          patchTask(id, { status: 'completed', progress: 100, doneList: done, runningList: [], error: '' })
          return
        }

        if (data.status === 'failed') {
          finishWithError(id, data.error || '未知错误', done)
          return
        }

        if (data.status === 'pending' || data.status === 'processing') {
          // 进度按已完成节点数推进，不会倒退
          const processed =
            UPLOAD_PHASE_MAX + (done.length / PROCESS_NODE_TOTAL) * (PROCESS_PHASE_MAX - UPLOAD_PHASE_MAX)
          patchTask(id, {
            status: 'processing',
            doneList: done,
            runningList: running,
            progress: Math.min(PROCESS_PHASE_MAX, processed)
          })
          return
        }

        // status 为空：后端不认识这个 task_id（例如服务重启后内存状态丢失），继续轮询没有意义
        if (!data.status) {
          finishWithError(id, '未查询到该任务（后端可能已重启），请刷新页面后重新上传')
        }
      } catch (error) {
        // 单次轮询失败（网络抖动、后端重启中）不终止轮询，等下一次
        console.error('Polling error', error)
      }
    }, POLL_INTERVAL_MS)

    pollTimers.set(id, timer)
  }

  /** 单个文件：校验 → 上传（带真实进度）→ 轮询 */
  const uploadOne = async (file: File, base: string): Promise<void> => {
    const id = createLocalId('file')
    const task: ImportTask = {
      id,
      taskId: '',
      fileName: file.name,
      fileSize: file.size,
      status: 'uploading',
      progress: 0,
      doneList: [],
      runningList: [],
      error: '',
      logOpen: false
    }
    // 原页面用 afterbegin 插入，最新的文件排在最上面
    set((state) => ({ tasks: [task, ...state.tasks] }))

    // 1. 前端先做类型校验，避免把不支持的文件传上去再等后端报错
    if (!isAllowedFile(file)) {
      finishWithError(id, `不支持的文件类型，仅支持 ${ALLOWED_EXTENSIONS.join(' / ')}`)
      return
    }

    // 2. 上传文件（带真实进度）
    let taskId = ''
    try {
      const result = await uploadWithProgress(base, file, (percent) => {
        patchTask(id, { progress: (percent / 100) * UPLOAD_PHASE_MAX })
      })
      taskId = (result.task_ids || [])[0] || ''
      if (!taskId) throw new Error('后端未返回 task_id')
    } catch (error) {
      finishWithError(id, error instanceof Error ? error.message : String(error))
      return
    }

    // 3. 上传完成，进入处理中，开始轮询节点状态
    patchTask(id, { taskId, status: 'processing', progress: UPLOAD_PHASE_MAX })
    startPolling(id, taskId, base)
  }

  return {
    tasks: [],

    addFiles: async (files, base) => {
      // 逐个上传（与原页面 forEach(uploadFile) 一致），互不阻塞
      await Promise.all(files.map((file) => uploadOne(file, base)))
    },

    toggleLog: (id, open) => patchTask(id, { logOpen: open }),

    clearFinished: () => {
      const finished = get().tasks.filter((task) => task.status === 'completed' || task.status === 'error')
      for (const task of finished) stopPolling(task.id)
      set((state) => ({
        tasks: state.tasks.filter((task) => task.status !== 'completed' && task.status !== 'error')
      }))
    },

    stopAllPolling: () => {
      for (const id of Array.from(pollTimers.keys())) stopPolling(id)
    }
  }
})
