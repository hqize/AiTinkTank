// 纯浏览器开发模式(npm run dev:react)下的 preload 替身。
//
// Electron 环境里 window.electron 由 preload 脚本(contextBridge)注入,
// 本模块检测到后直接跳过、不做任何事;
// 只有在普通浏览器打开渲染层(没有 preload 可执行)时,
// 才注入一个"最小可用"的替身,保证模板页面能正常渲染、交互不报错。
//
// 注意:这里所有的 IPC 都是假实现,仅用于 UI 开发。
// 需要真实主进程能力(文件、窗口、系统 API 等)时,请运行 npm run dev 联调。

function installBrowserFallbacks(): void {
  if (window.electron) {
    return
  }

  const logFakeIpc = (name: string, channel: string, args: unknown[]): void => {
    console.warn(`[browser-dev] ${name}('${channel}') 为假实现,已忽略(真实调用请用 npm run dev)`, ...args)
  }

  const ipcRenderer: Window['electron']['ipcRenderer'] = {
    send: (channel, ...args) => logFakeIpc('ipcRenderer.send', channel, args),
    sendSync: (channel, ...args) => logFakeIpc('ipcRenderer.sendSync', channel, args),
    sendToHost: (channel, ...args) => logFakeIpc('ipcRenderer.sendToHost', channel, args),
    postMessage: (channel, ...args) => logFakeIpc('ipcRenderer.postMessage', channel, args),
    invoke: (channel, ...args) => {
      logFakeIpc('ipcRenderer.invoke', channel, args)
      return Promise.resolve(undefined)
    },
    on: (channel) => {
      console.warn(`[browser-dev] ipcRenderer.on('${channel}') 为假实现,不会收到任何事件`)
      return () => {}
    },
    once: (channel) => {
      console.warn(`[browser-dev] ipcRenderer.once('${channel}') 为假实现,不会收到任何事件`)
      return () => {}
    },
    removeAllListeners: () => {},
    removeListener: function () {
      return this
    },
    // 自 Electron 28 起已移除,仅为满足类型声明补上空实现
    sendTo: () => {}
  }

  const webFrame: Window['electron']['webFrame'] = {
    insertCSS: () => 'browser-dev-fallback',
    setZoomFactor: () => {},
    setZoomLevel: () => {}
  }

  const webUtils: Window['electron']['webUtils'] = {
    getPathForFile: () => ''
  }

  // 展示真实浏览器信息,替代 Electron/Node 版本号(浏览器模式下不存在)
  const chromeVersion = /Chrome\/([\d.]+)/.exec(navigator.userAgent)?.[1] ?? '非 Chromium 内核'

  const process: Window['electron']['process'] = {
    platform: 'browser',
    env: {},
    versions: {
      electron: '— (浏览器模式)',
      node: '— (浏览器模式)',
      chrome: chromeVersion
    }
  }

  window.electron = { ipcRenderer, webFrame, webUtils, process }
}

export { installBrowserFallbacks }
