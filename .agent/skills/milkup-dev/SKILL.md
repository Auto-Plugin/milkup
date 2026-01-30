---
name: milkup-dev
description: >
  milkup 项目开发环境管理专家，深入了解项目的技术栈（Electron + Vue 3 + Milkdown + TypeScript）、
  架构设计和开发工作流。负责启动开发服务器、运行 Electron 应用、热重载调试等开发任务。
license: MIT
compatibility: Designed for Claude Code
allowed-tools: Bash Read Grep Glob
metadata:
  version: "2.0.0"
  category: "development"
  status: "active"
  updated: "2026-01-30"
  user-invocable: "true"
  tags: "milkup, electron, vue3, milkdown, typescript, vite, development"
  related-skills: "milkup-build, milkup-lint, moai-framework-electron"
---

# milkup 开发环境工具

## 快速参考

milkup-dev 是专门为 milkup 项目设计的开发环境管理工具，深入了解项目的技术栈和架构。

milkup 是一个现代化的桌面端 Markdown 编辑器，基于 Electron 37+ 构建，使用 Vue 3 作为前端框架，
Milkdown 作为编辑器核心，支持所见即所得（WYSIWYG）和源码编辑双模式。

自动触发：当用户请求启动开发环境、运行应用、进行开发调试或询问技术栈相关问题时。

### 技术栈概览

核心框架：

- Electron 37+ - 桌面应用框架（Chromium 130 + Node.js 20.18）
- Vue 3.5+ - 渐进式前端框架，使用 Composition API
- TypeScript 5.9+ - 类型安全的 JavaScript 超集，启用 strict 模式
- Vite 7+ - 下一代前端构建工具，提供极速的 HMR

编辑器核心：

- Milkdown 7.17+ - 基于 ProseMirror 的插件化 Markdown 编辑器
- @milkdown/crepe - Milkdown 的所见即所得（WYSIWYG）模式
- @milkdown/kit - Milkdown 完整插件套件
- CodeMirror 6 - 源码编辑模式的代码编辑器
- Vditor 3.11+ - 额外的 Markdown 编辑功能支持

构建工具链：

- Vite - 渲染进程构建和开发服务器
- esbuild - 主进程和预加载脚本的快速构建
- vite-plugin-electron - Electron 与 Vite 的集成插件
- electron-builder - 多平台应用打包工具

国际化与工具：

- vite-auto-i18n-plugin - 自动国际化翻译插件
- oxlint - 快速的 JavaScript/TypeScript 代码检查工具
- oxfmt - 快速的代码格式化工具
- simple-git-hooks - 轻量级 Git 钩子管理

UI 与增强：

- @vueuse/core - Vue 组合式 API 工具集
- vue-draggable-plus - 拖拽功能支持
- autodialog.js - 对话框管理
- autotoast.js - 通知提示管理
- mermaid - 图表渲染支持

### 项目架构

进程架构：

milkup 遵循 Electron 的多进程架构。主进程（Main Process）运行在 Node.js 环境中，
负责窗口管理、文件系统访问、IPC 通信处理和系统集成。渲染进程（Renderer Process）
运行在 Chromium 中，负责 UI 渲染和用户交互，通过预加载脚本（Preload Script）
与主进程进行安全的 IPC 通信。

目录结构：

```
src/
├── main/           # 主进程代码
│   ├── index.ts    # 主进程入口，窗口创建和生命周期管理
│   ├── ipcBridge/  # IPC 通信处理器
│   ├── menu/       # 应用菜单定义
│   └── update/     # 自动更新逻辑
├── renderer/       # 渲染进程代码（Vue 应用）
│   ├── App.vue     # 根组件
│   ├── main.ts     # 渲染进程入口
│   ├── components/ # Vue 组件
│   │   ├── editor/       # 编辑器组件（Milkdown、CodeMirror）
│   │   ├── workspace/    # 工作区和标签页管理
│   │   ├── outline/      # 文档大纲导航
│   │   ├── menu/         # 菜单栏和状态栏
│   │   ├── settings/     # 设置页面
│   │   ├── dialogs/      # 对话框组件
│   │   └── ui/           # 通用 UI 组件
│   ├── hooks/      # Vue 组合式函数
│   ├── services/   # 业务逻辑服务
│   ├── plugins/    # Milkdown 插件
│   ├── styles/     # 样式文件
│   └── utils/      # 工具函数
├── preload.ts      # 预加载脚本，暴露安全的 API 给渲染进程
├── shared/         # 主进程和渲染进程共享的类型和常量
├── types/          # TypeScript 类型定义
├── themes/         # 主题系统
├── plugins/        # 应用级插件
└── config/         # 配置文件
```

双窗口系统：

milkup 实现了双窗口架构。主窗口（Main Window）是主要的编辑器界面，
包含编辑器、工作区、大纲和菜单栏。主题编辑器窗口（Theme Editor Window）
是一个独立的模态窗口，用于自定义和编辑主题样式。两个窗口通过 IPC 通信
共享状态和数据。

路径别名配置：

项目配置了三个路径别名以简化导入：
- `@/` - 指向 `src/` 目录，用于访问所有源代码
- `@renderer/` - 指向 `src/renderer/` 目录，用于渲染进程代码
- `@ui/` - 指向 `src/renderer/components/ui/` 目录，用于 UI 组件

### 核心功能特性

编辑器模式：

milkup 支持两种编辑模式的无缝切换。所见即所得模式（WYSIWYG）使用 Milkdown
的 Crepe 主题，提供类似 Typora 的即时渲染体验。源码模式使用 CodeMirror 6，
提供语法高亮、代码折叠和 Markdown 语法支持。两种模式共享同一份文档数据，
切换时保持光标位置和滚动状态。

文件管理：

应用支持多文件标签页管理，可以同时打开多个 Markdown 文件。工作区面板
显示文件树，支持文件夹展开/折叠和文件拖拽。文件关联功能允许双击 .md 文件
直接在 milkup 中打开。支持通过命令行参数启动时打开指定文件。

自定义协议：

实现了 `milkup://` 自定义协议用于加载本地图片。协议格式为
`milkup:///<base64-encoded-markdown-path>/<relative-image-path>`，
解决了 Electron 中加载相对路径图片的安全限制问题。主进程注册协议处理器，
将相对路径解析为绝对路径并返回文件内容。

主题系统：

支持多主题切换和自定义主题编辑。主题文件使用 Less 编写，支持变量和嵌套。
主题编辑器提供可视化界面，可以实时预览主题效果。支持主题导入导出，
方便分享和备份。

国际化支持：

使用 vite-auto-i18n-plugin 实现自动国际化。支持中文、英文、日文、韩文、
俄文和法文。翻译文件自动生成，开发时只需编写中文文本，构建时自动翻译
为其他语言。

### 常用命令

启动开发服务器：
```bash
pnpm run dev
```
此命令会依次执行：
1. 构建预加载脚本（esbuild）
2. 构建主进程代码（esbuild）
3. 启动 Vite 开发服务器
4. 自动启动 Electron 应用（通过 vite-plugin-electron）

启动 Electron 应用：
```bash
pnpm run start:electron
```
此命令用于单独启动 Electron 应用，不启动 Vite 开发服务器。

构建主进程：
```bash
pnpm run build:main
```

构建预加载脚本：
```bash
pnpm run build:preload
```

---

## 实现指南

### 开发环境设置

环境要求：

开发 milkup 需要以下环境：
- Node.js >= 20.17.0（项目使用 Node.js 20.18 的特性）
- pnpm >= 10.0.0（项目使用 pnpm 10.12.1）
- Git（用于版本控制）
- 支持的操作系统：Windows、macOS 或 Linux

依赖安装：

首次克隆项目后，执行 `pnpm install` 安装所有依赖。项目配置了 preinstall
钩子，会检查是否使用 pnpm，如果使用其他包管理器会报错。安装过程中会自动
执行 simple-git-hooks 的 prepare 脚本，安装 Git 钩子。

开发服务器启动流程：

执行 `pnpm run dev` 后的完整流程：

1. esbuild 构建预加载脚本（src/preload.ts → dist-electron/preload.js）
2. esbuild 构建主进程代码（src/main/index.ts → dist-electron/main/index.js）
3. Vite 启动开发服务器，监听 src/renderer 目录
4. vite-plugin-electron 自动启动 Electron 主进程
5. 主进程创建 BrowserWindow，加载 Vite 开发服务器的 URL
6. 渲染进程加载 Vue 应用，初始化 Milkdown 编辑器
7. 开发模式下自动打开 DevTools

环境变量：

开发模式下，vite-plugin-electron 会设置 `VITE_DEV_SERVER_URL` 环境变量，
主进程通过此变量判断是否为开发模式。开发模式下加载 Vite 开发服务器的 URL，
生产模式下加载本地 HTML 文件。

### 编辑器集成详解

Milkdown 集成：

Milkdown 是基于 ProseMirror 的插件化 Markdown 编辑器。项目使用 @milkdown/vue
提供的 Vue 组件集成。编辑器配置包括：
- @milkdown/preset-commonmark - CommonMark 规范支持
- @milkdown/preset-gfm - GitHub Flavored Markdown 支持
- @milkdown/plugin-prism - 代码块语法高亮
- @milkdown/plugin-diagram - Mermaid 图表支持
- @milkdown/plugin-listener - 编辑器事件监听
- @milkdown/plugin-automd - 自动 Markdown 格式化

Milkdown 编辑器组件位于 src/renderer/components/editor/MilkdownEditor.vue。
编辑器实例通过 Vue 的 provide/inject 机制在组件树中共享，允许其他组件
访问编辑器 API 进行内容操作。

CodeMirror 集成：

CodeMirror 6 用于源码编辑模式。配置包括：
- @codemirror/lang-markdown - Markdown 语法支持
- @codemirror/autocomplete - 自动补全
- @codemirror/commands - 编辑器命令
- codemirror-lang-mermaid - Mermaid 语法支持

CodeMirror 编辑器组件位于 src/renderer/components/editor/MarkdownSourceEditor.vue。
编辑器状态通过 @codemirror/state 管理，视图通过 @codemirror/view 渲染。

编辑器模式切换：

两种编辑器模式共享同一份 Markdown 文本数据。切换时，当前编辑器的内容
会保存到共享状态中，然后新编辑器从共享状态加载内容。使用防抖机制避免
频繁切换导致的性能问题。

### IPC 通信模式

安全通信架构：

milkup 遵循 Electron 安全最佳实践。渲染进程启用 contextIsolation，
禁用 nodeIntegration。预加载脚本使用 contextBridge.exposeInMainWorld
暴露安全的 API 给渲染进程。渲染进程通过 window.electronAPI 访问主进程功能。

IPC 通信类型：

项目使用三种 IPC 通信模式：

1. invoke/handle 模式 - 用于请求-响应通信。渲染进程调用 ipcRenderer.invoke，
   主进程通过 ipcMain.handle 注册处理器并返回结果。适用于文件读写、
   对话框显示等需要返回值的操作。

2. send/on 模式 - 用于单向通信。渲染进程调用 ipcRenderer.send 发送消息，
   主进程通过 ipcMain.on 监听。适用于通知类操作，不需要返回值。

3. webContents.send 模式 - 主进程主动向渲染进程发送消息。用于文件打开、
   窗口关闭确认等主进程发起的操作。

IPC 处理器组织：

主进程的 IPC 处理器分为三类，位于 src/main/ipcBridge/ 目录：
- 全局处理器 - 不依赖窗口实例的处理器
- Handle 处理器 - 需要返回值的请求-响应处理器
- On 处理器 - 单向消息处理器

### 热重载机制

渲染进程热重载：

Vite 提供的 HMR（Hot Module Replacement）支持渲染进程的热重载。
修改 Vue 组件、样式文件或 TypeScript 代码时，Vite 会通过 WebSocket
推送更新，浏览器端的 HMR 客户端接收更新并替换模块，无需刷新整个页面。

Vue 组件的热重载由 @vitejs/plugin-vue 处理，支持保持组件状态。
修改组件模板或脚本时，只重新渲染受影响的组件，保持应用状态不变。

主进程热重载：

vite-plugin-electron 监听主进程和预加载脚本的文件变化。检测到变化时，
自动重新构建并重启 Electron 进程。这个过程会关闭当前窗口并创建新窗口，
因此会丢失应用状态。

为了减少主进程重启的影响，建议将业务逻辑尽量放在渲染进程，主进程只
处理必要的系统集成和 IPC 通信。

### 调试技巧

渲染进程调试：

开发模式下，应用启动时会自动打开 Chrome DevTools。也可以通过快捷键
Ctrl+Shift+I（macOS: Cmd+Option+I）或全局快捷键 Ctrl+Shift+I 打开。

DevTools 提供完整的调试功能：
- Console 面板 - 查看日志输出和执行 JavaScript 代码
- Sources 面板 - 设置断点、单步调试、查看调用栈
- Elements 面板 - 检查 DOM 结构和样式
- Network 面板 - 监控网络请求（虽然桌面应用较少使用）
- Performance 面板 - 性能分析和火焰图
- Memory 面板 - 内存分析和泄漏检测

Vue DevTools 集成：

可以安装 Vue DevTools 浏览器扩展的独立版本用于调试 Vue 应用。
在 DevTools 中可以查看组件树、组件状态、Vuex/Pinia 状态、事件追踪等。

主进程调试：

主进程运行在 Node.js 环境中，可以使用 Node.js 调试器。有两种方式：

1. VS Code 调试配置 - 在 .vscode/launch.json 中配置调试配置，
   设置 Electron 可执行文件路径和启动参数，可以在 VS Code 中
   直接设置断点调试主进程代码。

2. 远程调试 - 使用 --inspect 或 --inspect-brk 标志启动 Electron，
   然后在 Chrome 中访问 chrome://inspect 连接调试器。

日志输出策略：

主进程的 console.log 输出到终端，渲染进程的 console.log 输出到 DevTools。
建议使用不同的日志前缀区分不同模块，例如 `[main]`、`[renderer]`、`[ipc]` 等。

对于复杂的调试场景，可以使用 electron-log 库统一管理日志，支持日志级别、
文件输出和格式化。

Vue 组件调试：

在 Vue 组件中可以使用以下技巧：
- 使用 `console.log` 在生命周期钩子中输出状态
- 使用 Vue DevTools 查看组件的 props、data 和 computed
- 使用 `debugger` 语句设置断点
- 使用 `watchEffect` 追踪响应式数据变化

Milkdown 调试：

Milkdown 编辑器的调试较为复杂，因为涉及 ProseMirror 的内部状态。
可以通过以下方式调试：
- 使用 @milkdown/plugin-listener 监听编辑器事件
- 访问编辑器实例的 `ctx` 对象查看插件状态
- 使用 ProseMirror DevTools 查看文档结构和事务

### 故障排查

常见开发问题：

**端口占用**：
Vite 默认使用 5173 端口。如果端口被占用，Vite 会自动尝试下一个端口。
检查终端输出确认实际使用的端口号。如果需要固定端口，在 vite.config.mts
中配置 `server.port`。

**白屏问题**：
如果应用启动后显示白屏，按以下步骤排查：
1. 打开 DevTools 查看 Console 是否有错误信息
2. 检查 Network 面板确认资源是否正确加载
3. 确认预加载脚本路径正确（dist-electron/preload.js）
4. 检查主进程终端输出是否有错误
5. 确认 Vite 开发服务器正常运行

**热重载失效**：
如果修改代码后页面没有更新：
1. 确认 Vite 开发服务器正常运行，检查终端是否有错误
2. 检查修改的文件是否在 Vite 监听的目录范围内（src/renderer）
3. 尝试手动刷新页面（Ctrl+R 或 Cmd+R）
4. 检查是否有语法错误导致 HMR 失败
5. 重启开发服务器

**IPC 通信失败**：
如果渲染进程无法调用主进程功能：
1. 确认预加载脚本正确暴露了 API（使用 contextBridge）
2. 检查 IPC 通道名称是否匹配
3. 确认主进程已注册对应的处理器
4. 检查 contextIsolation 是否正确启用
5. 在 DevTools Console 中检查 window.electronAPI 是否存在

**编辑器加载失败**：
如果 Milkdown 或 CodeMirror 编辑器无法正常显示：
1. 检查编辑器组件是否正确挂载
2. 确认编辑器样式文件已正确导入
3. 检查 Console 是否有插件加载错误
4. 确认编辑器容器元素存在且有正确的尺寸
5. 检查是否有 CSS 冲突影响编辑器样式

**构建失败**：
如果 esbuild 或 Vite 构建失败：
1. 检查 TypeScript 类型错误
2. 确认所有导入路径正确
3. 检查是否有循环依赖
4. 确认 node_modules 完整安装
5. 尝试删除 node_modules 和 pnpm-lock.yaml 重新安装

**主题不生效**：
如果自定义主题没有应用：
1. 检查主题文件路径是否正确
2. 确认 Less 文件语法正确
3. 检查主题变量是否正确覆盖
4. 确认主题文件已在入口文件中导入
5. 清除缓存并重新构建

### 开发工作流

典型开发流程：

1. **启动开发环境**
   - 执行 `pnpm run dev` 启动开发服务器
   - 等待 Electron 应用自动启动
   - 确认 DevTools 已打开

2. **功能开发**
   - 在 src/renderer 中修改 Vue 组件或添加新组件
   - 保存文件后查看 HMR 自动更新效果
   - 使用 DevTools 调试和验证功能

3. **主进程开发**
   - 修改 src/main 中的主进程代码
   - 保存后等待 Electron 自动重启
   - 在终端查看主进程日志输出

4. **IPC 通信开发**
   - 在 src/main/ipcBridge 中添加 IPC 处理器
   - 在 src/preload.ts 中暴露 API
   - 在渲染进程中通过 window.electronAPI 调用
   - 使用 TypeScript 类型确保类型安全

5. **样式调整**
   - 修改 Less 文件或组件样式
   - 使用 DevTools Elements 面板实时调试样式
   - 保存后查看 HMR 更新效果

6. **代码检查**
   - 定期执行 `pnpm run lint` 检查代码质量
   - 执行 `pnpm run format` 自动格式化代码
   - Git 提交前会自动运行 lint-staged

7. **测试验证**
   - 在开发环境中测试功能
   - 执行 `pnpm run build` 构建生产版本
   - 执行 `pnpm run start:electron` 测试构建产物

最佳实践：

- 使用 TypeScript 类型系统避免类型错误
- 遵循 Vue 3 Composition API 最佳实践
- 保持组件单一职责，避免过大的组件
- 使用 Vue 组合式函数（hooks）复用逻辑
- IPC 通信使用类型安全的接口定义
- 主进程代码保持简洁，业务逻辑放在渲染进程
- 使用路径别名简化导入语句
- 定期运行代码检查和格式化
- 提交前确保代码通过 lint 检查

---

## 使用示例

### 启动开发环境

基本启动：
```bash
# 安装依赖（首次或依赖更新后）
pnpm install

# 启动开发服务器和 Electron 应用
pnpm run dev
```

应用会自动启动，DevTools 会自动打开。终端会显示 Vite 开发服务器的地址
和构建信息。

单独构建主进程：
```bash
# 只构建主进程代码
pnpm run build:main

# 只构建预加载脚本
pnpm run build:preload
```

### 开发新功能

添加新的 Vue 组件：
```bash
# 在 src/renderer/components 中创建新组件
# 使用路径别名导入
import MyComponent from '@renderer/components/MyComponent.vue'
```

添加新的 IPC 通信：
```typescript
// 1. 在 src/main/ipcBridge 中添加处理器
ipcMain.handle('my-channel', async (event, arg) => {
  // 处理逻辑
  return result
})

// 2. 在 src/preload.ts 中暴露 API
contextBridge.exposeInMainWorld('electronAPI', {
  myFunction: (arg) => ipcRenderer.invoke('my-channel', arg)
})

// 3. 在渲染进程中调用
const result = await window.electronAPI.myFunction(arg)
```

### 调试场景

调试渲染进程：
```bash
# 启动开发环境
pnpm run dev

# DevTools 会自动打开
# 在 Sources 面板设置断点
# 在 Console 面板执行代码
```

调试主进程：
```bash
# 方式 1: 使用 VS Code 调试配置
# 在 .vscode/launch.json 中配置后，按 F5 启动调试

# 方式 2: 使用 --inspect 标志
# 修改 package.json 的 dev 脚本添加 --inspect
# 然后在 Chrome 中访问 chrome://inspect
```

### 测试构建

构建并测试：
```bash
# 完整构建
pnpm run build

# 启动构建后的应用
pnpm run start:electron
```

这会加载 dist 目录中的构建产物，而不是 Vite 开发服务器。
用于验证生产构建是否正常工作。

---

## 配合使用

- **milkup-build** - 构建生产版本和打包应用
- **milkup-lint** - 代码质量检查和格式化
- **milkup-release** - 版本发布和更新日志生成
- **moai-framework-electron** - Electron 开发最佳实践和高级模式

---

## 技术资源

配置文件：
- vite.config.mts - Vite 和 Electron 插件配置
- tsconfig.json - TypeScript 编译配置
- package.json - 依赖和脚本配置

关键文件：
- src/main/index.ts - 主进程入口，窗口管理和生命周期
- src/preload.ts - 预加载脚本，IPC API 暴露
- src/renderer/main.ts - 渲染进程入口，Vue 应用初始化
- src/renderer/App.vue - 根组件，应用布局

编辑器组件：
- src/renderer/components/editor/MilkdownEditor.vue - Milkdown 编辑器
- src/renderer/components/editor/MarkdownSourceEditor.vue - CodeMirror 编辑器

官方文档：
- Electron 文档: https://www.electronjs.org/docs
- Vue 3 文档: https://vuejs.org/
- Vite 文档: https://vitejs.dev/
- Milkdown 文档: https://milkdown.dev/
- CodeMirror 文档: https://codemirror.net/

---

Version: 2.0.0
Last Updated: 2026-01-30
Changes: 添加完整的技术栈说明、架构详解、开发工作流和调试指南
