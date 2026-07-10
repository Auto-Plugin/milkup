# Milkup 插件开发指南

> 适用范围：当前 Milkup 插件 API（Worker host、受控贡献点和 broker 系统能力）。
> 推荐起点：普通插件使用 `worker` host；只有必须运行原生进程时才使用 `sidecar`。

## 1. 插件模型

Milkup 插件由两部分组成：

- `plugin.json`：声明插件身份、兼容版本、权限和贡献点。
- ESM 入口模块：实现 manifest 中声明的命令和渲染 handler。

宿主只注册 manifest 中声明过的贡献点。模块中额外导出的命令或 renderer 不会自动进入应用。

普通插件运行在 Worker 中，并受到以下限制：

- 不能访问宿主 DOM。
- 不能直接调用 Tauri 或 Node.js API。
- 不能使用 `eval`、`Function`、`importScripts`、子 Worker 或 SharedWorker。
- `WebSocket`、`EventSource` 和 `XMLHttpRequest` 不可用。
- 文件、网络和存储必须通过 `context.host` 提供的 broker。
- 编辑文档必须通过 `context.editor.dispatch(...)` 事务完成。

## 2. 第一个插件

建议的开发目录：

```text
hello-milkup/
├── plugin.json
├── src/
│   └── plugin.ts
└── dist/
    └── plugin.js
```

### 2.1 Manifest

创建 `plugin.json`：

```json
{
  "id": "example.hello-milkup",
  "name": "Hello Milkup",
  "version": "1.0.0",
  "description": "Insert text at the current cursor",
  "host": "worker",
  "main": "./dist/plugin.js",
  "engines": {
    "milkup": "^0.1.0",
    "pluginSdk": "^0.1.0"
  },
  "permissions": ["document:write"],
  "contributes": {
    "commands": [
      {
        "id": "hello.insertGreeting",
        "title": "Insert greeting",
        "action": "hello.insertGreeting",
        "category": "document",
        "permissions": ["document:write"]
      }
    ],
    "keymaps": [
      {
        "command": "hello.insertGreeting",
        "key": "Mod+Alt+H",
        "when": "editorFocus && documentOpen"
      }
    ]
  }
}
```

### 2.2 入口模块

`src/plugin.ts`：

```ts
import { dispatchInsert } from '@milkup/plugin-sdk'

const plugin = {
  commands: {
    'hello.insertGreeting': (context: Parameters<typeof dispatchInsert>[0]) => {
      dispatchInsert(context, 'Hello from Milkup!', {
        commandId: 'hello.insertGreeting',
        historyGroup: 'isolate',
      })
    },
  },
}

export default plugin
```

入口可以默认导出插件对象，也可以直接导出对象形状。默认导出是推荐写法。

Worker 从单个包内 ESM 入口加载代码。使用 `@milkup/plugin-sdk` 或其他依赖时，应通过构建工具把依赖打进 `dist/plugin.js`；不要依赖浏览器解析裸模块名，也不要在运行时加载包外代码。

`@milkup/plugin-sdk` 当前是 Milkup 仓库内的私有 workspace 包，尚未发布到 npm。在 Milkup monorepo 内开发时使用 `workspace:*`；仓库外开发时可以暂时使用指向本地 Milkup checkout 的 `file:` 依赖。以下是一个 esbuild 配置示例：

```json
{
  "private": true,
  "type": "module",
  "scripts": {
    "build": "esbuild src/plugin.ts --bundle --format=esm --platform=browser --outfile=dist/plugin.js"
  },
  "dependencies": {
    "@milkup/plugin-sdk": "file:../milkup/packages/plugin-sdk"
  },
  "devDependencies": {
    "esbuild": "^0.25.0",
    "typescript": "^5.8.0"
  }
}
```

本地 `file:` 路径按实际目录调整。构建产物不应保留对 `@milkup/plugin-sdk` 的外部 import。

### 2.3 安装和调试

1. 构建 `dist/plugin.js`。
2. 在 Milkup 打开“菜单 > 插件”。
3. 选择“安装本地插件”，再选择开发目录中的 `plugin.json`。
4. 如果插件请求敏感能力，先选择“批准能力”。
5. 选择“启用”。
6. 从插件页执行命令，或使用声明的快捷键。
7. 修改并重新构建后，选择“重载”。

开发目录会保留为插件来源。重载时 Milkup 会重新读取该来源，并在加载新实例前清理旧命令、快捷键、Worker 和 UI 资源。

## 3. Manifest 参考

### 3.1 顶层字段

| 字段                | 必填 | 说明                                          |
| ------------------- | ---- | --------------------------------------------- |
| `id`                | 是   | 小写 kebab/dot case，例如 `example.my-plugin` |
| `name`              | 是   | 用户可见名称                                  |
| `version`           | 是   | semver 风格版本，例如 `1.2.0`                 |
| `host`              | 否   | `worker` 或 `sidecar`，默认 `worker`          |
| `main`              | 否   | 包内 ESM 入口或 sidecar 可执行文件            |
| `resources`         | 否   | 导入、导出时必须随包携带的相对路径            |
| `description`       | 否   | 插件说明                                      |
| `engines.milkup`    | 否   | 兼容的 Milkup 版本范围                        |
| `engines.pluginSdk` | 否   | 兼容的插件 SDK 版本范围                       |
| `permissions`       | 否   | 插件请求的宿主权限                            |
| `networkOrigins`    | 否   | 网络访问的精确 HTTP(S) origin 白名单          |
| `contributes`       | 否   | 命令、快捷键、渲染器、UI 等贡献点             |

相对路径不能包含向上的 `..` 跳转，也不能逃出插件目录或插件包。

### 3.2 权限

可声明的权限：

| 权限             | 用途                                     |
| ---------------- | ---------------------------------------- |
| `document:read`  | 通过异步扫描读取当前文档的匹配或结构结果 |
| `document:write` | 通过事务修改文档                         |
| `view:read`      | 读取视图上下文                           |
| `view:write`     | 修改受控视图状态                         |
| `file:read`      | 读取插件文件根目录内的文本文件           |
| `file:write`     | 写入插件文件根目录内的文本文件           |
| `file:delete`    | 删除插件文件根目录内的文件               |
| `network:access` | 通过网络 broker 发起 HTTP(S) 请求        |
| `app:control`    | 执行受控应用操作                         |

`file:*`、`network:access`、`app:control` 和 `sidecar` host 需要用户明确审批。权限写进 manifest 不等于已经获批；插件应检查相应的 `context.host` 方法是否存在，并为拒绝或撤销审批做好错误处理。

命令自身的 `permissions` 必须是顶层 `permissions` 的子集。

## 4. 生命周期和模块接口

插件模块可以提供以下成员：

```ts
const plugin = {
  commands: {
    'example.command': async (context, input) => {},
  },
  renderers: {
    'example-renderer': async (context) => 'output',
  },
  async activate(context) {
    return {
      commands: {},
      renderers: {},
      async dispose() {},
    }
  },
  async deactivate() {},
}
```

- `activate(context)`：插件启用时调用。可以返回动态命令、renderer 和 `dispose`。
- `commands`：静态命令 handler，键必须匹配贡献点的 `action`。
- `renderers`：所有受控渲染 handler，键必须匹配 renderer、UI、importer 或 document type 的 `id`。
- activation 的 `dispose()`：实例卸载前调用。
- `deactivate()`：插件禁用或重载时调用。

同一个插件内，renderer、UI、importer 和 document type 共用 handler ID 命名空间，ID 不能跨类型重复。

## 5. 命令和编辑事务

命令贡献示例：

```json
{
  "id": "example.replaceSelection",
  "title": "Replace selection",
  "action": "example.replaceSelection",
  "category": "document",
  "permissions": ["document:write"],
  "inputSchema": {
    "type": "object",
    "properties": {
      "text": {
        "type": "string",
        "required": true,
        "description": "Replacement text"
      }
    }
  }
}
```

`inputSchema.properties` 支持 `string`、`number` 和 `boolean` 字段。

SDK 提供：

- `insertText(position, text)`
- `deleteRange(from, to)`
- `replaceRange(from, to, text)`
- `cursor(position)`
- `rangeSelection(anchor, head)`
- `dispatchInsert(context, text, options)`

复杂编辑可以直接派发事务：

```ts
import { cursor, replaceRange } from '@milkup/plugin-sdk'

function replaceSelection(context, text: string) {
  const selection = context.editor?.state.selection.main
  if (!selection || !context.editor) return

  context.editor.dispatch({
    changes: replaceRange(selection.from, selection.to, text),
    selection: cursor(selection.from + text.length),
    origin: { type: 'command', id: 'example.replaceSelection' },
    historyGroup: 'isolate',
  })
}
```

一个 handler 可以派发多个事务。Worker 会把事务序列化后交给宿主应用；不要直接操作文档对象或编辑器 DOM。

## 6. 快捷键

快捷键的 `command` 指向命令的 `action`：

```json
{
  "command": "example.replaceSelection",
  "key": "Mod+Shift+R",
  "when": "editorFocus && documentOpen && !sourceMode"
}
```

- `Mod` 在 Windows/Linux 表示 Ctrl，在 macOS 表示 Command。
- 可组合 `Alt`、`Shift` 和一个按键。
- `when` 支持 `!`、`&&` 和 `||`。
- 可用上下文：`editorFocus`、`documentOpen`、`sourceMode`、`liveMode`。
- 冲突采用确定性优先级；被覆盖的快捷键会在插件页显示为冲突。

## 7. Markdown 语法和 renderer

### 7.1 声明语法节点

```json
{
  "markdownSyntax": [
    {
      "id": "example-callout-syntax",
      "nodeType": "exampleCallout",
      "pattern": "^:::callout(?:\\s|$)",
      "flags": "m",
      "block": true
    }
  ],
  "renderers": [
    {
      "id": "example-callout-renderer",
      "nodeType": "exampleCallout",
      "module": "./dist/plugin.js"
    }
  ]
}
```

语法正则最长 256 个字符，flags 只允许 `i`、`m`、`u`，并会拒绝已知的高风险回溯结构。必须至少启用 `block` 或 `inline`。

### 7.2 返回受控输出

```ts
const plugin = {
  renderers: {
    'example-callout-renderer': ({ source }) => ({
      type: 'element',
      tag: 'strong',
      children: [
        'Callout: ',
        {
          type: 'element',
          tag: 'button',
          text: source ?? '',
          attributes: { title: 'Insert callout text', 'aria-label': 'Insert callout text' },
          action: {
            command: 'example.insertCallout',
            input: { text: source ?? '' },
          },
        },
      ],
    }),
  },
}
```

允许的输出是字符串、数字、布尔值，或以下受控元素：

- 标签：`span`、`strong`、`em`、`code`、`a`、`button`
- 属性：`class`、`title`、`href`、`aria-label`
- `href`：只允许 `http:`、`https:`、`mailto:` 或 `#` 链接

`action.command` 只能指向同一插件已声明的命令。任意 DOM 节点、未允许标签、属性或链接都会被拒绝；renderer 出错时只回退当前节点，不会破坏基础 Markdown 渲染。

## 8. UI 插槽

UI 贡献点：

| `slot`             | 用途                           |
| ------------------ | ------------------------------ |
| `menu-page`        | 插件菜单页                     |
| `sidebar-panel`    | 侧边栏面板                     |
| `bottom-panel`     | 编辑器下方面板                 |
| `document-toolbar` | 文档工具栏                     |
| `statusbar`        | 状态栏                         |
| `modal`            | 由宿主分配的 modal/action view |

示例：

```json
{
  "id": "example-status",
  "slot": "statusbar",
  "title": "Example status",
  "scope": "document"
}
```

UI handler 仍放在模块的 `renderers` 中：

```ts
const plugin = {
  renderers: {
    'example-status': ({ node }) => {
      const { phase, documentId } = node as {
        phase: 'mount' | 'update' | 'focus' | 'blur' | 'dispose'
        documentId: string
      }

      if (phase === 'dispose') return ''
      return `Document: ${documentId}`
    },
  },
}
```

- `scope: "app"`：跨文档保留，默认值。
- `scope: "document"`：切换文档时销毁旧实例并为新文档挂载。
- 生命周期 phase：`mount`、`update`、`focus`、`blur`、`dispose`。
- UI 输出使用与 renderer 相同的受控元素格式。
- 插件不能访问插槽外的 DOM，也不能自行覆盖应用头部。

## 9. Importer 和自定义文档类型

### 9.1 Importer

```json
{
  "id": "chat-export",
  "title": "Chat export",
  "extensions": ["json"],
  "mimeTypes": ["application/json"],
  "target": "markdown"
}
```

对应 handler：

```ts
const plugin = {
  renderers: {
    'chat-export': ({ source, node }) => {
      const { path } = node as { path: string }
      const data = JSON.parse(source ?? '{}')
      return { markdown: `# ${data.title ?? path}\n` }
    },
  },
}
```

- `target: "markdown"`：返回 Markdown 字符串或 `{ markdown: string }`。
- `target: "custom-view"`：返回受控 renderer 输出，或 `{ output: controlledOutput }`。
- 生成的 Markdown 是新的未保存文档，保存时走“另存为”；不会覆盖源文件。
- 自定义视图只读。
- 当前桌面端根据文件最后一个扩展名选择 importer；`mimeTypes` 会被校验和保存，但尚不参与桌面文件选择。

### 9.2 Document type

```json
{
  "id": "conversation-document",
  "title": "Conversation",
  "extensions": ["json"],
  "readonly": true
}
```

扩展名不带前导点，并按文件最后一个后缀匹配。document type handler 的 `nodeType` 是 `document:type`，输入同样包含 `source` 和 `node.path`。返回字符串或 `{ markdown }` 时打开生成的 Markdown；返回其他受控输出时打开只读自定义视图。

## 10. Broker 系统能力

### 10.1 文档扫描

声明 `document:read` 后，插件可以异步扫描当前文档，而不需要取得完整文本：

```ts
const scanner = context.host.document?.scan({
  query: { kind: 'markdownHeadings', levels: [1, 2, 3, 4, 5, 6] },
  windowSizeLines: 512,
  batchSize: 64,
  maxResults: 10_000,
})

if (!scanner) throw new Error('Document scanning is unavailable')

for await (const event of scanner) {
  if (event.type === 'batch') {
    for (const item of event.items) {
      if (item.kind === 'heading') {
        console.log(item.level, item.label, item.line, item.from)
      }
    }
  }

  if (event.type === 'done' && !event.complete) {
    console.warn(`Scan stopped: ${event.reason}`)
  }
}
```

支持三类查询：

```ts
{ kind: 'text', text: 'TODO', caseSensitive: false }
{ kind: 'regexp', pattern: 'TODO\\s+(\\w+)', flags: 'i' }
{ kind: 'markdownHeadings', levels: [1, 2, 3] }
```

- `text` 和 `regexp` 返回 `kind: "match"`，包括 `from`、`to`、`line`、`lineOffset`、`text`，正则捕获组位于 `captures`。
- `markdownHeadings` 返回 `kind: "heading"`，额外包括 `level`、`label`、`labelFrom` 和 `labelTo`。宿主会跨扫描窗口保留 Markdown 代码围栏状态。
- 每个事件都带 `documentId`、`version`、`scannedLineCount`、`totalLineCount` 和 `resultCount`。
- 文档切换或版本变化后，旧扫描以 `reason: "invalidated"` 结束。不要把不同版本的结果合并。
- 提前退出 `for await` 会自动取消扫描，也可以显式调用 `await scanner.cancel()`。
- 单个插件默认最多同时运行 2 个扫描；`batchSize` 最大 256，`windowSizeLines` 最大 4096，`maxResults` 最大 50000。
- 正则表达式最长 256 字符，只支持 `i`、`m`、`s`、`u` flags；反向引用、lookbehind 和明显的嵌套量词会被拒绝。
- 返回的匹配文本、捕获组和标题最长 4096 字符。被截断时会设置 `textTruncated` 或 `labelTruncated`，位置范围仍指向完整内容。

#### 渐进式大纲 UI

受控 UI 不直接操作 DOM。扫描得到一批结果后，调用 `context.host.ui.requestUpdate(viewId)` 请求宿主重新执行该插件的 UI renderer：

```ts
let headings = []
let activeScanner

export default {
  async activate(context) {
    async function startOutlineScan() {
      await activeScanner?.cancel()
      headings = []
      activeScanner = context.host.document?.scan({
        query: { kind: 'markdownHeadings' },
        batchSize: 64,
      })

      if (!activeScanner) return

      for await (const event of activeScanner) {
        if (event.type === 'batch') {
          headings = [...headings, ...event.items.filter((item) => item.kind === 'heading')]
          await context.host.ui?.requestUpdate('outline')
        }
      }
    }

    return {
      renderers: {
        outline: async ({ node }) => {
          if (node?.phase === 'mount') void startOutlineScan()
          if (node?.phase === 'dispose') await activeScanner?.cancel()

          return {
            type: 'element',
            tag: 'span',
            children: headings.map((heading) => ({
              type: 'element',
              tag: 'span',
              text: `${'#'.repeat(heading.level)} ${heading.label}`,
            })),
          }
        },
      },
      dispose: () => activeScanner?.cancel(),
    }
  },
}
```

`requestUpdate()` 只能刷新当前插件在 manifest 中声明的 UI。省略 `viewId` 时刷新该插件所有已挂载 UI；传入未声明的 ID 会被拒绝。文档作用域 UI 在切换文档时会先收到 `dispose`，再为新文档收到 `mount`，应在这两个阶段分别取消和重启扫描。

桌面端会在文档 UI 的 `node.viewport` 中提供当前视口：

```ts
const { fromLine, toLine, activeLine } = node.viewport
```

- `fromLine`、`toLine` 是当前可见行范围。
- `activeLine` 是用于导航 UI 跟随滚动的当前行，目前等于视口首行。
- 编辑器滚动后，宿主会节流触发 UI 的 `update` phase。插件应从已经扫描到的结构结果中按行号二分查找，只渲染当前行附近的有限结果，不要一次渲染几万项。

只读导航不需要 `document:write` 或 `view:write`。UI 命令可调用受控导航方法：

```ts
await context.host.ui?.revealLine(heading.line)
```

`revealLine()` 只接受从 1 开始的整数行号，并由宿主完成范围校验和视口跳转；它不能修改文档内容。大纲类插件通常只需声明 `document:read`。

Worker 插件会自动获得扫描和 UI 更新的 RPC 包装。自定义 sidecar host 需要在插件进程侧创建对应的 document/UI RPC broker，再交给 `createPluginModuleIsolationHost`；桌面宿主负责提供 RPC server。

### 10.2 Storage

Storage 不需要文件权限，数据自动按插件 ID 隔离：

```ts
async function increment(context) {
  const storage = context.host.storage
  if (!storage) throw new Error('Storage is unavailable')

  const count = Number((await storage.getItem('count')) ?? '0') + 1
  await storage.setItem('count', String(count))
  return count
}
```

键必须匹配 `[A-Za-z0-9._-]`，长度为 1-128；值必须是字符串。get/set/remove 都会进入插件审计记录。

### 10.3 文件

```ts
const text = await context.host.readText?.('templates/default.md')
await context.host.writeText?.('data/cache.txt', text ?? '')
await context.host.deleteFile?.('data/old-cache.txt')
```

当前桌面宿主只允许访问插件自己的根目录。路径会经过规范化和根目录检查，不能使用 `..` 逃逸。每种操作都需要对应的 `file:*` 权限和用户审批。

### 10.4 网络

Manifest 必须声明权限和精确 origin：

```json
{
  "permissions": ["network:access"],
  "networkOrigins": ["https://api.example.com"]
}
```

```ts
const response = (await context.host.fetch?.('https://api.example.com/items', {
  method: 'GET',
})) as {
  status: number
  statusText: string
  headers: Record<string, string>
  body: string
}
```

白名单项必须等于 URL 的 origin，例如 `https://api.example.com`；不能包含路径、查询参数或通配符。桌面 broker 返回结构化的 `status`、`statusText`、`headers` 和文本 `body`，并记录成功或拒绝审计。

## 11. `.milkup-plugin` 包

插件包是 JSON 容器，不是 ZIP：

```json
{
  "format": "milkup-plugin",
  "version": 1,
  "manifest": {
    "id": "example.hello-milkup",
    "name": "Hello Milkup",
    "version": "1.0.0",
    "main": "dist/plugin.js"
  },
  "files": [
    {
      "path": "dist/plugin.js",
      "encoding": "utf8",
      "content": "export default { commands: {} }"
    }
  ]
}
```

- `format` 固定为 `milkup-plugin`。
- `version` 当前固定为 `1`。
- Worker 入口必须使用 `utf8`。
- sidecar 二进制可以使用 `base64`。
- `main` 和 `resources` 中的每个文件都必须出现在 `files`。
- 文件路径必须是包内相对路径，不能重复或包含 `..`。

开发阶段可以安装 `plugin.json`，再使用插件管理器的“导出”生成 `.milkup-plugin`。安装包会在执行任何插件代码前校验 manifest、入口、资源和路径。

## 12. Sidecar 插件

Sidecar 适合必须使用原生进程、现有 CLI 或无法在 Worker 中实现的能力。它不是普通插件的默认升级路径。

- manifest 使用 `"host": "sidecar"`。
- `main` 指向本地可执行文件或包内 base64 二进制。
- 用户必须显式批准 sidecar host，之后才能启用。
- 生命周期和 RPC 必须遵循 Milkup sidecar host 协议。
- 包安装时，Unix 平台的包内可执行文件会设置执行权限。

协议和安全取舍见 [plugin-native-host-decision.md](./plugin-native-host-decision.md)。

## 13. 测试和诊断

建议至少覆盖：

1. manifest 可以通过共享校验。
2. 每个命令的正常输入、缺少编辑器上下文和错误输入。
3. 文档修改生成正确事务，而不是直接修改宿主状态。
4. renderer 对异常输入返回 fallback 或抛出可读错误。
5. UI 重复 mount/dispose 不保留定时器或外部资源。
6. importer 不修改源文件，并明确返回 Markdown 或受控输出。
7. 文件和网络在未审批、越界路径或非白名单 origin 下被拒绝。
8. deactivate/dispose 后不再保留命令、监听器或后台任务。
9. 文档扫描能处理空结果、版本失效、提前取消和结果截断，UI dispose 后不会继续请求刷新。

调试入口位于“菜单 > 插件”：

- 插件卡片显示 host、权限、审批状态、来源、数据目录和加载错误。
- 贡献点区域显示命令、快捷键冲突和 UI 入口。
- 审计日志显示审批、文件、网络、storage 和 sidecar 操作。
- 损坏的 manifest 会保留为安装失败记录，但不会阻止 Milkup 启动。

## 14. 发布前检查清单

- 插件 ID 和所有 action/handler ID 稳定且唯一。
- `engines` 与实际测试过的 Milkup、plugin SDK 版本一致。
- 只请求确实使用的权限。
- 网络 origin 精确到协议、主机和端口。
- Worker 入口及依赖已打包为自包含 ESM。
- `resources` 列出了运行时所需的所有非入口文件。
- 所有 UI 和文档视图只返回受控输出。
- 插件禁用、重载和审批撤销后可以完整清理。
- `.milkup-plugin` 在干净环境中完成过安装、启用、重载和移除测试。
