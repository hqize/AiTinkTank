/**
 * 导入服务（import_service.py，默认 8000）的接口封装。
 *
 * 迁移自 backend/web/page/import.js 里的 uploadWithProgress / pollStatus。
 */
import { joinUrl } from './base'
import type { TaskStatusResponse, UploadResponse } from './types'

/** 允许的文件类型，与后端 import_service.ALLOWED_SUFFIXES 保持一致 */
export const ALLOWED_EXTENSIONS = ['.pdf', '.md'] as const

/** 取小写扩展名（含点），没有扩展名时返回空串 */
export function getExtension(fileName: string): string {
  const name = String(fileName)
  const index = name.lastIndexOf('.')
  return index === -1 ? '' : name.slice(index).toLowerCase()
}

/** 前端先做一次类型校验，避免把不支持的文件传上去再等后端报错 */
export function isAllowedFile(file: File): boolean {
  return (ALLOWED_EXTENSIONS as readonly string[]).includes(getExtension(file.name))
}

/**
 * 用 XMLHttpRequest 上传：fetch 拿不到上传进度，XHR 的 upload.onprogress 可以。
 *
 * @param base 导入服务 base url
 * @param file 待上传文件
 * @param onProgress 上传进度回调，参数为 0~100
 */
export function uploadWithProgress(
  base: string,
  file: File,
  onProgress: (percent: number) => void
): Promise<UploadResponse> {
  return new Promise<UploadResponse>((resolve, reject) => {
    const formData = new FormData()
    formData.append('files', file)

    const xhr = new XMLHttpRequest()
    xhr.open('POST', joinUrl(base, '/upload'))

    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) onProgress((e.loaded / e.total) * 100)
    })

    xhr.addEventListener('load', () => {
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new Error(`上传失败，HTTP ${xhr.status}`))
        return
      }
      try {
        resolve(JSON.parse(xhr.responseText) as UploadResponse)
      } catch {
        reject(new Error('上传响应解析失败'))
      }
    })

    xhr.addEventListener('error', () => reject(new Error('上传请求失败，请确认后端服务已启动')))
    xhr.addEventListener('abort', () => reject(new Error('上传已中止')))

    xhr.send(formData)
  })
}

/** GET /status/{task_id} —— 轮询单个文件的处理进度 */
export async function fetchTaskStatus(base: string, taskId: string): Promise<TaskStatusResponse> {
  const res = await fetch(joinUrl(base, `/status/${encodeURIComponent(taskId)}`))
  if (!res.ok) throw new Error(`状态查询失败，HTTP ${res.status}`)
  return (await res.json()) as TaskStatusResponse
}
