# milkup v1 经验教训与 v2 回归清单

## 1. 来源

本文件基于：

- 用户反馈的 v1 已知问题。
- milkup v1 GitHub issues 中 closed/open issue 标题和部分正文。
- v2 自研内核架构目标。

重点参考 issue：

- [#19 数学公式、链接等成对语法提前闭合导致显示问题](https://github.com/Auto-Plugin/milkup/issues/19)
- [#51 代码块位于底部时光标不跟随滚动](https://github.com/Auto-Plugin/milkup/issues/51)
- [#74 源码模式切回预览模式快捷键失效](https://github.com/Auto-Plugin/milkup/issues/74)
- [#104 外部编辑器修改后希望立即加载](https://github.com/Auto-Plugin/milkup/issues/104)
- [#105 文件内容变化监听和覆盖功能](https://github.com/Auto-Plugin/milkup/issues/105)
- [#113 保存后仍提示未保存](https://github.com/Auto-Plugin/milkup/issues/113)
- [#166 Mermaid 渲染失败后影响 Tab 栏](https://github.com/Auto-Plugin/milkup/issues/166)
- [#173 打开本地文件后立即显示为修改状态](https://github.com/Auto-Plugin/milkup/issues/173)
- [#178 PDF/HTML 导出总是导出第一个页签](https://github.com/Auto-Plugin/milkup/issues/178)
- [#197 AI 回答复制粘贴后格式不支持](https://github.com/Auto-Plugin/milkup/issues/197)
- [#209 表格单元格换行后切换模式导致内容丢失](https://github.com/Auto-Plugin/milkup/issues/209)
- [#214 空行渲染问题](https://github.com/Auto-Plugin/milkup/issues/214)
- [#215 表格复制得到原始 Markdown](https://github.com/Auto-Plugin/milkup/issues/215)
- [#229 自动吞掉 Python 空行](https://github.com/Auto-Plugin/milkup/issues/229)
- [#230 AI 输出复制到 milkup 无法保持原格式渲染](https://github.com/Auto-Plugin/milkup/issues/230)
- [#235 源码模式下输入跳动](https://github.com/Auto-Plugin/milkup/issues/235)
- [#238 源码编辑有序/无序嵌套时 tab 不对](https://github.com/Auto-Plugin/milkup/issues/238)
- [#242 Windows 上有时无法打出中文符号](https://github.com/Auto-Plugin/milkup/issues/242)

## 2. 总体结论

v1 的许多问题不是单个功能 bug，而是架构层面的状态分裂：

- document state 分裂。
- history domain 分裂。
- source/live render mode 分裂。
- code block 子编辑器和主编辑器分裂。
- active tab 和 command context 分裂。
- renderer failure 和 app shell 分裂。
- save/dirty/file watcher 状态分裂。

v2 的核心目标不是逐个修补这些现象，而是建立统一的状态和事务边界。

## 3. History 必须是全局单一事实

### 3.1 v1 问题

已知问题：

- 源码/即时渲染切换时 history 丢失。
- 代码块使用独立编辑器时，代码块 history 与全文 history 割裂。
- history 有时丢失，无法撤回误删。

这些问题的根因通常是：

- 切换模式时重新创建编辑器实例。
- 子编辑器维护自己的 undo stack。
- 某些文档修改绕过了统一 transaction。
- history 绑定在 view 上，而不是绑定在 document state 上。

### 3.2 v2 约束

必须保证：

- history 绑定 `TextDocument` 和 transaction log，而不是绑定 DOM view。
- source/live render 切换只能改变 view mode，不能重建 document history。
- 代码块编辑必须通过父 editor transaction 写入全文档。
- 所有 document mutation 必须经过 `editor.dispatch(transaction)`。
- 默认所有修改都进入 history，除非显式标记 `addToHistory: false`。
- `addToHistory: false` 只能用于 selection、view state、非文档状态。

### 3.3 子编辑器策略

代码块、表格、公式等复杂块可以有局部 UI，但不能拥有独立文档真相。

推荐：

```text
CodeBlockView
   ↓ local input normalization
Parent Editor Transaction
   ↓ range mapped to full document
Global History
```

子编辑器可以维护临时 composition state，但提交文档修改时必须转为父编辑器 transaction。

### 3.4 回归测试

必须覆盖：

- 在 live mode 输入文字，切 source mode，再 undo。
- 在 source mode 输入文字，切 live mode，再 undo。
- 在代码块内输入多次，回到正文输入，再连续 undo。
- 删除全文后立即 undo。
- 粘贴大段内容后 undo。
- 插件 action 修改文档后 undo。
- mode switch 100 次后 history 不丢。

## 4. 模式切换不能改变文档身份

### 4.1 v1 问题

相关 issue：

- [#18 源码模式切换渲染模式时定位到对应位置](https://github.com/Auto-Plugin/milkup/issues/18)
- [#74 源码模式切回预览模式快捷键失效](https://github.com/Auto-Plugin/milkup/issues/74)
- [#235 源码模式下输入跳动](https://github.com/Auto-Plugin/milkup/issues/235)

表现：

- 切换模式后光标或滚动位置不稳定。
- 在源码模式点击后快捷键失效。
- 输入时视图跳动。
- 某些源码模式内部状态没有复位。

### 4.2 v2 约束

source/live/preview 只是 view projection，不是不同 editor。

必须有：

- 单一 `EditorState`。
- 单一 `TextDocument`。
- 单一 `HistoryState`。
- 单一 `SelectionState`。
- 多个 view projection。

切换流程：

```text
capture selection anchor
capture scroll anchor
set viewMode
recompute decorations
render visible blocks
restore selection
restore scroll
ensure cursor visible
```

### 4.3 回归测试

必须覆盖：

- 当前行含粗体、链接、代码、公式时切换模式。
- 当前光标在隐藏 marker 附近时切换模式。
- 当前滚动在文档中部时切换模式。
- 当前在代码块底部时切换模式。
- 快捷键在 body、editor、code block、dialog focus 下行为一致。

## 5. 粘贴必须走统一 Paste Pipeline

### 5.1 v1 问题

相关 issue：

- [#197 AI 回答复制粘贴后格式不支持](https://github.com/Auto-Plugin/milkup/issues/197)
- [#230 AI 输出复制到 milkup 无法保持原格式渲染](https://github.com/Auto-Plugin/milkup/issues/230)
- [#27 无法进行复制粘贴](https://github.com/Auto-Plugin/milkup/issues/27)
- [#14 macOS 中无法使用快捷键复制粘贴](https://github.com/Auto-Plugin/milkup/issues/14)

用户从 AI 产品、网页、Obsidian、Typora、Office、浏览器复制内容时，剪贴板可能包含：

- `text/plain`
- `text/html`
- 图片文件
- 自定义 MIME
- 平台特殊格式

如果只读取其中一种格式，会导致 Markdown 格式丢失或无法立即渲染。

### 5.2 v2 约束

必须建立统一 paste pipeline：

```text
ClipboardEvent
   ↓ collect formats
PasteNormalizer
   ↓ choose strategy
MarkdownConverter
   ↓ transaction
Incremental Parser
   ↓ live render
```

策略：

- 如果当前在代码块内，默认按纯文本粘贴，不做 Markdown 转换。
- 如果剪贴板有可信 Markdown，优先使用 Markdown。
- 如果只有 HTML，转换为 Markdown。
- 如果有图片，走 asset pipeline。
- 粘贴完成后必须立即触发受影响范围的增量解析。
- 粘贴 transaction 必须进入 history。

### 5.3 回归测试

必须覆盖：

- 从 AI 产品复制标题、列表、代码块、表格。
- 从浏览器复制富文本。
- 从 Obsidian/Typora 复制 Markdown。
- 在代码块中粘贴 Python，保留空行。
- 粘贴后立即切换模式。
- 粘贴后立即 undo。

## 6. 不能丢失空行和表格内容

### 6.1 v1 问题

相关 issue：

- [#209 表格单元格换行后切换模式导致内容丢失](https://github.com/Auto-Plugin/milkup/issues/209)
- [#214 空行渲染问题](https://github.com/Auto-Plugin/milkup/issues/214)
- [#229 自动吞掉 Python 空行](https://github.com/Auto-Plugin/milkup/issues/229)
- [#215 表格复制得到原始 Markdown](https://github.com/Auto-Plugin/milkup/issues/215)

这些问题属于高危数据损坏问题。

### 6.2 v2 约束

必须保证：

- renderer 不能做有损转换。
- table editor 不能在未确认时重写整张表。
- code block 内文本按 literal text 处理。
- 空行是文档内容，不能被 normalize 掉。
- HTML `<br>`、Markdown 换行、表格单元格换行需要明确语义。
- 模式切换不能触发 document rewrite。

任何可能有损的格式化必须是显式 command，并提供 preview 或 undo。

### 6.3 回归测试

必须覆盖：

- Python 代码块连续空行。
- 表格单元格内 `<br>`。
- 表格源码模式编辑后切 live mode。
- live mode 编辑表格后切 source mode。
- 空行在普通段落、列表、代码块、引用中的表现。
- 切换模式 20 次后文档源码 hash 不变。

## 7. Dirty、Save、File Watcher 需要明确状态机

### 7.1 v1 问题

相关 issue：

- [#113 保存后仍提示未保存](https://github.com/Auto-Plugin/milkup/issues/113)
- [#173 打开本地文件后立即显示修改状态](https://github.com/Auto-Plugin/milkup/issues/173)
- [#200 未保存文档关闭窗口没有提示](https://github.com/Auto-Plugin/milkup/issues/200)
- [#206 关闭窗口时任意 tab 未保存都需要提醒](https://github.com/Auto-Plugin/milkup/issues/206)
- [#104 外部编辑器修改后希望立即加载](https://github.com/Auto-Plugin/milkup/issues/104)
- [#105 文件内容变化监听和覆盖功能](https://github.com/Auto-Plugin/milkup/issues/105)

### 7.2 v2 约束

每个 document session 必须维护：

```ts
interface DocumentSession {
  id: string
  path?: string
  documentVersion: number
  savedVersion: number
  diskSnapshotHash?: string
  dirty: boolean
  readonly: boolean
  externalChangeState: 'none' | 'changed' | 'deleted' | 'conflict'
}
```

规则：

- 打开文件不能产生 document transaction。
- 打开文件后 `documentVersion === savedVersion`。
- 保存成功后更新 `savedVersion` 和 `diskSnapshotHash`。
- dirty 只能由文档内容变化产生，不能由 view state、theme、selection、parser cache 产生。
- 关闭窗口前检查所有 tab 的 dirty 状态。
- 外部文件变更不能直接覆盖内存修改，必须提示 reload/compare/overwrite。

### 7.3 回归测试

必须覆盖：

- 双击打开文件后不显示 dirty。
- 保存后 dirty 消失。
- 切换主题、设置、视图模式不产生 dirty。
- 多 tab 任意未保存关闭窗口都提示。
- 外部修改未 dirty 文档时可自动 reload 或提示。
- 外部修改 dirty 文档时进入 conflict 状态。

## 8. Command 必须绑定明确的 Document Context

### 8.1 v1 问题

相关 issue：

- [#178 PDF/HTML 导出总是导出第一个页签](https://github.com/Auto-Plugin/milkup/issues/178)
- [#110 标签页切换](https://github.com/Auto-Plugin/milkup/issues/110)
- [#171 一个多开文件引发的问题](https://github.com/Auto-Plugin/milkup/issues/171)

根因通常是 command 使用了全局当前状态或错误的 tab 索引。

### 8.2 v2 约束

所有 command/action 必须有明确 context：

```ts
interface ActionContext {
  appId: string
  windowId: string
  workspaceId?: string
  documentId?: string
  selection?: Selection
}
```

规则：

- 导出必须显式指定 documentId。
- 保存必须显式指定 documentId。
- 插件 action 默认只能操作当前 document scope。
- 多窗口、多 tab 不能共享隐式 active document。
- active document 变化必须是状态事件，不是临时全局变量。

### 8.3 回归测试

必须覆盖：

- 多 tab 分别导出。
- 多 tab 分别保存。
- 多窗口分别打开同名文件。
- active tab 切换期间执行快捷键。
- 插件 action 在当前 tab 上执行。

## 9. 渲染失败必须隔离

### 9.1 v1 问题

相关 issue：

- [#166 Mermaid 渲染失败后影响 Tab 栏](https://github.com/Auto-Plugin/milkup/issues/166)
- [#202 Mermaid 图文字概率显示不完整](https://github.com/Auto-Plugin/milkup/issues/202)
- [#198 表格里的 br/html 标签支持](https://github.com/Auto-Plugin/milkup/issues/198)
- [#164 HTML 标签渲染支持](https://github.com/Auto-Plugin/milkup/issues/164)

### 9.2 v2 约束

渲染层必须有错误边界：

- block render error 只影响当前 block。
- plugin render error 只影响当前 plugin node。
- Mermaid/HTML/Math 渲染失败回退源码。
- 渲染错误不能影响 tab、文件树、设置等 app shell。
- renderer 不能修改 document content。

### 9.3 回归测试

必须覆盖：

- 错误 Mermaid。
- 错误 HTML。
- 错误 Math。
- 插件 renderer throw。
- 渲染失败后切换 tab。
- 渲染失败后继续编辑和保存。

## 10. 输入法和平台快捷键必须专项测试

### 10.1 v1 问题

相关 issue：

- [#242 Windows 上有时无法打出中文符号](https://github.com/Auto-Plugin/milkup/issues/242)
- [#14 macOS 复制粘贴快捷键](https://github.com/Auto-Plugin/milkup/issues/14)
- [#24 macOS Cmd+Q 全局监听问题](https://github.com/Auto-Plugin/milkup/issues/24)
- [#180 macOS M1 Command+Q 没有退出进程](https://github.com/Auto-Plugin/milkup/issues/180)

### 10.2 v2 约束

必须专项处理：

- Windows 中文 IME。
- macOS 中文 IME。
- Linux 输入法。
- macOS Cmd 系列快捷键。
- Windows Ctrl 系列快捷键。
- Tauri menu accelerator。
- 编辑器 focus 与全局快捷键冲突。

输入法期间：

- composition 未结束时不做激进 Markdown 自动转换。
- composition update 不应进入 history。
- composition commit 才产生 document transaction。
- selection mapping 必须尊重 composition range。

### 10.3 回归测试

必须覆盖：

- Windows 中文标点。
- 中文输入中切换粗体 marker 附近。
- 中文输入中 undo。
- macOS Cmd+C/V/Q/W。
- 编辑器、代码块、设置弹窗中的快捷键隔离。

## 11. 滚动和光标可见性

### 11.1 v1 问题

相关 issue：

- [#51 代码块位于底部时光标超出可视范围没有跟随滚动](https://github.com/Auto-Plugin/milkup/issues/51)
- [#32 同步滚动](https://github.com/Auto-Plugin/milkup/issues/32)

### 11.2 v2 约束

每次 selection 变化后都需要执行：

```text
selection changed
   ↓
map selection to visual rect
   ↓
if rect outside viewport
   ↓
scroll into view with anchor policy
```

对代码块、表格、嵌入块需要额外支持内部坐标到全局坐标的映射。

### 11.3 回归测试

必须覆盖：

- 文档底部代码块连续输入。
- 大段代码块内部上下移动。
- live/source mode 切换后光标仍可见。
- 图片、Mermaid、表格前后输入。

## 12. 设置、插件和表单状态不能丢

### 12.1 v1 问题

相关 issue：

- [#132 粘贴请求头后切换设置页再回来内容消失](https://github.com/Auto-Plugin/milkup/issues/132)
- [#111 无法更改图床响应图片路径](https://github.com/Auto-Plugin/milkup/issues/111)
- [#96 uploadImage body type handling](https://github.com/Auto-Plugin/milkup/issues/96)

### 12.2 v2 约束

设置系统需要区分：

- draft state。
- validated state。
- saved state。
- secret state。

切换设置页不能丢 draft。插件配置保存失败必须展示错误。

### 12.3 回归测试

必须覆盖：

- 设置页输入后切换 tab。
- 粘贴多行 header。
- 保存失败后 draft 不丢。
- 插件配置 reload。

## 13. v2 必须建立 Issue Regression Suite

v1 每个高价值 issue 都应转化为 v2 的回归用例。

建议目录：

```text
tests/regressions/v1/
├─ history-mode-switch.test.ts
├─ history-code-block.test.ts
├─ paste-ai-output.test.ts
├─ paste-code-block-blank-lines.test.ts
├─ table-mode-switch-data-loss.test.ts
├─ dirty-state-open-save.test.ts
├─ file-watcher-conflict.test.ts
├─ active-document-export.test.ts
├─ renderer-error-boundary.test.ts
├─ ime-windows-chinese.test.ts
└─ cursor-scroll-code-block.test.ts
```

每个回归测试应包含：

- 原始 issue 链接。
- 最小复现文档。
- 操作步骤。
- 期望 document text。
- 期望 selection。
- 期望 history state。
- 期望 view state。

## 14. 对 v2 架构的直接要求

综合 v1 问题，v2 必须满足：

- 单一 document state。
- 单一 global history。
- mode switch 不重建 editor。
- 子编辑器无独立文档真相。
- 所有修改必须通过 transaction。
- paste pipeline 统一。
- parser 支持破损语法。
- renderer 有错误边界。
- dirty/save/file watcher 有明确状态机。
- command/action 必须绑定 document context。
- 输入法和快捷键专项测试。
- 每个历史 bug 都能用 operation log 重放。

这些要求应当作为 v2 MVP 的基础门槛，而不是后续优化项。
