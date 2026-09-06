// 启动 electron-vite 前清理 ELECTRON_RUN_AS_NODE 环境变量。
// 该变量一旦存在(无论值为何)electron 就会以纯 Node 模式运行,
// 导致主进程里 require('electron').app 不可用(app.isPackaged 报错)。
// 某些开发环境(终端/IDE)会注入此变量,这里统一清除以保证可复现。
import { spawn } from 'node:child_process'

delete process.env.ELECTRON_RUN_AS_NODE

const command = process.argv[2] // 'dev' | 'preview'
if (!command) {
  console.error('用法: node scripts/run.mjs <dev|preview>')
  process.exit(1)
}

const child = spawn('electron-vite', [command], { stdio: 'inherit', shell: true })
child.on('exit', (code) => process.exit(code ?? 0))
child.on('error', (err) => {
  console.error('启动 electron-vite 失败:', err)
  process.exit(1)
})
