# milkup v2 产品架构文档

## 1. 背景与目标

milkup v2 的目标是构建一款 Typora 风格、全平台、可扩展、可处理大文件的 Markdown 编辑器。v2 不再围绕 ProseMirror、CodeMirror、remark 等第三方编辑器或 Markdown 解析内核构建，而是以自主可控的 Markdown 编辑器内核作为产品基础。

核心目标：

- 提供 Typora 风格的即时渲染编辑体验。
- Markdown 源码是唯一数据真相。
- 编辑器内核可独立运行在前端环境，不绑定 Tauri、DOM 框架或具体产品壳。
- 支持桌面端优先，后续扩展到 Web、移动端。
- 支持 CommonMark、GFM 以及可插拔 Markdown 扩展语法。
- 支持从小文件到 GB 级大文件的分级编辑能力。
- 支持运行时插件、主题、图床、导出、自定义渲染等扩展能力。

非目标：

- v2 初期不追求多人协作。
- v2 初期不追求完全替代 VS Code 级别的大文件源码编辑能力。
- v2 初期不实现完整插件市场，只实现插件协议和本地插件加载能力。
- v2 初期不做纯 Rust 原生 GUI，Tauri 作为桌面产品壳，Web 前端作为主渲染平台。

## 2. 总体架构

```text
milkup v2
├─ apps
│  └─ desktop                 # Tauri 桌面应用
├─ packages
│  ├─ core                    # 编辑器核心：文档、事务、选区、历史、命令
│  ├─ markdown                # 自研 Markdown CST/parser/stringifier
│  ├─ view-dom                # DOM 渲染层、虚拟滚动、装饰器
│  ├─ input                   # 键盘、IME、鼠标、剪贴板、拖拽
│  ├─ history                 # undo/redo、版本快照、operation log
│  ├─ plugin                  # 插件 API、插件运行时、权限声明
│  ├─ theme                   # 主题系统、样式变量、代码高亮主题
│  ├─ assets                  # 图片、附件、图床、资源索引
│  ├─ export                  # HTML/PDF/Markdown bundle 等导出
│  └─ tauri-bridge            # 前端到 Tauri/Rust 的能力桥接
└─ crates
   ├─ milkup_file             # 文件读写、大文件分块、原子保存
   ├─ milkup_search           # 搜索、索引、正则匹配
   ├─ milkup_export           # 原生导出能力
   └─ milkup_plugin_host      # 可选的 native/plugin sandbox 能力
```

架构原则：

- `packages/core` 不依赖 DOM、Tauri、React、Svelte 或任何产品 UI。
- `packages/markdown` 不依赖第三方 Markdown parser，允许使用测试语料和规范，但不把外部 parser 作为运行时依赖。
- `apps/desktop` 只负责产品装配，不承载核心编辑逻辑。
- Tauri/Rust 负责系统能力和大文件能力，前端内核负责编辑语义和交互体验。
- 所有外部能力通过 adapter 注入，避免内核直接依赖平台。

## 3. 产品形态

### 3.1 桌面端

桌面端是 v2 的首要目标。

技术形态：

- Tauri v2 应用壳。
- Web 前端承载编辑器界面。
- Rust 后端提供文件系统、大文件、搜索、导出、系统菜单、自动更新等能力。

主要功能：

- 文件打开、保存、另存为、最近文件。
- 工作区文件树。
- Typora 风格即时渲染。
- 源码模式与即时渲染模式切换。
- 搜索、替换。
- 图片粘贴和附件管理。
- 本地插件加载。
- 主题切换。

### 3.2 Web 端

Web 端作为内核独立性验证目标。

技术形态：

- 使用 `MemoryDocumentStore` 或 `IndexedDBDocumentStore`。
- 不依赖 Tauri。
- 能运行编辑器核心、Markdown parser、DOM view 和插件系统的子集。

限制：

- 不承诺 GB 文件能力。
- 文件系统能力依赖 File System Access API 或用户手动导入导出。
- 插件权限更严格。

### 3.3 移动端

移动端作为中后期目标。

重点挑战：

- 触摸选区。
- 虚拟键盘。
- IME 和组合输入。
- 小屏幕下的工具栏、预览和文件管理。

移动端不应在 v2 初期牵引内核设计，但内核 API 需要避免桌面专用假设。

## 4. 核心设计原则

### 4.1 Markdown 源码是唯一真相

编辑器内部不维护一个脱离 Markdown 源码的富文本主文档模型。所有展示、交互、导出和插件能力都应从 Markdown 源码及其 CST/AST 派生。

这样可以保证：

- 不丢失 Markdown 原始格式。
- 支持未知语法和插件语法。
- 支持源码模式和即时渲染模式无损切换。
- 支持精确 diff、history 和保存。

### 4.2 CST 优先，AST 辅助

Markdown parser 的第一产物是 CST，而不是普通 AST。

CST 需要保存：

- 节点类型。
- 源码起止位置。
- 语法标记位置。
- 内容位置。
- 子节点。
- 原始文本片段所需的 source range。

AST 用于：

- 可由插件提供的导航视图。
- 导出。
- 语义分析。
- 插件消费。
- 预览渲染。

示例：

```md
**bold**
```

CST 示例：

```ts
{
  type: 'strong',
  from: 0,
  to: 8,
  markerRanges: [[0, 2], [6, 8]],
  contentRanges: [[2, 6]]
}
```

### 4.3 事务驱动

所有编辑行为都通过 transaction 进入内核。

包括：

- 插入文本。
- 删除文本。
- 粘贴。
- 输入规则转换。
- 格式化命令。
- 拖拽移动。
- 插件修改。

transaction 是 history、插件监听、视图更新和持久化的共同基础。

### 4.4 分层降级

不同文件大小采用不同能力等级。

小文件优先体验，大文件优先稳定和性能。即时渲染、复杂插件、实时表格布局等能力需要在不丢失核心编辑能力的前提下切换到底层视口策略。

## 5. 编辑器内核

### 5.1 `@milkup/core`

职责：

- 文档抽象。
- 位置和范围模型。
- 事务系统。
- selection 状态。
- command 系统。
- extension/plugin 基础设施。
- 编辑器状态管理。

不负责：

- Markdown 解析。
- DOM 渲染。
- 文件系统。
- Tauri 通信。
- 具体 UI。

核心类型草案：

```ts
interface Editor {
  state: EditorState
  dispatch(transaction: Transaction): void
  command(command: Command): boolean
  use(plugin: EditorPlugin): Disposable
}

interface EditorState {
  doc: TextDocument
  selection: Selection
  facets: FacetRegistry
}

interface Transaction {
  changes?: ChangeSet
  selection?: Selection
  annotations?: Annotation[]
  effects?: StateEffect[]
}
```

### 5.2 文本文档模型

文本文档需要支持两种实现：

- `MemoryTextDocument`：小文件、Web demo、测试。
- `ChunkedTextDocument`：大文件、Tauri 文件后端。

候选底层结构：

- Piece Table：适合编辑器 undo/redo 和原始文件保留。
- Rope：适合大文本随机插入删除。

第一阶段建议：

- 先实现 Piece Table。
- 暴露统一 `TextDocument` 接口。
- 后续可替换为 Rope 或混合结构。

接口草案：

```ts
interface TextDocument {
  length: number
  lineCount: number
  slice(from: number, to: number): string
  lineAt(pos: number): Line
  apply(changes: ChangeSet): TextDocument
}
```

### 5.3 位置模型

前端运行时天然使用 UTF-16 code unit。文件系统和 Rust 后端更接近 UTF-8 byte offset。内核需要明确区分编辑位置和存储位置。

建议：

- 编辑器内部位置使用 UTF-16 offset，便于对接 DOM selection、input event 和 JS string。
- 文件存储层维护 byte offset 映射。
- 光标移动使用 grapheme cluster 规则，避免 emoji、组合字符、复杂语言被拆坏。
- 对外 API 明确标注 offset 单位。

### 5.4 Selection

第一阶段支持：

- 单光标。
- 单范围选区。
- 鼠标拖拽选择。
- Shift 扩展选择。
- 键盘导航。

第二阶段支持：

- 多光标。
- 矩形选择。
- 多范围装饰。

## 6. Markdown 解析系统

### 6.1 `@milkup/markdown`

职责：

- Markdown block parser。
- Markdown inline parser。
- CST 到 AST 转换。
- AST 到 Markdown stringifier。
- GFM 扩展语法。
- 插件语法注册。
- 增量解析。

不使用：

- remark。
- unified。
- markdown-it。
- micromark 作为运行时 parser。

可以使用：

- CommonMark/GFM 官方测试语料。
- 自建 golden tests。
- fuzz tests。

### 6.2 Block Parser

第一阶段支持：

- ATX heading。
- Paragraph。
- Blank line。
- Fenced code block。
- Indented code block。
- Blockquote。
- Ordered list。
- Unordered list。
- Thematic break。

第二阶段支持：

- HTML block。
- Link reference definition。
- Table。
- Task list item。
- Footnote。
- Custom container。

### 6.3 Inline Parser

第一阶段支持：

- Emphasis。
- Strong。
- Inline code。
- Link。
- Image。
- Autolink。
- Escape。
- Hard break。

第二阶段支持：

- Strikethrough。
- Highlight。
- Subscript/superscript。
- Math inline。
- Plugin inline syntax。

### 6.4 增量解析

增量解析策略：

- 文本修改后，先定位受影响的行范围。
- 从最近的稳定 block boundary 重新解析。
- 对叶子 block 单独运行 inline parser。
- 未变化的 CST 节点复用。
- 维护 source range remapping。

需要避免：

- 每次输入都全文解析。
- 每次输入都全量重建视图。
- 插件语法破坏主解析器性能。

## 7. Typora 风格即时渲染

### 7.1 模式定义

编辑器至少支持三种视图模式：

- Source Mode：完整 Markdown 源码。
- Live Render Mode：Typora 风格即时渲染。
- Preview Mode：只读预览。

v2 首要目标是 Live Render Mode。

### 7.2 语法隐藏与恢复

Live Render Mode 的核心规则：

- 光标不在语法节点内时，隐藏 Markdown marker。
- 光标进入语法节点时，恢复显示该节点源码。
- 选区覆盖语法节点时，恢复显示相关源码。
- 当前行优先显示源码，非当前区域优先显示富渲染。

示例：

```md
**bold**
```

显示规则：

- 光标在外部：显示为粗体 `bold`。
- 光标进入 `bold` 或 marker 附近：显示 `**bold**`。
- 选中整段：显示 `**bold**`。

### 7.3 节点渲染

渲染分为：

- Inline decoration：粗体、斜体、删除线、链接。
- Block decoration：标题、引用、列表、任务列表。
- Widget：图片、公式、Mermaid、HTML preview。
- Atomic block：复杂插件块。

### 7.4 复杂语法处理

复杂语法不强求完全 inline 编辑。

建议：

- 表格：第一阶段以源码增强为主，后续支持结构化表格编辑。
- Mermaid：默认渲染预览，点击进入源码编辑。
- Math：支持 inline 和 block 预览，点击恢复源码。
- HTML：默认源码显示，可选安全预览。
- 代码块：保留源码结构，增强高亮和复制按钮。

## 8. 输入系统

### 8.1 基础方案

不建议使用 `contenteditable` 作为主编辑模型。推荐采用：

```text
hidden textarea/input proxy
        ↓
input event normalization
        ↓
core transaction
        ↓
view update
        ↓
custom cursor/selection rendering
```

优势：

- DOM 不直接修改文档。
- 所有输入都经过 transaction。
- Markdown 源码和视图保持一致。
- 更适合虚拟滚动和大文件。

挑战：

- IME 组合输入。
- selection 绘制。
- 粘贴语义。
- 移动端虚拟键盘。
- 可访问性。

### 8.2 第一阶段输入能力

- 英文输入。
- 中文 IME。
- Enter、Backspace、Delete。
- Tab/Shift+Tab。
- 粘贴纯文本。
- 粘贴图片。
- 基础快捷键。
- 鼠标点击定位。
- 鼠标拖拽选择。

### 8.3 第二阶段输入能力

- 富文本粘贴转 Markdown。
- 多光标。
- 拖拽文件。
- 自动补全。
- slash command。
- 触屏选择。

## 9. 视图系统

### 9.1 `@milkup/view-dom`

职责：

- DOM 渲染。
- block 虚拟滚动。
- 装饰器渲染。
- 光标和选区绘制。
- 坐标和文档位置互转。
- 主题变量注入。
- 插件 node view 挂载。

不负责：

- 修改文档。
- 解析 Markdown。
- 访问文件系统。

### 9.2 虚拟滚动

视图只渲染可见区域和缓冲区域。

需要维护：

- block 高度缓存。
- 位置到坐标映射。
- 坐标到位置映射。
- 滚动锚点。
- 动态高度更新。

### 9.3 渲染后端

第一阶段：

- DOM block renderer。

第二阶段：

- 大文件 line renderer。

可选未来：

- Canvas renderer。
- WebGPU renderer。

## 10. 文件系统与大文件

### 10.1 文件能力分层

文件大小分级：

| 等级 | 大小          | 模式         | 能力                                |
| ---- | ------------- | ------------ | ----------------------------------- |
| S    | 0-128 KiB     | 完整模式     | 完整解析、完整即时渲染、完整插件    |
| M    | 128-256 KiB   | 增量模式     | store-ready、视口渲染、部分后台索引 |
| L    | 256 KiB-2 MiB | 大文件模式   | 原生行窗口、局部解析、功能降级      |
| XL   | 2 MiB+        | 超大文件模式 | 视口编辑、源码优先、按需渲染        |

阈值可根据实测调整。

### 10.2 DocumentStore

内核通过 `DocumentStore` 访问文档，不直接关心文件来源。

```ts
interface DocumentStore {
  length(): Promise<number>
  read(from: number, to: number): Promise<string>
  apply(changes: ChangeSet): Promise<void>
  flush(): Promise<void>
  close(): Promise<void>
}
```

实现：

- `MemoryDocumentStore`。
- `IndexedDBDocumentStore`。
- `TauriFileDocumentStore`。

### 10.3 Rust 文件服务

Rust 后端负责：

- 分块读取。
- 文件编码检测。
- 行索引构建。
- 原子保存。
- 临时文件管理。
- 文件变更监听。
- 大文件搜索。
- crash recovery。

保存策略：

```text
edit operations
   ↓
operation log
   ↓
flush to temp file
   ↓
fsync
   ↓
atomic replace
```

### 10.4 大文件降级策略

大文件模式下可禁用或降级：

- 全文即时解析。
- 全文 Typora 渲染。
- Mermaid 自动渲染。
- 大型表格结构化编辑。
- 全量链接校验。
- 插件全文扫描。

保留：

- 打开。
- 滚动。
- 编辑。
- 保存。
- 查找。
- 基础 Markdown 高亮。
- 局部即时渲染。

## 11. 插件系统

### 11.1 插件目标

插件系统需要支持：

- 运行时挂载。
- 运行时卸载。
- 权限声明。
- Markdown 语法扩展。
- 渲染扩展。
- 命令扩展。
- 面板扩展。
- 图床扩展。
- 导出扩展。

### 11.2 插件 Manifest

```json
{
  "name": "milkup-plugin-example",
  "version": "0.1.0",
  "main": "dist/index.js",
  "permissions": ["settings.read", "network"],
  "contributes": {
    "commands": ["example.run"],
    "markdownSyntax": ["exampleBlock"],
    "views": ["sidebar"]
  }
}
```

### 11.3 插件 API

```ts
interface MilkupPlugin {
  name: string
  setup(ctx: PluginContext): void | Disposable
}

interface PluginContext {
  commands: CommandRegistry
  markdown: MarkdownRegistry
  renderer: RendererRegistry
  keymaps: KeymapRegistry
  assets: AssetRegistry
  settings: SettingsRegistry
}
```

### 11.4 插件隔离

第一阶段：

- 本地可信插件。
- 插件运行在前端主线程或 worker。
- 通过权限声明限制能力入口。

第二阶段：

- 插件 worker 隔离。
- iframe/webview 隔离 UI。
- WASM 插件。
- 插件签名。

## 12. 图床与资源系统

### 12.1 资源模型

资源包括：

- 图片。
- 附件。
- 视频。
- 外部链接。
- 生成文件。

资源存储策略：

- 文档同级附件目录。
- 工作区统一附件目录。
- 用户全局资源库。
- 远程图床。

### 12.2 图片工作流

支持：

- 粘贴图片。
- 拖拽图片。
- 本地复制图片到附件目录。
- 自动重命名。
- hash 去重。
- 压缩。
- 上传图床。
- 本地路径和远程 URL 互相迁移。

### 12.3 图床 Provider

Provider API：

```ts
interface ImageProvider {
  name: string
  upload(file: AssetFile, options: UploadOptions): Promise<UploadResult>
  delete?(asset: RemoteAsset): Promise<void>
}
```

内置候选：

- Local。
- S3/R2。
- GitHub。
- 七牛云。
- 阿里 OSS。
- 腾讯 COS。
- 自定义 HTTP。

## 13. 导出系统

第一阶段：

- Markdown。
- HTML。
- PDF。

第二阶段：

- 图片打包。
- 单文件 HTML。
- Docx。
- Reveal.js slides。
- 静态站点。

导出应基于 Markdown AST 和渲染 pipeline，不应直接从编辑器 DOM 截取。

## 14. 安全模型

### 14.1 基本原则

- Markdown 中的 HTML 默认不执行脚本。
- 外部链接打开前经过安全处理。
- 插件必须声明权限。
- Tauri native 能力不能直接暴露给任意插件。
- 网络、文件系统、shell 能力必须走受控 bridge。

### 14.2 权限分类

候选权限：

- `fs.read`
- `fs.write`
- `network`
- `clipboard.read`
- `clipboard.write`
- `asset.read`
- `asset.write`
- `settings.read`
- `settings.write`
- `shell.open`

## 15. 设置与配置

配置分层：

- 默认配置。
- 用户全局配置。
- 工作区配置。
- 文档 frontmatter 配置。
- 插件配置。

配置示例：

```json
{
  "editor": {
    "mode": "live",
    "fontSize": 16,
    "lineHeight": 1.6
  },
  "markdown": {
    "gfm": true,
    "html": "sanitize"
  },
  "assets": {
    "defaultProvider": "local"
  }
}
```

## 16. 测试策略

### 16.1 Parser 测试

- CommonMark spec tests。
- GFM spec tests。
- 自定义插件语法测试。
- golden snapshot。
- fuzz testing。
- 增量解析一致性测试。

### 16.2 编辑器内核测试

- transaction apply。
- selection mapping。
- history undo/redo。
- IME composition。
- paste。
- large document operations。

### 16.3 视图测试

- 坐标到位置映射。
- 位置到坐标映射。
- 虚拟滚动。
- marker hide/show。
- cursor rendering。
- selection rendering。

### 16.4 产品测试

- 打开/保存。
- 原子保存和恢复。
- 文件变更监听。
- 插件启停。
- 图床上传。
- 导出。

## 17. 性能指标

初始目标：

- 1 MB 文档：完整即时渲染无明显延迟。
- 128 KiB 以下文档：完整模式打开时间可接受，编辑输入稳定。
- 128-256 KiB 文档：进入 store-ready 视口渲染，切换模式不触发全文 DOM 重建。
- 256 KiB 以上文档：进入原生行窗口路径，滚动和局部编辑稳定。
- 2 MiB 以上文档：进入超大文件模式，源码优先、可搜索、可局部编辑、可保存。

交互目标：

- 普通输入延迟小于 16 ms 到 32 ms。
- 大文件模式输入不阻塞主线程。
- 滚动保持流畅。
- parser 和索引任务可取消、可分片。

## 18. 开发路线图

### Phase 0：基础工程

- monorepo 初始化。
- 包结构建立。
- lint/test/build 工具链。
- Tauri desktop app 骨架。
- playground。

### Phase 1：编辑器最小内核

- `TextDocument`。
- `ChangeSet`。
- `Transaction`。
- `Selection`。
- `History`。
- 基础 command。

验收标准：

- 能在 playground 中编辑纯文本。
- undo/redo 正常。
- selection mapping 正常。

### Phase 2：Markdown CST Parser

- block parser。
- inline parser。
- CST source range。
- CST 到 AST。
- 基础 CommonMark 测试。

验收标准：

- 支持标题、段落、列表、引用、代码块、强调、链接、图片。
- parser snapshot 稳定。

### Phase 3：DOM View 与输入系统

- DOM block renderer。
- hidden textarea input。
- cursor overlay。
- selection overlay。
- 鼠标定位。
- 中文 IME。

验收标准：

- 能进行基础 Markdown 编辑。
- 输入和 selection 不依赖 contenteditable 主模型。

### Phase 4：Live Render Mode

- marker hide/show。
- inline decoration。
- block decoration。
- image widget。
- code block view。

验收标准：

- 基础 Typora 风格体验可用。
- 当前节点源码恢复逻辑稳定。

### Phase 5：Tauri 文件能力

- 打开。
- 保存。
- 另存为。
- 最近文件。
- 文件变更监听。
- 原子保存。

验收标准：

- 桌面端可作为基础 Markdown 编辑器使用。

### Phase 6：大文件模式

- `TauriFileDocumentStore`。
- 分块读取。
- 行索引。
- 局部解析。
- 大文件降级。
- 搜索。

验收标准：

- 256 KiB 以上文件进入原生行窗口路径。
- 2 MiB 以上文件进入源码优先的超大文件模式。

### Phase 7：插件和资源系统

- 插件 manifest。
- 插件加载/卸载。
- command/keymap/renderer 插件点。
- 本地图片附件。
- 图床 provider API。

验收标准：

- 可以运行本地插件。
- 可以安装一个自定义 Markdown 渲染插件。
- 可以配置一个图床 provider。

## 19. 关键风险

### 19.1 输入系统复杂度

自研输入系统难度高，尤其是 IME、selection、移动端和可访问性。需要尽早做 spike 验证。

### 19.2 Markdown 解析边界

CommonMark/GFM 有大量细节。自研 parser 需要测试先行，不能只靠人工样例。

### 19.3 大文件承诺

GB 级文件能力必须通过模式降级实现，不能承诺完整 Typora 渲染。产品文案和内部架构都需要区分完整模式和大文件模式。

### 19.4 插件安全

运行时插件会带来安全风险。早期可以只支持本地可信插件，但 API 设计不能阻碍后续权限化和隔离。

### 19.5 跨平台一致性

Tauri WebView 在不同平台底层实现不同，字体、输入法、菜单、快捷键、文件路径都需要专项测试。

## 20. 近期建议

下一步不应直接做完整 app，而应先完成三个技术验证：

1. 自研 text document + transaction + history。
2. 自研 Markdown CST parser 的最小闭环。
3. hidden textarea + DOM renderer 的输入和 selection spike。

如果这三件事跑通，milkup v2 的核心风险会显著下降。随后再进入 Tauri 产品化、大文件和插件系统。

## 21. AI-native 操作体系

### 21.1 目标

milkup v2 需要适应 AI agent、自动化脚本和第三方插件共同操作编辑器的场景。所有重要操作都不应只存在于 GUI 按钮或快捷键中，而应被抽象为可发现、可校验、可授权、可审计的 action。

目标：

- GUI 操作、快捷键、命令面板、插件、CLI、MCP 调用同一套 action。
- 第三方插件贡献的能力也可以暴露为 CLI 命令或 MCP tool。
- AI agent 可以读取当前文档、选区、资源、插件能力，并执行受控修改。
- 所有外部调用都有权限、确认、审计和回滚机制。

### 21.2 核心原则

不建议在内核里分别实现 CLI API 和 MCP API。推荐先实现统一的 `Action Registry`，然后把 CLI 和 MCP 都作为 adapter。

```text
Editor Core / Plugin Runtime
        ↓
Action Registry
        ↓
┌──────────────┬──────────────┬──────────────┬──────────────┐
│ GUI Commands │ Keybindings  │ CLI Adapter  │ MCP Adapter  │
└──────────────┴──────────────┴──────────────┴──────────────┘
```

这样可以避免：

- GUI、CLI、MCP 三套行为不一致。
- 插件只支持 GUI，不能被 AI 调用。
- CLI 和 MCP 分别维护 schema。
- 权限、日志、撤销逻辑分散。

### 21.3 Action Registry

每个 action 都需要声明元信息、输入输出 schema、权限和副作用。

```ts
interface ActionDefinition<Input = unknown, Output = unknown> {
  id: string
  title: string
  description?: string
  inputSchema: JsonSchema
  outputSchema?: JsonSchema
  permissions?: Permission[]
  source: 'core' | 'builtin' | 'plugin'
  pluginId?: string
  scope: 'app' | 'workspace' | 'document' | 'selection'
  sideEffect: 'none' | 'read' | 'write' | 'network' | 'filesystem'
  undoable?: boolean
  requiresConfirmation?: boolean
  run(ctx: ActionContext, input: Input): Promise<Output>
}
```

示例 action：

```ts
{
  id: 'document.replaceSelection',
  title: 'Replace selection',
  inputSchema: {
    type: 'object',
    properties: {
      text: { type: 'string' }
    },
    required: ['text']
  },
  permissions: ['document.write'],
  scope: 'selection',
  sideEffect: 'write',
  undoable: true
}
```

### 21.4 CLI Adapter

CLI 适合人类、脚本、CI、自动化流水线和可复现测试。

CLI 应支持两种模式：

- Attached mode：连接正在运行的 milkup 桌面应用。
- Headless mode：不启动 GUI，直接使用内核和文件服务处理文档。

示例：

```bash
milkup action list
milkup action describe document.replaceSelection
milkup action run document.replaceSelection --json '{"text":"hello"}'
milkup export ./notes/a.md --format pdf --out ./a.pdf
milkup plugin list
milkup plugin run image.upload --file ./a.png
```

CLI 的优势：

- 稳定。
- 易测试。
- 易脚本化。
- 不绑定具体 AI 平台。
- 可以作为 MCP server 的底层执行入口。

CLI 的限制：

- 不擅长表达当前 GUI 上下文。
- 不具备标准化的 AI tool discovery 协议。
- AI 调用时需要额外包装 schema 和上下文。

### 21.5 MCP Adapter

MCP 适合 AI agent 发现和调用 milkup 能力。MCP 官方模型包含 tools、resources、prompts 等概念，可以对应到 milkup 的 action、上下文资源和工作流模板。

推荐映射：

| MCP 概念 | milkup 对应                                    |
| -------- | ---------------------------------------------- |
| Tool     | Action                                         |
| Resource | 当前文档、选区、文件树、资源索引、插件列表     |
| Prompt   | 文档改写、总结、翻译、格式化、发布等工作流模板 |

MCP server 模式：

- Embedded MCP Server：随桌面应用运行，能访问当前打开文档、选区和 UI 状态。
- Headless MCP Server：由 CLI 启动，适合自动化和远程 agent。
- Workspace MCP Server：绑定某个工作区，只暴露该工作区内的资源和操作。

示例 tools：

```text
milkup.document.getCurrent
milkup.document.getSelection
milkup.document.replaceRange
milkup.document.applyMarkdownPatch
milkup.workspace.search
milkup.export.toPdf
milkup.assets.uploadImage
milkup.plugin.runAction
```

示例 resources：

```text
milkup://current/document
milkup://current/selection
milkup://workspace/files
milkup://workspace/assets
milkup://plugins/actions
```

MCP 的优势：

- 面向 AI agent 的标准协议。
- 支持能力发现。
- 支持结构化 tool schema。
- 支持上下文资源暴露。
- 更适合 Cursor、Claude Desktop、ChatGPT、Codex 等 AI 工具集成。

MCP 的限制：

- 协议和生态仍在快速演进。
- 安全边界必须谨慎设计。
- 不应把所有底层危险操作无条件暴露给 AI。

### 21.6 CLI 与 MCP 的取舍

不建议二选一。推荐优先级是：

```text
Action Registry first
CLI adapter second
MCP adapter third
```

原因：

- `Action Registry` 是真实产品能力的唯一来源。
- CLI 最适合早期验证、测试和自动化。
- MCP 最适合 AI 时代的外部集成。
- MCP 可以基于 Action Registry 自动生成 tools。
- CLI 可以作为 MCP headless 模式的执行后端。

如果必须从产品战略角度判断，MCP 更重要；如果从工程落地角度判断，CLI 更基础。

最终目标是：

```text
任何 GUI 可做的事，都有 action。
任何插件贡献的能力，都可以注册 action。
任何安全的 action，都可以被 CLI 调用。
任何适合 AI 的 action，都可以被 MCP 暴露。
```

### 21.7 第三方插件暴露能力

插件贡献 action 时必须声明 manifest。

```json
{
  "name": "milkup-plugin-publisher",
  "version": "0.1.0",
  "contributes": {
    "actions": [
      {
        "id": "publisher.publishToBlog",
        "title": "Publish to blog",
        "permissions": ["network", "document.read"],
        "sideEffect": "network",
        "requiresConfirmation": true
      }
    ]
  }
}
```

插件 action 默认不直接暴露给 MCP，需要满足：

- 用户启用该插件。
- 用户允许该 action 对外暴露。
- action schema 完整。
- 权限声明通过。
- 高风险 action 有确认或 dry-run。

### 21.8 AI 安全与审计

AI 调用必须默认保守。

需要支持：

- Action permission。
- Tool allowlist。
- Workspace sandbox。
- Destructive action confirmation。
- Dry-run。
- Patch preview。
- Audit log。
- Undo transaction。
- Rate limit。
- Sensitive resource redaction。

高风险操作：

- 删除文件。
- 覆盖保存。
- 批量修改。
- 上传网络。
- 执行 shell。
- 安装插件。
- 读取 workspace 外文件。

这些操作不应默认暴露给 MCP。

### 21.9 AI 友好的编辑操作

不要只给 AI 暴露低级文本操作，也要暴露语义操作。

低级操作：

- `replaceRange`
- `insertText`
- `deleteRange`
- `applyPatch`

语义操作：

- `renameHeading`
- `moveSection`
- `insertTable`
- `updateFrontmatter`
- `formatMarkdown`
- `extractSelectionToFile`
- `convertListToTasks`
- `rewriteSection`

AI 更适合调用语义操作。低级操作保留给精确 patch 和脚本自动化。

### 21.10 上下文资源

AI 不应每次读取完整文档，尤其是大文件。MCP resources 需要支持分层上下文。

上下文资源包括：

- 当前选区。
- 当前段落。
- 当前 section。
- 插件提供的文档导航视图。
- frontmatter。
- 链接列表。
- 图片资源。
- 诊断信息。
- 最近编辑历史。
- 插件 action 列表。

大文件下，AI 默认只能获取相关范围，除非用户授权全文读取。

## 22. 编辑稳定性设计

### 22.1 核心判断

纯自研架构不能天然规避 Markdown 编辑器的稳定性问题。它只能让问题更可控、更容易定位、更容易修复。

v1 已知问题已经整理为独立回归清单，见 [v1-lessons-and-regressions.md](./v1-lessons-and-regressions.md)。v2 的 MVP 验收应把其中的高风险项作为基础门槛，而不是后续优化。

以下问题必须作为一等设计目标，而不是后期 bugfix：

- Markdown 语法稳定渲染。
- 多层嵌套语法不发生错乱。
- 编辑中破坏语法时能立即识别并稳定降级。
- 输入补全和语法修复不产生不可预期副作用。
- 即时渲染模式和源码模式切换时保持稳定视角。
- 模式切换后保持稳定光标和选区。
- history undo/redo 后恢复一致状态。

### 22.2 基本稳定性原则

必须保证以下不变量：

- Markdown 源码永远是唯一真相。
- 渲染层不能直接修改文档。
- 所有文档修改必须通过 transaction。
- parser 不能抛出不可恢复错误。
- parser 面对不完整或错误语法时必须返回 partial tree。
- decoration 必须是从 editor state 派生的纯结果。
- 即时渲染模式和源码模式共享同一份 document state。
- 光标位置必须基于文档坐标，而不是 DOM 节点。
- 滚动锚点必须基于文档 block，而不是像素值本身。

这些不变量是稳定性的基础。如果某个功能需要破坏这些规则，应优先调整功能设计。

### 22.3 错误容忍 Parser

Markdown 编辑过程中，大量中间状态都是不完整语法。

例如：

```md
**
[title](
![image](

> - **unfinished
```

parser 必须支持 error-tolerant parsing：

- 未闭合语法生成 incomplete node。
- 不合法嵌套生成 fallback text node。
- block parser 不因 inline 错误失效。
- inline parser 不影响外层 block 稳定性。
- 插件 parser 出错不能破坏主 parser。

节点可增加状态字段：

```ts
type SyntaxStatus = 'valid' | 'incomplete' | 'invalid' | 'fallback'

interface SyntaxNode {
  type: string
  from: number
  to: number
  status: SyntaxStatus
  children?: SyntaxNode[]
}
```

渲染策略：

- `valid`：正常即时渲染。
- `incomplete`：保留更多源码，避免误隐藏 marker。
- `invalid`：源码优先展示。
- `fallback`：作为普通文本展示。

### 22.4 嵌套语法稳定性

Markdown 嵌套错乱通常来自三类问题：

- block container 栈不稳定。
- inline delimiter 匹配不稳定。
- 增量解析范围过小。

需要单独设计：

```text
Block Parser
   ↓ container stack
List / Blockquote / Code / HTML
   ↓ leaf block
Inline Parser
   ↓ delimiter stack
Emphasis / Link / Image / CodeSpan
```

稳定性要求：

- block parser 和 inline parser 分层，不互相污染。
- 列表、引用、代码块使用明确 container stack。
- emphasis、link、image 使用 delimiter stack。
- fenced code block 内不运行普通 inline parser。
- HTML block 和代码块优先级高于普通段落。
- 修改一处文本时，增量解析范围必须扩展到最近稳定边界。

多层嵌套测试需要覆盖：

- list inside blockquote。
- blockquote inside list。
- task list inside nested list。
- emphasis inside link。
- link inside emphasis。
- code span inside emphasis。
- unclosed emphasis inside list。
- table inside list。
- fenced code inside quote。

### 22.5 编辑中破坏语法

编辑器不能假设用户输入总是让 Markdown 更完整。相反，绝大多数输入都会短暂破坏语法。

策略：

- 输入后立即生成 transaction。
- parser 对受影响范围做增量解析。
- 渲染层根据节点状态决定是否降级。
- 对不完整节点显示源码，避免错误隐藏。
- 自动补全只通过独立 input rule 执行，不能藏在 parser 中。

示例：

用户输入 `**bold` 时：

- parser 生成 incomplete strong candidate。
- view 不隐藏 `**`。
- 光标继续稳定停在源码位置。
- 如果用户继续输入 `**`，节点变为 valid。
- view 再切换为粗体渲染。

### 22.6 语法补全和修复

语法补全需要保守。

第一阶段只做低风险补全：

- 输入 `**` 后成对补全。
- 输入 `` ` `` 后成对补全。
- 输入 `[` 后补全 `]` 可配置。
- 输入 `(` 后补全 `)` 可配置。
- 列表换行延续。
- 空列表项回车退出列表。

补全原则：

- 补全必须可 undo。
- 补全必须通过 transaction。
- 补全不得跨 block 猜测。
- 补全不得自动重写大范围文档。
- 补全后 selection 必须明确。

高风险修复，如自动修复表格、链接、嵌套列表缩进，应先以 command 或 quick fix 形式提供，不应默认自动执行。

### 22.7 即时渲染与源码模式切换

模式切换稳定性依赖两个锚点：

- Cursor Anchor：光标或选区在文档中的逻辑位置。
- Scroll Anchor：当前视口对应的文档位置。

不能用 DOM 节点或当前像素滚动值作为唯一依据，因为不同模式下同一段 Markdown 的视觉高度不同。

建议结构：

```ts
interface ViewAnchor {
  docPos: number
  blockId?: string
  blockOffsetRatio?: number
  affinity?: 'before' | 'after'
  visualColumn?: number
}
```

模式切换流程：

```text
capture cursor anchor
capture scroll anchor
switch render mode
rebuild visible blocks
restore cursor by doc position
restore scroll by block anchor
verify selection visible
```

如果目标位置因为渲染差异无法精确恢复，优先保证：

1. 光标仍指向同一文档位置。
2. 光标仍在视口内。
3. 当前 block 的相对视口位置尽量接近切换前。

### 22.8 源码坐标与视觉坐标映射

即时渲染模式下，部分 Markdown marker 会被隐藏。此时必须维护源码坐标和视觉坐标之间的 projection mapping。

示例：

```md
**bold**
```

源码坐标：

```text
0 1 2 3 4 5 6 7
* * b o l d * *
```

视觉坐标：

```text
0 1 2 3
b o l d
```

需要支持：

- source position 到 visual position。
- visual position 到 source position。
- hidden marker 附近的点击定位。
- selection 横跨 hidden marker。
- 光标进入节点后 marker 恢复显示。

mapping 必须由 CST source range 和 decoration 共同生成，不应由 DOM 反推。

### 22.9 视图恢复与错误自愈

视图层应当可以随时从 editor state 完整重建。

要求：

- DOM view 不保存不可重建的编辑状态。
- 光标、选区、滚动锚点都可以从 state 恢复。
- 渲染异常时可以回退到源码模式。
- 插件 node view 出错不影响主编辑器。
- 单个 block 渲染失败时显示源码 fallback。

### 22.10 稳定性测试矩阵

稳定性测试必须早于复杂功能。

Parser 测试：

- CommonMark/GFM spec tests。
- malformed markdown tests。
- nested syntax tests。
- plugin syntax isolation tests。
- full parse 与 incremental parse 等价测试。

编辑测试：

- 随机插入删除 fuzz tests。
- 输入中间态测试。
- undo/redo 后文档一致性。
- selection mapping 测试。
- IME composition 测试。

渲染测试：

- live/source mode switch。
- cursor restore。
- scroll anchor restore。
- marker hide/show。
- block height change。
- node view fallback。

回放测试：

- 每个编辑 bug 都应能保存为 operation log。
- 测试 runner 可以重放 operation log。
- parser、selection、view anchor 在每一步都可断言。

### 22.11 稳定性优先级

功能开发优先级应当遵循：

```text
稳定源码编辑
   ↓
稳定 Markdown 解析
   ↓
稳定 selection 和 history
   ↓
稳定即时渲染
   ↓
复杂语法增强
   ↓
插件和 AI 自动化
```

如果即时渲染和源码稳定性冲突，优先保证源码稳定性。

如果插件渲染和主编辑器稳定性冲突，优先隔离插件。

如果大文件能力和完整即时渲染冲突，优先保证文件可打开、可编辑、可保存。
