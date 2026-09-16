# RAG 智库客服 · 桌面客户端

由 `backend/web/page/`（原生 HTML + CSS + JS 的网页版）迁移而来的 **Electron + React + TypeScript** 客户端。
两个网页（对话 / 导入）合并为单窗口双视图：**启动即进入对话页**，顶部的「📄 导入」按钮跳到导入页，
导入页左上角的「← 返回对话」再回到问答。客户端状态统一交给 **zustand** 管理。

> 项目整体架构、后端两条流水线、接口清单与前后端契约见仓库根目录的 [README.md](../README.md)。

## 快速开始

包管理器统一用 pnpm（`packageManager: pnpm@10.34.5`，`package.json` 里的脚本
全部通过 `pnpm run ...` 串联，不依赖 npm）。

```bash
pnpm install

# 桌面端（Electron 主进程 + 渲染层，带 HMR）
pnpm run dev

# 只跑渲染层，用浏览器调 UI（没有 preload，window.electron 由 browser-fallback 兜底）
pnpm run dev:react

# 类型检查 / 代码检查
pnpm run typecheck
pnpm run lint

# 构建（产物在 out/）
pnpm run build

# 打包安装程序（详见「打包与分发」一节）
pnpm run build:win      # Windows 安装包 → dist/tinkTank-1.0.0-setup.exe
pnpm run build:unpack   # 只出免安装目录 → dist/win-unpacked/（快速验证用）
```

> pnpm 10 起 `package.json` 里的 `"pnpm"` 字段不再被读取，
> 所以 `onlyBuiltDependencies`（允许 electron / esbuild 执行安装脚本）放在
> `pnpm-workspace.yaml`；单包项目用它当配置文件即可，无需声明 `packages`。

后端要先跑起来，否则顶栏会显示「API: 未连接」：

```bash
cd backend
python web/api/query_service.py    # 查询服务 8001
python web/api/import_service.py   # 导入服务 8000
```

## 与网页版的对应关系

| 网页版 | 桌面端 |
| --- | --- |
| `chat.html` / `chat.css` / `chat.js` | `src/renderer/src/components/chat/*` + `stores/chatStore.ts` |
| `import.html` / `import.css` / `import.js` | `src/renderer/src/components/import/*` + `stores/importStore.ts` |
| 两个独立页面（两个端口各挂一份） | `components/AppShell.tsx` 内的视图切换（`stores/uiStore.ts`）：默认 `chat`，由顶部「导入」/「返回对话」按钮切换 |
| `localStorage` 裸键（会话 id、联网实现） | `zustand/persist`（`kb-front-settings`）+ 会话 id 仍复用 `kb_session_id` |
| 手写 `insertAdjacentHTML` / 局部 DOM 更新 | 不可变 state + 组件渲染 |

## 目录结构

```
src/
├─ main/index.ts               Electron 主进程（窗口、外链交给系统浏览器）
├─ preload/                    contextBridge 暴露 electronAPI
└─ renderer/src/
   ├─ App.tsx                  入口组件
   ├─ components/
   │  ├─ AppShell.tsx          外壳：工作区 + 健康探测 + 窗口关闭前的定时器清理
   │  ├─ SettingsButton.tsx    顶栏的设置入口（对话页 / 导入页共用）
   │  ├─ SettingsPanel.tsx     后端主机名 + 端口，显示运行环境版本
   │  ├─ chat/                 ChatPage / MessageItem / AnswerContent / ProgressPanel / Composer / TypingDots
   │  └─ import/               ImportPage / DropZone / FileTaskItem
   ├─ stores/                  zustand：chatStore / importStore / settingsStore / systemStore / uiStore / selectors
   ├─ api/                     types.ts（接口契约）/ base.ts（地址解析）/ queryApi.ts / importApi.ts
   ├─ utils/                   answer.ts（答案→正文+图片）/ format.ts / session.ts / storage.ts
   └─ assets/main.css          合并自 chat.css + import.css，并补上桌面端外壳样式
```

## 状态管理（zustand）

| store | 职责 |
| --- | --- |
| `chatStore` | 消息列表、会话 id、SSE 生命周期、发送/停止/清空 |
| `importStore` | 上传任务列表、上传进度、`/status` 轮询、清空已结束任务 |
| `settingsStore` | 主机名 / 两个端口 / 流式开关 / 联网实现，`persist` 到本地 |
| `systemStore` | 两个后端的连通性探测 |
| `uiStore` | 当前视图（`chat` 为默认/首页）、设置抽屉开合 |

约定：

- **组件只读 state、只调 action**，不做命令式 DOM 操作。
- 定时器、`EventSource` 这类命令式资源放在 `store` 模块作用域（`pollTimers` / `activeStream`），不参与渲染。
- 派生值（接口地址）走 `stores/selectors.ts`，避免两处各算一遍。

## 接口地址解析规则

`api/base.ts` 的 `resolveApiBase(port, overrideHost)` 兼容三种运行方式：

1. 页面由该服务自己提供（浏览器直接访问 `chat.html` / `import.html`）→ 同源相对路径；
2. 页面被别的端口打开（Vite dev server :5173）→ 指向同一主机的服务端口；
3. Electron 打包后从 `file://` 加载 → 兜底到 `127.0.0.1`。

设置面板里填了主机名就完全以它为准（默认端口 8001 / 8000），方便连局域网或远端部署的后端。

> 导入服务没有 `/health`，存活探测用的是 `GET /status/__probe__`：
> 按后端约定「未知 task_id 返回 200 且不落库」，正好可当探针。

## 打包与分发

```bash
pnpm run build:win      # Windows：安装程序（NSIS）
pnpm run build:unpack   # 只生成免安装目录，用来快速验证
pnpm run build:mac      # 只能在 macOS 上跑
pnpm run build:linux    # 建议在 Linux / Docker 里跑
```

产物都在 `dist/`（已 gitignore）：

| 产物 | 说明 |
| --- | --- |
| `dist/tinkTank-1.0.0-setup.exe` | 安装程序，文件名 = `nsis.artifactName` 的 `${name}-${version}-setup`，`${name}` 取 `package.json` 的 `name` |
| `dist/tinkTank-1.0.0-setup.exe.blockmap` | 增量更新用的块索引 |
| `dist/win-unpacked/` | 免安装版目录，可执行文件名由 `win.executableName` 决定（当前 `thinkTank.exe`） |
| `dist/win-unpacked/resources/app.asar` | 打包后的应用代码（`asarUnpack` 的 `resources/**` 解压在旁边的 `app.asar.unpacked/`） |
| `dist/builder-debug.yml` | 本次生效的完整配置快照，排查打包问题时先看它 |

**让用户自选安装目录**：`electron-builder.yml` 里

```yaml
nsis:
  oneClick: false                           # 关掉一键静默安装，走交互式向导
  allowToChangeInstallationDirectory: true  # 关键：向导里出现"选择安装目录"页
```

两个键必须同时给——NSIS 模板 `assistedInstaller.nsh` 里，目录选择页包在
`!ifdef allowToChangeInstallationDirectory` 中，而这份模板只在 `oneClick: false` 时才会被选用。

**应用图标放哪**：`build/`（由 `directories.buildResources` 指定），文件名用默认约定即可：

| 文件 | 用途 | 要求 | 仓库现状 |
| --- | --- | --- | --- |
| `build/icon.ico` | Windows 应用 + 安装程序图标 | ≥ 256×256 | ✅ 已有 |
| `build/icon.icns` | macOS 图标 | — | ❌ 缺失，mac 打包会用 Electron 默认图标 |
| `build/icon.png` | Linux 图标 | 建议 ≥ 512×512 | ❌ 缺失，Linux 打包会用默认图标 |
| `build/installerIcon.ico` / `uninstallerIcon.ico` | 可选，单独指定安装/卸载程序图标 | 不给就用应用图标 | — |

缺失某个平台的图标**不会导致打包失败**，只是日志里会出现 `default Electron icon is used` 警告并退回 Electron 默认图标。
注意运行时窗口图标是另一个文件：`resources/icon.png`（`src/main/index.ts` 用 `?asset` 引用）。

macOS 的权限声明（entitlements）当前**不指定**，electron-builder 会用它自带的默认模板；
需要额外权限时再放 `build/entitlements.mac.plist` 并打开 `mac.entitlementsInherit`——
这个键是显式路径、不做存在性检查，文件不存在会让 mac 签名直接失败。

**国内网络**：打包要向网上下两样东西，镜像已写进 `.npmrc`，用 `pnpm run build:win` 会自动生效
（原理：`pnpm run` 会把 `.npmrc` 的键导出成 `npm_config_<键名>` 环境变量，而 electron-builder 优先读这些名字）：

```ini
electron_mirror=https://npmmirror.com/mirrors/electron/                                # Electron 运行时
electron_builder_binaries_mirror=https://npmmirror.com/mirrors/electron-builder-binaries/  # winCodeSign / nsis
```

只有绕开 pnpm（`npx electron-builder`、直接 `node node_modules/electron-builder/cli.js`）时才需要手动设
`ELECTRON_MIRROR` / `ELECTRON_BUILDER_BINARIES_MIRROR` 环境变量。

## 相比网页版的行为差异

| 变化 | 原因 |
| --- | --- |
| 输入框为空时发送按钮禁用 | 明确不可发送；请求进行中按钮变为「停止」 |
| 新增「停止」 | RAG 全流程（含模型冷启动）可能跑很久，能中断比只能干等实用 |
| 打字动画在首个增量到达后立即消失 | 原实现会在流式文本旁边一直显示三个跳动圆点 |
| 清空对话改为两步确认，并换新 `session_id` | 少一个阻塞式 `confirm()`；换 id 可避免已清空的上下文被继续复用 |
| 清空/停止等结果用顶部提示条展示 | 替代 `alert()` |
| 历史只在成功后标记已加载 | 后端临时不可用时切回对话页还能重试 |

## 验证情况

迁移后用「假后端 + 隐藏窗口 Electron」做过端到端冒烟：

- 启动落在对话页；「📄 导入」跳转导入页、「← 返回对话」回到问答
- 历史记录加载（含参考图片渲染）、`API: 已连接` 探活
- 流式提问：`停止` 出现 → 进度面板「已完成1，进行中1，状态：处理中」→ 最终「已完成3，状态：已完成」且自动收起 → 答案与图片渲染 → 按钮复位
- 非流式提问：一次性返回答案与进度
- 导入：拖拽高亮 → 上传 → 轮询「处理中 48%」→「已完成 100%」，日志节点名规范化正确
- 设置抽屉：地址解析为 `http://127.0.0.1:8001` / `8000`，运行环境版本正常
- 清空对话：两步确认后只剩欢迎语
- `pnpm run dev:react`（浏览器模式）：`browser-fallback` 生效、跨端口接口调用正常
- 打包：`pnpm run build:win` 完整跑通，产出 `dist/tinkTank-1.0.0-setup.exe`；
  解包校验 `app.asar` 内含 `out/**`、`node_modules/@electron-toolkit/*`、`zustand`，
  且 `src/`、配置文件已排除（main 进程是运行时 `require` 这些依赖的，所以 `files` 不能改成只写 `out/**` 的白名单）

## 说明

- `backend/web/page/` 下的网页版**保持原样保留**：后端两个服务都通过
  `StaticFiles(directory=PAGE_DIR)` 挂载该目录，删掉目录会导致服务启动失败。
  桌面端只复用接口契约，不依赖这些静态文件。
- 开发模式下 Electron 会打印 *Insecure Content-Security-Policy* 警告（打包后不再出现）。
  当前没有设置 CSP，是因为 Vite 的 HMR 需要内联脚本，而参考图片来自任意 http(s) 地址；
  如需收紧，建议在打包环境由主进程通过响应头下发，而不是写进 `index.html`。
- **命名现状**：`appId: com.ithuq.aiThinkTank`、`productName: ThinkTank`、`win.executableName: thinkTank`，
  而 `package.json` 的 `name` 是 `tinkTank`（安装包文件名取自它）。三处大小写不一致，
  想统一的话把 `nsis.artifactName` 里的 `${name}` 换成 `${productName}`，或把三处写成同一套。
- **`pnpm run dev` 报 `Cannot read properties of undefined (reading 'isPackaged')`**：
  这是环境里被注入了 `ELECTRON_RUN_AS_NODE`（Electron 会退化成纯 Node 运行，
  `require('electron').app` 因此不存在）。`scripts/run.mjs` 已尝试清除该变量，
  若仍复现，直接在启动前清掉：`Remove-Item Env:ELECTRON_RUN_AS_NODE`（PowerShell）。
