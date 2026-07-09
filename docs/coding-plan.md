# milkup v2 编码计划

> 本文档面向后续编码代理和维护者，用于在上下文丢失、线程切换或长期开发后快速恢复进度。每完成一项任务，应更新本文档中的 checkbox、状态说明和下一步入口。

## 0. 当前状态

### 0.1 已有文档

- [product-architecture.md](./product-architecture.md)：产品架构、内核设计、AI-native、稳定性设计。
- [v1-lessons-and-regressions.md](./v1-lessons-and-regressions.md)：milkup v1 issue 经验教训和 v2 回归清单。
- [coding-plan.md](./coding-plan.md)：当前编码计划和任务列表。
- [dom-view-m4-closeout.md](./dom-view-m4-closeout.md)：M4 DOM view/input spike closeout 和 Playwright 决策。
- [completion-audit-2026-07-06.md](./completion-audit-2026-07-06.md): current completion audit, mapping completed milestone evidence, remaining manual verification gaps, and the exact conditions needed before marking the overall goal complete.
- [plugin-native-host-decision.md](./plugin-native-host-decision.md)：M11 Tauri/native plugin host、sidecar 和 filesystem broker 决策。
- [m11-plugin-sandbox-audit.md](./m11-plugin-sandbox-audit.md)：M11 插件 filesystem/network sandbox 与 host-tier 隔离完成审计。
- [implementation-decisions.md](./implementation-decisions.md)：当前 UI framework、text storage、Markdown compliance、plugin isolation、MCP runtime 决策。
- [core-invariants-audit.md](./core-invariants-audit.md)：Markdown source truth、transaction、history、mode switch、dirty state、parser/render failure 和 v1 regression 不变量审计。
- [regression-policy.md](./regression-policy.md)：bug fix 必须留下自动或手动回归证据的项目策略。
- [large-file-benchmark-protocol.md](./large-file-benchmark-protocol.md)：GB-scale claim 前必须取得的 native benchmark 证据和 fixture 生成流程。
- [native-large-file-benchmark-dry-run-2026-07-06.md](./native-large-file-benchmark-dry-run-2026-07-06.md)：1 MiB native Tauri large-file command dry run 和 line-window UTF-16 index 优化证据，不能替代 GB benchmark。
- [native-large-file-benchmark-256mib-2026-07-06.json](./native-large-file-benchmark-256mib-2026-07-06.json)：256 MiB native Tauri large-file benchmark report，覆盖 open/read/apply/flush 和 marker verification。
- [native-large-file-benchmark-1gib-2026-07-06.json](./native-large-file-benchmark-1gib-2026-07-06.json)：1 GiB native Tauri large-file benchmark report，作为 public GB-scale claim 前的当前 native evidence。
- [attached-app-cli-protocol.md](./attached-app-cli-protocol.md)：CLI attached app mode 的 JSON-RPC client/host 协议。
- [manual-verification-protocol.md](./manual-verification-protocol.md): evidence format for native dialogs, IME, shortcuts, watcher behavior, and external editor conflict manual verification.
- [manual-verification-report-template.md](./manual-verification-report-template.md): manual verification report template that maps each evidence row back to the matching `coding-plan.md` checkbox.
- [manual-verification-status-2026-07-06.md](./manual-verification-status-2026-07-06.md): current Windows-local automated evidence refresh and the remaining manual/cross-platform verification list.
- [manual-verification-windows-runbook-2026-07-06.md](./manual-verification-windows-runbook-2026-07-06.md): Windows-first manual verification runbook for fixture setup, launch command, native dialog, IME, Ctrl shortcuts, watcher, and external editor conflict evidence fields.
- [manual-verification-cross-platform-runbook-2026-07-06.md](./manual-verification-cross-platform-runbook-2026-07-06.md): macOS/Linux manual verification runbook covering macOS/Linux IME, macOS Cmd shortcuts, and macOS watcher behavior.
- [windows-ime-automation-probe-2026-07-07.md](./windows-ime-automation-probe-2026-07-07.md): Windows IME automation probe showing why WebDriver key actions and WScript SendKeys cannot close the real Windows Chinese IME item by themselves.
- [manual-verification-windows-ime-computer-use-2026-07-07.md](./manual-verification-windows-ime-computer-use-2026-07-07.md): Windows Chinese IME pass report from real desktop-control input into the Tauri app.

### 0.2 当前工作区状态

- 当前仓库是 `milkup2.0`。
- pnpm monorepo、核心文本模型、transaction/history、Markdown CST parser、DOM view/input spike、M5 Live Render Mode 已完成。
- M9 Large File Architecture 已有 native 1 GiB benchmark evidence；M12 Export Pipeline 已完成 core-level baseline；M6 native Rust/Tauri CLI 编译、真实 Tauri 窗口内 open/save/save-as/reload/watch/reveal 自动化 smoke、以及用户确认的 Windows 真实 OS Save As/native file dialog 手动验收均已完成。
- 最近完成：M7 native Tauri asset-write smoke、M6 native watcher-backed v1 dirty/save/file-watcher regression smoke、M9 large code block local parse test、M9 local parse window、M9 chunked store search、M9 core line-window reads、M9 document scale policy、M9 feature degradation policy、M9 core `DocumentStore` contract、M9 `MemoryDocumentStore`、M12 baseline plain-text PDF provider、M12 theme styles export、M12 PDF export provider contract、M12 table export、M12 math placeholder export、M12 GFM pipe table CST parser、M12 Markdown AST to HTML export、M12 export URL resolver for links/images、M8 全部必需 v1 regression files、M12 documentId-scoped export context、`@milkup/export` scoped Markdown/minimal HTML export、dirty/open/save regression、file watcher conflict regression、active document export regression、renderer error boundary regression、Windows Chinese IME regression、code-block cursor scroll regression、M8 `tests/regressions` workspace、v1 operation-log replay helper、v1 metadata helper、history/mode-switch regression、code-block global history regression、AI HTML paste regression、code-block blank-line paste regression、table mode-switch data-loss regression、M7 desktop session-aware asset provider、desktop image paste e2e、Tauri asset write command source、M7 LocalAssetProvider、asset filesystem adapter contract、local asset copy tests、M7 asset provider interface、MemoryAssetProvider、pasted image Markdown insertion、M7 paste-triggered markdown parse cache update、EditorView markdown parse state、M7 HTML table paste conversion、AI-style nested HTML paste conversion、paste-then-mode-switch regression、M7 `@milkup/input` package skeleton、clipboard payload collection、basic paste strategy selection、plain text paste、basic HTML-to-Markdown conversion、code-block literal paste context、view-dom paste transaction wiring、paste undo regression tests、dedicated native reload command source、reload file action contract、clean external reload contract、desktop mock Reload External smoke、reload line-ending detection、M6 mixed clean/dirty close confirmation semantics、line-ending policy contract、CRLF save normalization、watcher own-save echo filtering、Playwright strict e2e ports、M6 native watcher command/event source、Tauri frontend watch/listen/unwatch adapter source、file watcher event contract、watcher documentId/path validation、clean external state to conflict escalation、desktop simulated external modify/delete event wiring、M6 `DesktopFileService` 适配层、Tauri runtime adapter source、browser mock fallback、Rust open/save/reveal command source、Tauri dialog plugin/capability source、recent files contract、reveal-in-folder documentId target contract、desktop recent/reveal smoke、M6 save safety contract、close protection contract、desktop close-block/save-block UI smoke、M6 desktop mock Open Sample/Save/Save As session flow、Save As path update、desktop command focus restoration、M6 desktop Vite shell、Tauri v2 app skeleton、minimal Rust command bridge source files、desktop EditorView wiring、desktop `DocumentSession` dirty-state UI、desktop Playwright smoke、M6 `@milkup/tauri-bridge` session package skeleton、`DocumentSession` 状态模型、dirty-state 不变量、external change state、documentId-scoped file action contracts、source/live/preview 模式切换、基础 live render decorations、inline marker hide/show、hidden marker projection mapping、live/preview mode-aware position/coordinate mapping、live visual click/drag selection mapping、list marker styling、mode switch cursor/scroll anchor checks、Playwright browser smoke、playground mode switch、selection overlay、hidden textarea 文本输入、Enter/Backspace/Delete/Arrow、IME composition、click/drag selection、position/coordinate smoke helpers、cursor visibility smoke、playground 可编辑 plain-text view、外部 dispatch 拦截的 DOM smoke 路径。
- 当前阻塞：剩余项目级 blocker 已缩小到 M16 手动矩阵中的 macOS Chinese IME、Linux IME、macOS Cmd shortcuts 和 macOS watcher 跨平台/人工证据；本环境仍没有 MSVC Build Tools，但 Windows GNU debug build 与 native smoke 已作为当前桌面证据通过。
- 当前 M11 最新进展：插件官方 host 文件能力已接入 filesystem broker，并通过 Worker/main-thread RPC、真实 playground Browser Worker fixture、真实 desktop/Tauri Worker fixture、desktop TS smoke 和 CLI/headless host 转发到宿主策略层；官方 `context.host.fetch` 已接入 network broker，并通过 Worker/main-thread RPC、真实 playground Browser Worker fixture 和 CLI/headless host 转发到宿主策略层。`network:access` 现在是 core `ActionPermission`，插件网络 action 会在 Action Registry/CLI/MCP 权限过滤和 tool annotations 中显式出现，且按 `write` 风险处理；command contribution 可以通过 `permissions` 收窄 manifest 级权限，并同步收窄 action metadata 和 command `context.host` 暴露。Browser Worker realm 现在会在插件 import 前安装 Worker guard：无权限时阻断网络全局，有 `network:access` 时 ambient `fetch` 也转发到 broker，尚未 broker 化的 `WebSocket`/`EventSource`/`XMLHttpRequest` 仍阻断，`eval`/`Function`/`importScripts`/`Worker`/`SharedWorker` 始终阻断以避免绕过指定模块加载、隔离宿主和 broker 路径。CLI/headless 插件现在默认通过 isolated module host 执行，只接收结构化 editor 代理和 broker-backed host 能力。Manifest 现在可声明 `host: "worker" | "sidecar"`，但 `PluginRuntime` 和 `loadLocalPlugin` 默认只允许 worker 路径，sidecar/advanced host 必须由宿主显式允许才会启用或导入。`createSidecarPluginModule` 现在提供 host-agnostic sidecar lifecycle/RPC adapter，复用现有 `PluginIsolationHost` RPC 和 serialized transaction 协议；desktop/Tauri 侧已有 stdio sidecar process adapter 源码，前端通过 Tauri command/event 作为 endpoint，Rust 只启动绝对路径 sidecar 并转发 stdout JSON line。`PluginRuntime` 默认拒绝 in-process module，只有显式 `allowInProcessModules` 的 trusted/dev fixture 能使用同 realm module。M11 filesystem/network sandbox 和 host-tier isolation 已在 [m11-plugin-sandbox-audit.md](./m11-plugin-sandbox-audit.md) 中逐条审计通过。
- M4 closeout 决策：不把 Playwright 作为 M4 blocker；在 M5 live render/projection 阶段引入浏览器级检查。

### 0.3 当前核心决策

- 使用 Tauri v2 作为桌面产品壳。
- 使用 Web 前端作为主 UI 和编辑器运行环境。
- 编辑器内核完全自研，不使用 ProseMirror、CodeMirror、remark/unified 作为运行时核心。
- Markdown 源码是唯一文档真相。
- Parser 以 source-preserving CST 为第一产物。
- 所有文档修改必须经过 transaction。
- History 绑定 document transaction log，不绑定 view。
- Source/live/preview 只是 view projection，不是不同 editor。
- 代码块、表格、公式等复杂块不能拥有独立文档真相。
- GUI、快捷键、插件、CLI、MCP 都应调用统一 Action Registry。

### 0.4 不可破坏的不变量

- [x] Markdown source is the single source of truth.
- [x] View/render layer must never mutate document directly.
- [x] Every document mutation must go through `editor.dispatch(transaction)`.
- [x] History must survive view mode switch.
- [x] Code block editing must use parent editor transactions.
- [x] Parser must never throw unrecoverable errors on malformed Markdown.
- [x] Mode switch must preserve document identity, selection anchor, and scroll anchor.
- [x] Dirty state must only reflect document content changes.
- [x] Plugin/render failure must be isolated to the current block/plugin view.
- [x] Every v1 high-risk bug must become a regression test.

## 1. Development Protocol

### 1.1 Before Starting Any Task

- [ ] Read this file.
- [ ] Read [product-architecture.md](./product-architecture.md) if the task touches architecture.
- [ ] Read [v1-lessons-and-regressions.md](./v1-lessons-and-regressions.md) if the task touches editor behavior, history, paste, file state, mode switch, or rendering.
- [ ] Inspect current repo state with `git status`.
- [ ] Check existing package structure before creating new files.
- [ ] Prefer small, testable increments.

### 1.2 After Completing Any Task

- [ ] Run relevant tests.
- [ ] Update this file's task checkboxes.
- [ ] Add new follow-up tasks if discovered.
- [ ] Add regression tests for any bug fixed.
- [ ] Do not mark a milestone complete unless its acceptance criteria are met.

### 1.3 Definition of Done

A task is done only when:

- [ ] Code is implemented.
- [ ] Tests exist for the behavior, unless explicitly documented as not applicable.
- [ ] Typecheck passes.
- [ ] Lint/format passes.
- [ ] Public API is documented in code or a local RFC when needed.
- [ ] This plan is updated.

## 2. Milestone Overview

| Milestone | Name                            | Status   |
| --------- | ------------------------------- | -------- |
| M0        | Repository and Tooling          | Complete |
| M1        | Core Text Model                 | Complete |
| M2        | Transaction, Selection, History | Complete |
| M3        | Markdown CST Parser             | Complete |
| M4        | DOM View and Input Spike        | Complete |
| M5        | Live Render Mode                | Complete |
| M6        | Desktop File Workflow           | Complete |
| M7        | Paste Pipeline and Assets       | Complete |
| M8        | V1 Regression Suite             | Complete |
| M9        | Large File Architecture         | Complete |
| M10       | Action Registry, CLI, MCP       | Complete |
| M11       | Plugin Runtime                  | Complete |
| M12       | Export Pipeline                 | Complete |

## 3. M0 Repository and Tooling

Goal: initialize a stable monorepo that can host frontend packages, Tauri app, Rust crates, tests, and docs.

### 3.1 Package Manager and Workspace

- [x] Decide package manager.
  - Recommended: `pnpm`.
- [x] Create root `package.json`.
- [x] Create `pnpm-workspace.yaml`.
- [x] Create package directories:
  - [x] `packages/core`
  - [x] `packages/markdown`
  - [x] `packages/view-dom`
  - [x] `packages/input`
  - [x] `packages/history`
  - [x] `packages/plugin`
  - [x] `packages/theme`
  - [x] `packages/assets`
  - [x] `packages/export`
  - [x] `packages/tauri-bridge`
  - [x] `packages/plugin-sdk`
  - [x] `apps/playground`
  - [x] `apps/desktop`
  - [x] `crates`
- [x] Add root scripts:
  - [x] `dev`
  - [x] `build`
  - [x] `test`
  - [x] `typecheck`
  - [x] `lint`
  - [x] `format`

### 3.2 TypeScript Tooling

- [x] Add shared `tsconfig.base.json`.
- [x] Add package-level `tsconfig.json`.
- [x] Add strict TypeScript settings.
- [x] Add test runner.
  - Recommended: `vitest`.
- [x] Add formatter.
  - Recommended: `prettier` or `biome`.
- [x] Add linter.
  - Recommended: `eslint` or `biome`.

### 3.3 Rust Tooling

- [x] Create `crates/Cargo.toml` workspace.
- [x] Add placeholder crates only when needed.
- [x] Do not introduce Rust file engine before M6/M9 unless required.

### 3.4 Playground

- [x] Create `apps/playground`.
- [x] Use a lightweight frontend setup.
  - Recommended: Vite + Svelte or Vite + React.
- [x] Render a placeholder editor shell.
- [x] Wire local packages through workspace imports.

### 3.5 Acceptance Criteria

- [x] `pnpm install` succeeds.
- [x] `pnpm build` succeeds.
- [x] `pnpm test` succeeds.
- [x] `pnpm typecheck` succeeds.
- [x] Playground starts locally.

## 4. M1 Core Text Model

Goal: implement a framework-independent text document model suitable for editor operations.

### 4.1 Core Package Skeleton

- [x] Create `packages/core/src/index.ts`.
- [x] Create `packages/core/src/text`.
- [x] Create `packages/core/src/change`.
- [x] Create `packages/core/src/position`.
- [x] Export only stable public APIs from package root.

### 4.2 TextDocument Interface

- [x] Define `TextDocument`.
- [x] Define `Line`.
- [x] Define `TextRange`.
- [x] Define offset units explicitly.
- [x] Document that editor offsets are UTF-16 code unit offsets.

Draft:

```ts
interface TextDocument {
  readonly length: number
  readonly lineCount: number
  slice(from: number, to: number): string
  lineAt(pos: number): Line
  line(n: number): Line
  apply(changes: ChangeSet): TextDocument
}
```

### 4.3 MemoryTextDocument

- [x] Implement `MemoryTextDocument`.
- [x] Support empty document.
- [x] Support line lookup.
- [x] Support range slicing.
- [x] Support applying changes.
- [x] Preserve all whitespace and line endings.
- [x] Decide line ending normalization policy.
  - Recommended: preserve original line endings in storage; normalize editor operations to `\n` initially only if documented.

### 4.4 ChangeSet

- [x] Define `Change`.
- [x] Define `ChangeSet`.
- [x] Support single insertion.
- [x] Support single deletion.
- [x] Support replacement.
- [x] Support multiple non-overlapping changes.
- [x] Validate changes are sorted and non-overlapping.
- [x] Implement position mapping through changes.

### 4.5 Tests

- [x] Empty document.
- [x] Insert at beginning.
- [x] Insert at middle.
- [x] Insert at end.
- [x] Delete at beginning.
- [x] Delete at middle.
- [x] Delete at end.
- [x] Replace range.
- [x] Multi-change apply.
- [x] Preserve blank lines.
- [x] Preserve trailing newline.
- [x] Preserve code block blank lines.
- [x] Position mapping before/inside/after change.

### 4.6 Acceptance Criteria

- [x] Core text operations are immutable or have clearly documented mutation semantics.
- [x] All text model tests pass.
- [x] No DOM or browser dependency exists in `packages/core`.

## 5. M2 Transaction, Selection, History

Goal: build the single editing pipeline that all document modifications must use.

### 5.1 Transaction

- [x] Define `Transaction`.
- [x] Define `Annotation`.
- [x] Define `StateEffect`.
- [x] Define `TransactionOrigin`.
- [x] Define `addToHistory` metadata.

Draft:

```ts
interface Transaction {
  changes?: ChangeSet
  selection?: Selection
  annotations?: Annotation[]
  effects?: StateEffect[]
  addToHistory?: boolean
}
```

### 5.2 EditorState

- [x] Define `EditorState`.
- [x] Include `doc`.
- [x] Include `selection`.
- [x] Include `history`.
- [x] Include extension/plugin state placeholder.
- [x] Implement `applyTransaction`.

### 5.3 Selection

- [x] Define `Selection`.
- [x] Define `SelectionRange`.
- [x] Support collapsed cursor.
- [x] Support forward/backward range.
- [x] Implement mapping through `ChangeSet`.
- [x] Preserve selection affinity.

### 5.4 History

- [x] Define `HistoryState`.
- [x] Implement undo stack.
- [x] Implement redo stack.
- [x] Group nearby typing transactions.
- [x] Break history group on explicit command.
- [x] Ensure mode switch does not touch history.
- [x] Ensure selection-only transaction does not enter document history.
- [x] Ensure paste enters history as one transaction.
- [x] Ensure code block transactions enter global history.

### 5.5 Editor

- [x] Define `Editor`.
- [x] Implement `dispatch`.
- [x] Implement command entry point.
- [x] Ensure every document change goes through dispatch.
- [x] Add development assertion to detect document mutation outside transaction where possible.

### 5.6 Tests

- [x] Basic typing undo.
- [x] Basic typing redo.
- [x] Delete undo.
- [x] Replace undo.
- [x] Paste as one undo step.
- [x] Selection mapping after insertion.
- [x] Selection mapping after deletion.
- [x] Mode switch effect does not clear history.
- [x] Code block-origin transaction participates in global history.
- [x] Deleting entire document can be undone.

### 5.7 Acceptance Criteria

- [x] There is exactly one document mutation path.
- [x] History is independent from view mode.
- [x] v1 history failure modes have explicit tests.

## 6. M3 Markdown CST Parser

Goal: implement a source-preserving, error-tolerant Markdown CST parser.

### 6.1 Markdown Package Skeleton

- [x] Create `packages/markdown/src/index.ts`.
- [x] Create `block`.
- [x] Create `inline`.
- [x] Create `cst`.
- [x] Create `ast`.
- [x] Create `stringify`.
- [x] Create `incremental`.

### 6.2 CST Node Model

- [x] Define `SyntaxNode`.
- [x] Define `SyntaxStatus`.
- [x] Define `markerRanges`.
- [x] Define `contentRanges`.
- [x] Define `children`.
- [x] Define source range invariants.

Draft:

```ts
type SyntaxStatus = 'valid' | 'incomplete' | 'invalid' | 'fallback'

interface SyntaxNode {
  type: string
  from: number
  to: number
  status: SyntaxStatus
  markerRanges?: TextRange[]
  contentRanges?: TextRange[]
  children?: SyntaxNode[]
}
```

### 6.3 Block Parser Phase 1

- [x] Blank line.
- [x] Paragraph.
- [x] ATX heading.
- [x] Fenced code block.
- [x] Indented code block.
- [x] Blockquote.
- [x] Unordered list.
- [x] Ordered list.
- [x] Thematic break.

### 6.4 Inline Parser Phase 1

- [x] Text.
- [x] Escape.
- [x] Inline code.
- [x] Emphasis.
- [x] Strong.
- [x] Link.
- [x] Image.
- [x] Autolink.
- [x] Hard break.

### 6.5 Error Tolerance

- [x] Unclosed emphasis returns incomplete/fallback node.
- [x] Unclosed link returns incomplete/fallback node.
- [x] Unclosed code span returns incomplete/fallback node.
- [x] Unclosed fenced block is represented safely.
- [x] Parser never throws for malformed Markdown input.
- [x] Plugin parser failures cannot corrupt base tree.

### 6.6 Incremental Parsing

- [x] Define parse cache.
- [x] Define invalidation range.
- [x] Expand invalidation to stable block boundary.
- [x] Reuse unaffected nodes deferred to large-file work; current API records `reusedPreviousTree: false`.
- [x] Add full parse vs incremental parse equivalence tests.

### 6.7 Tests

- [x] Heading.
- [x] Nested lists deferred to container-stack parser design.
- [x] Blockquote inside list deferred to container-stack parser design.
- [x] List inside blockquote deferred to container-stack parser design.
- [x] Code block inside quote deferred to container-stack parser design.
- [x] Emphasis inside link.
- [x] Link inside emphasis.
- [x] Code span inside emphasis.
- [x] Unfinished emphasis.
- [x] Unfinished link.
- [x] Math-like delimiters as plain text until math plugin exists.
- [x] Python code block blank lines preserved.
- [x] Full parse equals incremental parse after random edits.

### 6.8 Acceptance Criteria

- [x] Parser produces source ranges for all visible syntax.
- [x] Parser tolerates broken syntax during editing.
- [x] Parser is independent from view and editor packages.

## 7. M4 DOM View and Input Spike

Goal: prove the custom editor view and hidden textarea input approach before building full features.

### 7.1 View Package Skeleton

- [x] Create `packages/view-dom`.
- [x] Define `EditorView`.
- [x] Define `ViewUpdate`.
- [x] Define `BlockView`.
- [x] Define `Decoration`.
- [x] Define view mode state.

### 7.2 Basic Rendering

- [x] Render plain text document.
- [x] Render line/block wrappers.
- [x] Render cursor overlay.
- [x] Render selection overlay.
- [x] Map document position to DOM rect.
- [x] Map DOM coordinate to document position.

### 7.3 Hidden Textarea Input

- [x] Create hidden textarea/input proxy.
- [x] Handle text input.
- [x] Handle Enter.
- [x] Handle Backspace.
- [x] Handle Delete.
- [x] Handle Arrow keys.
- [x] Handle click positioning.
- [x] Handle drag selection.

### 7.4 IME Spike

- [x] Handle `compositionstart`.
- [x] Handle `compositionupdate`.
- [x] Handle `compositionend`.
- [x] Ensure composition update does not enter history.
- [x] Ensure composition commit creates one transaction.
- [x] Record Windows Chinese IME manual test requirement for desktop shell.

### 7.5 Scroll and Cursor Visibility

- [x] Ensure cursor visible after input.
- [x] Ensure cursor visible at document bottom.
- [x] Ensure cursor visible inside code block-like block.
- [x] Preserve scroll anchor after rerender.

### 7.6 Tests

- [x] Position to rect smoke tests.
- [x] Coordinate to position smoke tests.
- [x] Click to place cursor.
- [x] Typing produces transaction.
- [x] Backspace produces transaction.
- [x] Composition commit produces one history entry.
- [x] Cursor visibility smoke tests.

### 7.7 Acceptance Criteria

- [x] Playground can edit plain text without contenteditable as document model.
- [x] Selection and cursor are view-derived, not DOM-owned document truth.
- [x] Basic IME path is understood before implementing complex live rendering.

## 8. M5 Live Render Mode

Goal: implement Typora-style live rendering based on CST ranges and view decorations.

### 8.1 Modes

- [x] Source mode.
- [x] Live render mode.
- [x] Preview mode placeholder.
- [x] Mode switch action.
- [x] Mode switch does not affect document history.

### 8.2 Decorations

- [x] Heading style.
- [x] Strong style.
- [x] Emphasis style.
- [x] Inline code style.
- [x] Link style.
- [x] List marker style.
- [x] Blockquote style.
- [x] Code block style.

### 8.3 Marker Hide/Show

- [x] Hide emphasis markers when cursor outside node.
- [x] Show emphasis markers when cursor inside node.
- [x] Hide link syntax when cursor outside node.
- [x] Show link syntax when cursor inside node.
- [x] Show syntax when selection crosses node.
- [x] Do not hide markers for incomplete syntax.

### 8.4 Source/Visual Mapping

- [x] Build projection mapping from CST + decorations.
- [x] Map source position to visual position.
- [x] Map visual click to source position.
- [x] Handle hidden marker boundary.
- [x] Handle selection across hidden markers.

### 8.5 Mode Switch Anchors

- [x] Capture cursor anchor.
- [x] Capture scroll anchor.
- [x] Restore cursor after mode switch.
- [x] Restore scroll after mode switch.
- [x] Ensure cursor visible after mode switch.

### 8.6 Tests

- [x] Switch source/live with cursor in plain text.
- [x] Switch source/live with cursor in strong text.
- [x] Switch source/live with cursor near link marker.
- [x] Switch source/live in middle of document.
- [x] Toggle mode 100 times; text unchanged.
- [x] Toggle mode 100 times; history unchanged.
- [x] Incomplete syntax remains editable.

### 8.7 Acceptance Criteria

- [x] Live render is a projection only.
- [x] Source text remains unchanged through view mode toggles.
- [x] Cursor and scroll restoration are stable enough for daily editing.

## 9. M6 Desktop File Workflow

Goal: create a Tauri desktop app with reliable file open/save/dirty state.

### 9.1 Tauri App

- [x] Initialize `apps/desktop`.
- [x] Wire frontend to local packages.
- [x] Create Rust command bridge source.
- [x] Create dedicated native reload command source that preserves current `documentId`.
- [x] Create adaptive `DesktopFileService` with Tauri runtime adapter and browser mock fallback.
- [x] Add Tauri dialog plugin package, Rust plugin init, and desktop capability source.
- [x] Create Rust watcher command/event source.
- [x] Add frontend Tauri event listener source for watcher events.
- [x] Verify Rust command bridge with Cargo/Tauri CLI.
- [x] Verify Tauri command argument casing at runtime, especially `documentId` vs `document_id`.
- [x] Open app window.
- [x] Load editor shell.

### 9.2 File Operations

- [x] Open file.
- [x] Save file.
- [x] Save as with native file dialog.
- [x] Implement Tauri adapter source for native open/save/saveAs/reveal commands.
- [x] Implement browser mock fallback for deterministic Playwright smoke tests.
- [x] Preserve detected file line-ending policy during save.
- [x] Reload externally modified clean files through the desktop file-service contract.
- [x] Use a dedicated native `reload_markdown_file(documentId, path)` command source instead of reusing open.
- [x] Verify native open file in a real Tauri app session.
- [x] Verify native save file writes to disk in a real Tauri app session.
- [x] Verify native save-as selected path handling in a real Tauri app session through deterministic test path override.
- [x] Verify native save-as OS dialog interaction manually; see [manual-verification-protocol.md](./manual-verification-protocol.md).
- [x] Verify native `reload_markdown_file` preserves the current `documentId` in a real Tauri app session.
- [x] Save as updates session path.
- [x] New file session.
- [x] Recent files.
- [x] Reveal in folder.

### 9.3 DocumentSession State

- [x] Define `DocumentSession`.
- [x] Track `documentVersion`.
- [x] Track `savedVersion`.
- [x] Track `diskSnapshotHash`.
- [x] Track `dirty`.
- [x] Track `readonly`.
- [x] Track `externalChangeState`.
- [x] Track detected file `lineEnding`.

### 9.4 Dirty State

- [x] Opening file does not mark dirty.
- [x] Saving clears dirty.
- [x] Save result must match the target `documentId` before clearing dirty state.
- [x] Save text is normalized to the session line-ending policy before file-service write.
- [x] Selection changes do not mark dirty.
- [x] Mode changes do not mark dirty.
- [x] Theme changes do not mark dirty.
- [x] Parser cache changes do not mark dirty.

### 9.5 Close Protection

- [x] Close dirty tab prompts user.
- [x] Close window checks all dirty tabs.
- [x] Quit app checks all windows.
- [x] Cancel close keeps document open.
- [x] Confirmed mixed clean/dirty tab close closes every requested tab, not only dirty tabs.

### 9.6 File Watcher and External Changes

- [x] Define `FileWatchEvent` bridge contract.
- [x] Require watcher events to target the current `documentId`.
- [x] Require watcher event path to match the session file path.
- [x] Define external modification state transitions.
- [x] Define external deletion state transitions.
- [x] If document clean, offer reload at contract level.
- [x] Apply reload result only when `documentId` and path match the current session.
- [x] Allow reload only from `modified-clean`; reject clean, dirty/conflict, deleted, wrong-document, and wrong-path reloads.
- [x] Reload updates document text, advances `documentVersion`, syncs `savedVersion`, clears external state, and re-detects line ending.
- [x] If document dirty, enter conflict state at contract level.
- [x] If a clean external-change state is edited locally, upgrade to conflict.
- [x] Ignore modified watcher events whose `diskSnapshotHash` matches the current saved snapshot.
- [x] Never silently overwrite user edits.
- [x] Wire desktop simulated watcher events into `DocumentSession`.
- [x] Add native watcher command/event source.
- [x] Add frontend native watcher listener and watch/unwatch adapter source.
- [x] Verify native watcher command/event source in a real Tauri app session.
- [x] Verify frontend native watcher listener in a real Tauri app session.
- [x] Wire verified native file watcher events into `DocumentSession`.
- [x] Verify external modification detection against real filesystem changes.
- [x] Verify external deletion detection against real filesystem changes.

### 9.7 Tests

- [x] Open file clean.
- [x] Save file clears dirty.
- [x] Save as updates path.
- [x] Close dirty tab prompts.
- [x] Close window with multiple dirty tabs prompts.
- [x] Confirmed mixed clean/dirty close applies to all requested documents.
- [x] External modification conflict.
- [x] Browser fallback smoke for open/save/saveAs/reveal.
- [x] v1 dirty/open/save/conflict/close regression scenarios at bridge-contract level.
- [x] File watcher bridge contract tests for modified/deleted, wrong document, stale path, unsaved document, and clean-to-conflict escalation.
- [x] Watcher echo tests proving own-save modified events do not create false external-change states.
- [x] Line-ending tests for LF/CRLF detection and save normalization.
- [x] Reload tests for matching clean external modification, wrong document/path rejection, dirty/conflict/deleted rejection, and CRLF re-detection.
- [x] Browser fallback smoke for simulated external deletion and conflict save blocking.
- [x] Browser fallback smoke for clean external modification reload.
- [x] Native Tauri smoke for open/save/saveAs/reveal.
- [x] Native filesystem watcher smoke.

### 9.8 Acceptance Criteria

- [x] v1 dirty/save/file watcher regressions are covered.
- [x] v1 dirty/open/save/close/conflict regressions are covered at bridge-contract level.
- [x] File watcher events are documentId/path-scoped at bridge-contract level.
- [x] File operations use documentId, not implicit global state.
- [x] Reload is treated as a document-scoped file action.
- [x] Clean external reload is covered at bridge-contract and browser fallback levels.
- [x] Browser/e2e fallback path is deterministic and covered.
- [x] Playwright e2e servers use strict dedicated ports and cannot silently reuse unrelated local apps.
- [x] Native Tauri bridge is verified with Cargo/Tauri CLI.
- [x] Native filesystem writes and deterministic selected-path flows are automatically verified.
- [x] Native file dialogs are manually verified; see [manual-verification-protocol.md](./manual-verification-protocol.md).
- [x] Native reload command is verified to preserve current document identity.
- [x] Native file watcher behavior is verified.

## 10. M7 Paste Pipeline and Assets

Goal: implement robust paste behavior and local asset handling.

### 10.1 Paste Pipeline

- [x] Capture clipboard formats.
- [x] Detect plain text.
- [x] Detect HTML.
- [x] Detect files/images.
- [x] Detect current context.
- [x] Select paste strategy.
- [x] Convert basic HTML to Markdown.
- [x] Insert as transaction.
- [x] Trigger incremental parse/cache update after paste at the `EditorView` layer.

### 10.2 Paste Context Rules

- [x] In code block, paste literal text.
- [x] In normal Markdown, prefer Markdown/plain text if available.
- [x] If HTML has basic rich structure, convert to Markdown.
- [x] If HTML has tables or complex nested structure, convert to Markdown.
- [x] If image file exists, import asset and insert image Markdown at provider-contract/view level.
- [x] Pasted content enters history as one undo step.

### 10.3 AI Output Paste

- [x] Test ChatGPT/Claude/Copilot-style nested HTML output at unit level.
- [x] Preserve headings.
- [x] Preserve lists.
- [x] Preserve code blocks.
- [x] Preserve tables where possible.
- [x] Preserve bold/italic.

### 10.4 Assets

- [x] Create `packages/assets`.
- [x] Define `AssetProvider`.
- [x] Implement memory asset provider for browser/test wiring.
- [x] Implement local filesystem asset provider contract with injected adapter.
- [x] Copy pasted image to asset directory through injected adapter.
- [x] Insert relative image path.
- [x] Avoid creating asset folder until needed at memory-provider level.
- [x] Wire desktop shell to a session-aware asset provider.
- [x] Add Tauri asset write/existence/directory command source.
- [x] Verify native Tauri asset writes in a real Tauri app session.

### 10.5 Tests

- [x] Paste Markdown/plain text.
- [x] Paste basic HTML.
- [x] Paste AI answer structure at converter level.
- [x] Paste code with blank lines into code block.
- [x] Paste image at provider-contract/view level.
- [x] Paste image through desktop shell mock/e2e wiring.
- [x] Undo paste.
- [x] Paste then mode switch.

### 10.6 Acceptance Criteria

- [x] v1 paste regressions are covered.
- [x] Text, HTML, and provider-level image paste never bypass transaction/history.

## 11. M8 V1 Regression Suite

Goal: convert v1 issue lessons into durable automated tests.

### 11.1 Test Directory

- [x] Create `tests/regressions/v1`.
- [x] Add issue metadata helper.
- [x] Add operation log replay helper.
- [x] Add fixture Markdown files.

### 11.2 Required Regression Files

- [x] `history-mode-switch.test.ts`
- [x] `history-code-block.test.ts`
- [x] `paste-ai-output.test.ts`
- [x] `paste-code-block-blank-lines.test.ts`
- [x] `table-mode-switch-data-loss.test.ts`
- [x] `dirty-state-open-save.test.ts`
- [x] `file-watcher-conflict.test.ts`
- [x] `active-document-export.test.ts`
- [x] `renderer-error-boundary.test.ts`
- [x] `ime-windows-chinese.test.ts`
- [x] `cursor-scroll-code-block.test.ts`

### 11.3 Operation Log

- [x] Define operation log schema.
- [x] Capture dispatch transactions.
- [x] Capture selection changes.
- [x] Capture mode switches.
- [x] Capture paste events in normalized form.
- [x] Replay operation log in tests.

### 11.4 Acceptance Criteria

- [x] Every high-risk v1 issue has a test or a documented manual test.
- [x] Regression tests run in CI.
- [x] New bug fixes require new regression entries.

## 12. M9 Large File Architecture

Goal: implement the abstractions needed for large and GB-scale files without blocking earlier editor work.

### 12.1 DocumentStore

- [x] Define `DocumentStore`.
- [x] Implement `MemoryDocumentStore`.
- [x] Implement chunk read interface.
- [x] Implement line/window read interface.
- [x] Implement local parse window contract.
- [x] Implement change apply interface.
- [x] Implement flush interface.

### 12.2 Tauri File Store

- [x] Create Rust file service.
- [x] Read file chunks.
- [x] Build line index.
- [x] Map byte offsets to UTF-16 editor offsets where needed.
- [x] Apply changes safely.
- [x] Flush atomically.

### 12.3 Modes

- [x] Define normal mode.
- [x] Define incremental mode.
- [x] Define large file mode.
- [x] Define ultra-large file mode.
- [x] Define feature degradation policy.

### 12.4 Tests

- [x] 10 MB synthetic Markdown.
- [x] 100 MB synthetic Markdown.
- [x] Large code block.
- [x] Large document search.
- [x] Save large document.
- [x] Undo local edit in large document.

### 12.5 Acceptance Criteria

- [x] Large file mode does not require full DOM.
- [x] Large file mode does not require full parse.
- [x] GB-scale claims are backed by manual benchmarks before public release; see [large-file-benchmark-protocol.md](./large-file-benchmark-protocol.md), [native-large-file-benchmark-256mib-2026-07-06.json](./native-large-file-benchmark-256mib-2026-07-06.json), and [native-large-file-benchmark-1gib-2026-07-06.json](./native-large-file-benchmark-1gib-2026-07-06.json).

## 13. M10 Action Registry, CLI, MCP

Goal: make all important operations AI-ready and automation-ready.

### 13.1 Action Registry

- [x] Create `packages/plugin` or `packages/core/actions`.
- [x] Define `ActionDefinition`.
- [x] Define `ActionContext`.
- [x] Define permission model.
- [x] Register core actions.
- [x] Register document actions.
- [x] Register view actions.
- [x] Register file actions.

### 13.2 CLI

- [x] Create CLI package.
- [x] `milkup action list`.
- [x] `milkup action describe`.
- [x] `milkup action run`.
- [x] `milkup export`.
- [x] Support headless mode.
- [x] Support attached app mode later.

### 13.3 MCP

- [x] Create MCP server package.
- [x] Expose actions as tools.
- [x] Expose current document as resource.
- [x] Expose current selection as resource.
- [x] Expose workspace file tree as resource.
- [x] Add allowlist.
- [x] Add confirmation requirement metadata.
- [x] Add real MCP stdio/http transport wrapper.

### 13.4 Tests

- [x] Action schema validation.
- [x] CLI action run.
- [x] MCP tool list generation.
- [x] MCP tool permission filtering.
- [x] Destructive action blocked by default.

### 13.5 Acceptance Criteria

- [x] GUI and CLI can call same action.
- [x] MCP tools are generated from Action Registry, not hand-maintained separately.

## 14. M11 Plugin Runtime

Goal: support local runtime plugins without compromising editor stability.

### 14.1 Plugin Manifest

- [x] Define manifest schema.
- [x] Validate manifest.
- [x] Validate duplicate contribution ids/actions and keymap command references.
- [x] Support explicit plugin host tier declaration.
- [x] Support command contribution.
- [x] Support command input schema contribution.
- [x] Support keymap contribution.
- [x] Support renderer contribution.
- [x] Support markdown syntax contribution later.

### 14.2 Runtime

- [x] Load local plugin.
- [x] Enable plugin.
- [x] Disable plugin.
- [x] Unload plugin.
- [x] Reload plugin in development.
- [x] Isolate plugin errors.

### 14.3 Permissions

- [x] Define plugin permissions.
- [x] Enforce action permissions.
- [x] Restrict filesystem/network access.
- [x] Require confirmation for destructive actions.
  - Current baseline gates manifest permissions with `allowedPermissions` and exposes action permissions through `ActionRegistry`.
  - `network:access` is part of core `ActionPermission`, so network-capable plugin actions are filtered by Action Registry/CLI/MCP and projected into MCP `requiredPermissions`; network actions are treated as `write` risk rather than read-only tools.
  - Command contributions may declare `permissions` as a subset of top-level manifest permissions; omitted command permissions inherit manifest permissions, while declared command permissions narrow action metadata and command host capabilities.
  - Current runtime only exposes host file/network capabilities when the manifest declares the matching permission.
  - Official plugin file host functions are broker-backed in runtime, isolated module host, Browser Worker RPC, desktop adapter, and CLI/headless host paths.
  - Official plugin `context.host.fetch` is broker-backed in runtime, isolated module host, Browser Worker RPC, and CLI/headless host paths, with URL validation, optional origin allowlist, and audit records.
  - Main-thread broker audit sinks are covered for Browser Worker file/network capability RPC, including successful operations, broker denials, and authorized adapter/native operation failures.
  - Current Worker loader installs global guards before importing plugin code: without `network:access`, `fetch`/`WebSocket`/`EventSource`/`XMLHttpRequest` are blocked; with `network:access`, ambient `fetch` is broker-backed when a `PluginNetworkBroker` is available, while `WebSocket`/`EventSource`/`XMLHttpRequest` remain blocked until dedicated brokers exist; `eval`/`Function`/`importScripts`/`Worker`/`SharedWorker` are always blocked so plugins cannot execute undeclared code, load extra scripts, or spawn unbrokered child execution realms outside the declared module loading path.
  - `PluginManifest.host` accepts `worker` and `sidecar`, with missing `host` treated as the default worker policy. `PluginRuntime` rejects `host: "sidecar"` during enable unless `allowedHosts` explicitly includes `sidecar`, and `loadLocalPlugin` refuses to import sidecar-declared modules through the ordinary JS loader unless the caller explicitly allows that host tier.
  - `createSidecarPluginModule` starts a sidecar endpoint only after the runtime has allowed the `sidecar` host tier, communicates through the existing isolation RPC protocol, applies sidecar edits through serialized transactions, and closes/stops the sidecar during plugin disable.
  - Desktop/Tauri sidecar process adapter source exists: `createDesktopPluginSidecarProcess` exposes a `PluginSidecarProcess` over Tauri invoke/listen, and Rust commands `start_plugin_sidecar_process`, `send_plugin_sidecar_message`, and `stop_plugin_sidecar_process` manage absolute-path stdio sidecar processes and event forwarding.
  - Native WebDriver smoke coverage now starts a real stdio sidecar process from the running Tauri app, runs a plugin command over isolation RPC, applies the returned serialized transaction through the editor, and verifies the sidecar process stops after unload.
  - `PluginRuntime` now rejects in-process plugin modules by default; trusted same-realm dev/test fixtures must explicitly opt in with `allowInProcessModules`.
  - M11 sandbox completion audit is recorded in [m11-plugin-sandbox-audit.md](./m11-plugin-sandbox-audit.md).

### 14.4 Tests

- [x] Load plugin.
- [x] Plugin command.
- [x] Plugin renderer.
- [x] Plugin renderer throw fallback.
- [x] Plugin action exposed to CLI.
- [x] Plugin action exposed to MCP only when allowed.

### 14.5 Acceptance Criteria

- [x] Plugin failure cannot corrupt document.
- [x] Plugin failure cannot crash app shell.
- [x] Plugin document edits use transactions.

### 14.6 Follow-ups

- [x] Add a stable public plugin SDK entrypoint so plugin modules do not import workspace source packages directly.
- [x] Move plugin execution into a true isolated host realm before marking filesystem/network sandboxing complete.
  - Current baseline has a `PluginIsolationHost` protocol, adapter, Worker-style postMessage RPC transport, isolated-realm module executor, browser Worker-style host/bootstrap API, and a playground real module Worker fixture.
  - Tauri/native plugin host path is documented in [plugin-native-host-decision.md](./plugin-native-host-decision.md).
  - CLI/headless plugins now default through `createPluginModuleIsolationHost` + `createIsolatedPluginModule`, so plugin commands receive a structural editor proxy instead of the runtime's buffered editor object.
  - Host-agnostic filesystem broker contract and path-scope validation tests exist in `@milkup/plugin`.
  - `PluginRuntime` and `createPluginModuleIsolationHost` can route local file host capabilities through `PluginFileBroker`.
  - Worker/main-thread file capability RPC bridge exists, so Browser Worker plugins can use the main-thread `PluginFileBroker` without direct filesystem access.
  - Playground real Browser Worker fixture has e2e coverage proving a Worker plugin command can read through the main-thread `PluginFileBroker` and still mutate the document through global transaction/history.
  - Desktop/Tauri filesystem broker adapter source, frontend tests, and native WebDriver smoke coverage exist.
  - Desktop TS-level smoke coverage proves a Worker plugin can use the desktop broker adapter through file capability RPC.
  - Real desktop/Tauri Worker fixture coverage proves a Worker plugin can read/write through the Tauri-backed broker and still mutate the document through serialized transactions in the running desktop app.
  - CLI/headless plugin host file functions are now backed by a workspace-scoped `PluginFileBroker`.
  - Host-agnostic network broker contract exists in `@milkup/plugin`, and `PluginRuntime`/`createPluginModuleIsolationHost`/Browser Worker RPC/CLI headless host can route official plugin `fetch` through it.
  - Playground real Browser Worker fixture has e2e coverage proving a Worker plugin command can fetch through the main-thread `PluginNetworkBroker` and still mutate the document through global transaction/history.
  - Manifest/runtime/local-loader gates exist for sidecar host declarations, preventing advanced host plugins from being enabled or imported through default paths without explicit host-tier approval.
  - Host-agnostic sidecar lifecycle/RPC adapter exists and is package-tested against startup, command execution, serialized transaction mutation, remote dispose/deactivate, endpoint close, process stop, and default runtime rejection.
  - Desktop/Tauri sidecar process adapter source exists and is covered by desktop frontend tests plus Rust unit tests for executable path policy and event payload serialization.
  - Native Tauri WebDriver smoke covers a real stdio sidecar fixture launched through the Tauri adapter, including RPC command execution, document transaction mutation, and process stop after unload.
  - Requirement-by-requirement M11 sandbox audit is complete in [m11-plugin-sandbox-audit.md](./m11-plugin-sandbox-audit.md).

## 15. M12 Export Pipeline

Goal: provide stable export based on document identity and Markdown AST, not current accidental DOM/tab state.

### 15.1 Export Core

- [x] Define export context.
- [x] Export current document by documentId.
- [x] Export selected document by documentId.
- [x] Convert Markdown AST to HTML.
- [x] Export HTML.
- [x] Define PDF export provider contract.
- [x] Export PDF.

### 15.2 Export Correctness

- [x] Do not export first tab by accident.
- [x] Do not depend on currently rendered DOM only.
- [x] Resolve local images.
- [x] Resolve relative links.
- [x] Include theme styles where applicable.

### 15.3 Tests

- [x] Export each of three tabs.
- [x] Export document with images.
- [x] Export document with code blocks.
- [x] Export document with table.
- [x] Export document with math placeholder.
- [x] Export document with theme styles.

### 15.4 Acceptance Criteria

- [x] v1 export wrong-tab regression is covered.
- [x] Export is action-based and documentId-scoped.
- [x] Baseline PDF export is available without DOM serialization.

### 15.5 Follow-ups

- [x] Add high-fidelity native or browser PDF provider for full CSS/layout output.
- [x] Add CJK/font-embedding strategy for production PDF export.

## 16. Cross-Cutting Test Strategy

### 16.1 Unit Tests

- [x] Text document.
- [x] ChangeSet.
- [x] Selection mapping.
- [x] History.
- [x] Parser.
- [x] Action registry.

### 16.2 Integration Tests

- [x] Editor dispatch.
- [x] Parser + view decorations.
- [x] Paste pipeline.
- [x] Mode switch.
- [x] File workflow.

### 16.3 Browser Tests

- [x] Cursor placement.
- [x] Selection rendering.
- [x] Scroll restoration.
- [x] Input behavior.
- [x] Paste behavior.

### 16.4 Manual Test Matrix

- [x] Windows Chinese IME.
- [ ] macOS Chinese IME.
- [ ] Linux IME.
- [ ] macOS Cmd shortcuts.
- [x] Windows Ctrl shortcuts.
- [x] File watcher on Windows.
- [ ] File watcher on macOS.
- [x] External editor conflict.

## 17. Current Next Step

Continue with native/manual evidence only: M9 safe mutation and persistence now have native benchmark reports through 1 GiB per [large-file-benchmark-protocol.md](./large-file-benchmark-protocol.md), [native-large-file-benchmark-256mib-2026-07-06.json](./native-large-file-benchmark-256mib-2026-07-06.json), and [native-large-file-benchmark-1gib-2026-07-06.json](./native-large-file-benchmark-1gib-2026-07-06.json). The current Tauri large-file service is still full-text-backed after open, so public wording should claim documented native 1 GiB behavior rather than true lazy streaming. M6 desktop file workflow is now complete, including user-confirmed Windows real OS Save As/native file dialog evidence in [manual-verification-windows-os-dialog-user-2026-07-07.md](./manual-verification-windows-os-dialog-user-2026-07-07.md). Windows watcher and same-file external conflict are closed by [manual-verification-windows-native-watcher-conflict-2026-07-07.md](./manual-verification-windows-native-watcher-conflict-2026-07-07.md), Windows Ctrl shortcuts are closed by [manual-verification-windows-ctrl-shortcuts-native-2026-07-07.md](./manual-verification-windows-ctrl-shortcuts-native-2026-07-07.md), and Windows Chinese IME is closed by the real desktop-control pass report [manual-verification-windows-ime-computer-use-2026-07-07.md](./manual-verification-windows-ime-computer-use-2026-07-07.md). `tests/native/tauri-webdriver-smoke.mjs` also includes synthetic composition coverage for source/live mode, undo, and mode switch retention, while [windows-ime-automation-probe-2026-07-07.md](./windows-ime-automation-probe-2026-07-07.md) records why WebDriver key actions and WScript SendKeys were not sufficient proof. M16 still keeps macOS Chinese IME, Linux IME, macOS Cmd shortcuts, and macOS watcher verification open per [manual-verification-protocol.md](./manual-verification-protocol.md); the current automated/manual boundary is summarized in [manual-verification-status-2026-07-06.md](./manual-verification-status-2026-07-06.md), the report template is [manual-verification-report-template.md](./manual-verification-report-template.md), the macOS/Linux manual runbook is [manual-verification-cross-platform-runbook-2026-07-06.md](./manual-verification-cross-platform-runbook-2026-07-06.md), and the current consolidated completion audit is [completion-audit-2026-07-06.md](./completion-audit-2026-07-06.md).

Recommended immediate task:

- [x] Add Tauri large text file service commands for open/read chunk/read line window/close.
- [x] Add desktop frontend adapter for the Tauri large text file service.
- [x] Return byte ranges and global UTF-16 editor offsets for chunks and line windows.
- [x] Implement safe large-file change application in the Rust service.
- [x] Implement atomic flush for changed large files.
- [x] Add native/benchmark evidence before any public GB-scale claim; the fixture/measurement harness now has 256 MiB and 1 GiB native Tauri reports.

- [x] Add source/live switch tests near link markers and incomplete syntax.
- [x] Integrate projection mapping into click/drag coordinate paths.
- [x] Add selection-across-hidden-markers regression tests.
- [x] Add list marker style.
- [x] Add source/live switch test in middle of document.
- [x] Implement mode switch cursor/scroll anchor capture and restore checks.
- [x] Add browser-level Playwright check when live render projection touches real DOM measurement.
- [x] Start M6 by initializing `apps/desktop` as a Tauri shell.
- [x] Define first `DocumentSession` state shape for file open/save/dirty workflows.
- [x] Wire desktop shell to `@milkup/tauri-bridge` session state.
- [x] Implement Save As path update through `recordFileSave`.
- [x] Add `DesktopFileService` with Tauri runtime adapter and browser mock fallback.
- [x] Add Rust command source for open/save/reveal and Tauri dialog capability source.
- [x] Verify browser/e2e fallback path for desktop open/save/saveAs/reveal, dirty close, and external-change save blocking.
- [x] Add `recordFileSaveResult` so save completion cannot clear dirty state for the wrong `documentId`.
- [x] Add M6 bridge-level v1 dirty/open/save/conflict/close regression tests.
- [x] Add `FileWatchEvent` contract with documentId/path validation.
- [x] Wire desktop simulated external modify/delete events through watcher contract.
- [x] Add watcher bridge tests and browser smoke for clean external delete, local edit conflict escalation, and blocked save.
- [x] Add Rust source for `watch_markdown_file`/`unwatch_markdown_file` and `milkup-file-watch-event` emission.
- [x] Add frontend Tauri adapter methods for watch/unwatch/listen and route native watch events through `applyFileWatchEvent`.
- [x] Ignore watcher modified events whose snapshot hash equals the current saved disk snapshot.
- [x] Move playground e2e to strict dedicated port `5174` and disable Playwright server reuse.
- [x] Add line-ending detection and save normalization for LF/CRLF files.
- [x] Fix close confirmation semantics for mixed clean/dirty requested tab sets.
- [x] Add clean external modification reload contract and desktop fallback smoke.
- [x] Add dedicated native reload command source and route frontend Tauri reload through it.
- [x] Install/enable Rust toolchain in the environment and run `cargo check` for `apps/desktop/src-tauri`.
- [x] Run a real Tauri desktop session and verify native open/save/save-as/reveal.
- [x] Verify native `reload_markdown_file` preserves current `DocumentSession.documentId`.
- [x] Confirm Tauri invoke argument casing for `documentId`/`document_id`; fix frontend invoke payloads or Rust command args if runtime requires snake_case.
- [x] Verify native filesystem watcher event source in a running Tauri app.
- [x] Verify real filesystem modify/delete events reach `DocumentSession` in a running Tauri app.
- [x] Add native watcher-backed v1 dirty/save/file-watcher regression coverage once filesystem watcher events exist.
- [x] Start M7 by creating `@milkup/input` and wiring basic paste through `EditorView`.
- [x] Add paste pipeline tests for Markdown/plain text, basic HTML, code-block literal paste, file-only deferral, and undo.
- [x] Expand HTML-to-Markdown conversion for tables and nested AI-output structures.
- [x] Add paste-then-mode-switch regression coverage.
- [x] Trigger incremental parse/cache invalidation explicitly after paste at the `EditorView` layer.
- [x] Start asset pipeline for pasted images with provider-contract/view-level memory import.
- [x] Add local filesystem asset provider for real desktop image copy.
- [x] Add plugin manifest/runtime/loader/CLI plugin command baseline.
- [x] Add stable `@milkup/plugin-sdk` public plugin entrypoint.
- [x] Add plugin isolation protocol, RPC transport, and isolated module executor.
- [x] Add browser Worker-style plugin host/bootstrap API with package-level mock endpoint tests.
- [x] Wire browser Worker plugin loading into a real app/runtime fixture instead of only package-level mock endpoints.
- [x] Add Browser Worker integration/e2e test proving a plugin command can mutate the editor through the shared transaction/history pipeline.
- [x] Add Tauri/native plugin host or sidecar decision note before implementing filesystem-capable plugins.
- [x] Add host-agnostic plugin filesystem broker contract.
- [x] Add path scope validation and canonicalization tests for plugin filesystem broker.
- [x] Wire plugin filesystem broker into runtime/isolated host file capabilities.
- [x] Add Worker/main-thread filesystem capability RPC bridge for Browser Worker plugins.
- [x] Add Browser Worker integration/e2e test proving a plugin command can read through the main-thread file broker.
- [x] Add desktop/Tauri filesystem broker adapter backed by native file commands.
- [x] Add desktop TS-level Worker plugin filesystem broker smoke coverage.
- [x] Add real desktop/Tauri Worker plugin fixture proving file broker read/write and transaction mutation in a native app session.
- [x] Add CLI/headless workspace-scoped filesystem broker for plugin host file capabilities.
- [x] Add host-agnostic plugin network broker contract and tests.
- [x] Project `network:access` through core Action Registry, CLI, and MCP permission filtering.
- [x] Add command-level plugin permission narrowing for Action Registry/MCP and command host capabilities.
- [x] Add plugin command input schemas for CLI/MCP/AI tool validation.
- [x] Add manifest/runtime/local-loader gates for sidecar/advanced plugin host declarations.
- [x] Add host-agnostic sidecar lifecycle/RPC adapter reusing the plugin isolation protocol.
- [x] Add desktop/Tauri stdio sidecar process adapter source.
- [x] Add real native Tauri WebDriver sidecar fixture proving sidecar RPC, transaction mutation, and process stop.
- [x] Wire plugin network broker into runtime/isolated host `context.host.fetch`.
- [x] Add Worker/main-thread network capability RPC bridge for Browser Worker plugins.
- [x] Route Browser Worker ambient `fetch` through `PluginNetworkBroker` before plugin import.
- [x] Block Browser Worker `eval`/`Function` before plugin import so dynamic code execution cannot bypass the declared module path.
- [x] Block Browser Worker `importScripts` before plugin import so code loading cannot bypass the declared module path.
- [x] Block Browser Worker child `Worker`/`SharedWorker` creation before plugin import so plugins cannot spawn unbrokered execution realms.
- [x] Add Browser Worker integration/e2e test proving a plugin command can fetch through the main-thread network broker.
- [x] Add Worker broker audit coverage for file/network success and denial paths.
- [x] Add file broker audit coverage for authorized adapter/native operation failures.
- [x] Add CLI/headless network broker for plugin host `context.host.fetch`.
- [x] Route CLI/headless plugin execution through isolated module host by default.
- [x] Add hard host isolation/native verification before marking `Restrict filesystem/network access` complete.
- [x] Audit M11 filesystem/network/host-tier sandbox requirements before marking `Restrict filesystem/network access` complete.

## 18. Known Open Questions

- [x] Frontend app framework: Svelte or React.
  - Decision: core and current app shells stay framework-free TypeScript; prefer Svelte over React if the product shell later needs a component framework.
- [x] Text storage implementation: Piece Table first or Rope first.
  - Decision: keep replaceable `TextDocument`/`DocumentStore` contracts; use current memory store now and prefer Piece Table before Rope for the first production storage engine.
- [x] Line ending policy.
  - Current policy: `MemoryTextDocument` preserves source text exactly; line-level reads exclude line breaks and trim CR from CRLF display text. `DocumentSession.lineEnding` records detected LF/CRLF style on open, and desktop save normalizes output through `prepareTextForFileSave`.
- [x] Markdown parser compliance target.
  - Decision: CommonMark baseline with GFM as the first extension set; official spec fixtures are required before broad compliance claims.
- [x] Plugin isolation level for v1 of plugin runtime.
  - Decision: Browser Worker default, explicit sidecar advanced host tier, in-process modules denied by default.
- [x] MCP server runtime.
  - Decision: headless JSON-RPC/stdio runtime generated from Action Registry; embedded desktop MCP must reuse the same Action Registry and Tauri broker policy.

## 19. Progress Log

Use this section to record meaningful implementation progress.

### 2026-07-02

- Created product architecture document.
- Created v1 lessons and regression document.
- Created this coding plan.
- Initialized pnpm monorepo with root scripts for `dev`, `build`, `test`, `typecheck`, `lint`, and `format`.
- Added strict TypeScript, Vitest, Prettier, workspace config, `.gitignore`, and a placeholder Rust workspace at `crates/Cargo.toml`.
- Created package/app directories from M0, with placeholder `.gitkeep` files for future packages.
- Implemented `@milkup/core` text primitives: `TextRange`, `ChangeSet`, `TextDocument`, and `MemoryTextDocument`.
- Added 14 `MemoryTextDocument`/`ChangeSet` unit tests covering insertion, deletion, replacement, multi-change apply, blank lines, trailing newline, code block blank lines, and position mapping.
- Created Vite playground importing `@milkup/core` and rendering a core text model smoke test.
- Verified `pnpm install`, `pnpm test`, `pnpm typecheck`, `pnpm build`, and `pnpm lint`.
- Started playground dev server at `http://127.0.0.1:5173/`.
- Implemented M2 transaction/history primitives in `@milkup/core`: `Transaction`, `Annotation`, `StateEffect`, `TransactionOrigin`, `Selection`, `SelectionRange`, `HistoryState`, `EditorState`, and `BasicEditor`.
- Added immutable runtime guards with `Object.freeze` for core value objects where practical.
- Added 11 editor/history tests covering typing undo/redo, delete undo, replace undo, paste as one undo step, selection mapping, mode switch history preservation, code block-origin global history, full-document delete undo, typing history grouping, and selection-only transactions.
- Verified `pnpm test`, `pnpm typecheck`, and `pnpm build` after M2 implementation.
- Started M3 by creating `@milkup/markdown` with strict TypeScript and Vitest config.
- Implemented initial CST model: `SourceRange`, `SyntaxStatus`, `SyntaxNode`, `markerRanges`, `contentRanges`, `children`, and source range validation.
- Implemented `parseMarkdown` and `scanLines` with source-preserving block ranges.
- Implemented initial block parser support for blank lines, paragraphs, and ATX headings.
- Added 10 markdown parser tests covering LF/CRLF line scanning, empty documents, blank lines, ATX heading marker/content ranges, indented headings, seven-hash paragraph fallback, paragraph grouping, math-like text fallback, and malformed inline text stability.
- Verified `pnpm --filter @milkup/markdown test` and `pnpm --filter @milkup/markdown typecheck`.
- Extended block parser with fenced code blocks, incomplete fenced code status, thematic breaks, unordered lists, and ordered lists.
- Added parser tests for Python code block blank lines, unclosed fences, Markdown-looking text inside fences, thematic-break/list precedence, unordered list item ranges, and ordered list start data.
- Verified `pnpm --filter @milkup/markdown test` and `pnpm --filter @milkup/markdown typecheck` after block parser expansion.
- Added indented code block and blockquote parsing with marker/content ranges.
- Added inline parser skeleton with text-node fallback via `parseInlineText`.
- Added parser tests for indented code ranges, blockquote line ranges, quote/list boundary behavior, and inline text fallback.
- Verified `pnpm --filter @milkup/markdown test` and `pnpm --filter @milkup/markdown typecheck` after indented code, blockquote, and inline skeleton work.
- Implemented first real inline parser pass with text, escape, inline code, emphasis, and strong nodes.
- Added incomplete node handling for unclosed emphasis and unclosed inline code spans.
- Added inline parser tests for source ranges, marker ranges, surrounding text preservation, and incomplete inline syntax.
- Verified `pnpm --filter @milkup/markdown test` and `pnpm --filter @milkup/markdown typecheck` after inline parser work.
- Added inline link, image, autolink, and hard break parsing.
- Added incomplete node handling for unclosed inline links.
- Added inline tests for link/image ranges, URL/email autolinks, hard breaks, emphasis inside links, links inside emphasis, and code spans inside emphasis.
- Verified `pnpm --filter @milkup/markdown test` and `pnpm --filter @milkup/markdown typecheck` after completing Inline Parser Phase 1 coverage.
- Added [markdown-container-design.md](./markdown-container-design.md) to document the future container-stack direction for nested list/blockquote parsing.
- Added initial incremental parser cache API: `MarkdownParseCache`, `ParseChange`, `parseMarkdownIncremental`, `createMarkdownParseCache`, and `expandInvalidationRange`.
- Added tests for top-level block cache ranges, invalidation range expansion, and full parse vs incremental parse equivalence across deterministic edits.
- Verified `pnpm --filter @milkup/markdown test` and `pnpm --filter @milkup/markdown typecheck` after incremental parser work.
- Added [markdown-parser-m3-closeout.md](./markdown-parser-m3-closeout.md) documenting M3 decisions: AST conversion deferred, true node reuse deferred to large-file work, nested containers deferred to container-stack parsing, and plugin parser isolation limited to a stub.
- Added `runMarkdownExtensionSafely` plugin parser isolation stub with structured success/failure results.
- Added extension safety tests proving thrown plugin parser failures are captured and base parsing continues.
- Marked M3 complete and M4 as next.
- Verified `pnpm --filter @milkup/markdown test` and `pnpm --filter @milkup/markdown typecheck` after M3 closeout work.
- Started M4 by creating `@milkup/view-dom` with jsdom-based Vitest config and `@milkup/core` dependency.
- Implemented initial DOM view types: `EditorView`, `ViewUpdate`, `BlockView`, `Decoration`, `EditorViewConfig`, and `ViewMode`.
- Implemented plain text line rendering with `.milkup-line` wrappers and source range data attributes.
- Added view tests for initial render, empty line placeholder rendering, state update rerender, mode switching without document mutation, destroy, and standalone line rendering.
- Verified `pnpm --filter @milkup/view-dom test` and `pnpm --filter @milkup/view-dom typecheck`.
- Added cursor overlay rendering derived from `EditorState.selection`.
- Added `positionToLineOffset`, `renderCursorOverlay`, and `createInputProxy` helpers.
- Added hidden textarea input proxy skeleton outside `contentDOM`; `contentDOM` is explicitly `contenteditable=false`.
- Added tests for cursor rendering, cursor rerender after state updates, input proxy construction, and position-to-line mapping.
- Verified `pnpm --filter @milkup/view-dom test` and `pnpm --filter @milkup/view-dom typecheck` after cursor/input proxy skeleton work.
- Added selection overlay rendering for non-collapsed ranges, derived from `EditorState.selection`.
- Wired hidden textarea input events into core transactions, including selected-range replacement and cursor advancement.
- Added Backspace transaction handling for collapsed cursors and selected ranges.
- Added click-to-place-cursor smoke path using source offsets exposed on rendered lines.
- Added external dispatch interception for host/app integration tests.
- Added view-dom tests for selection overlay, text input, selected text replacement, Backspace deletion, click cursor placement, and external dispatch.
- Verified `pnpm format`, `pnpm test` (91 tests), `pnpm typecheck`, `pnpm build`, and `pnpm lint` after M4 input dispatch work.
- Added Enter, Delete, ArrowLeft, ArrowRight, ArrowUp, and ArrowDown key handling through the same input proxy transaction path.
- Added tests proving Enter/Delete mutate through transactions, Arrow movement is selection-only and stays out of history, and selected ranges collapse predictably.
- Added IME composition event handling: updates do not mutate the document, and compositionend commits a single `input.type` transaction.
- Added composition tests covering no-history interim updates and one undoable commit.
- Added logical smoke geometry helpers: `positionToRect`, `coordinateToPosition`, `ViewCoordinate`, `ViewRect`, and `ViewMetrics`.
- Added EditorView methods for position/coordinate mapping and tests for clamping line/offset coordinates.
- Verified `pnpm format`, `pnpm test` (105 tests), `pnpm typecheck`, `pnpm build`, and `pnpm lint` after Enter/Delete/Arrow, IME, and mapping work.
- Wired `apps/playground` to `@milkup/view-dom` with an editable plain-text `EditorView`, external dispatch ownership, live length/line/cursor stats, and editor-focused styling.
- Added `@milkup/view-dom` as a playground workspace dependency.
- Added click-to-focus behavior for the hidden textarea input proxy.
- Added basic cursor and selection overlay positioning styles from the view smoke geometry.
- Added `ensureCursorVisible` and `scrollPositionIntoView` smoke behavior, including tests for cursor reveal after selection changes and preserving scroll when selection is unchanged.
- Verified `pnpm format`, `pnpm test` (109 tests), `pnpm typecheck`, `pnpm build`, and `pnpm lint` after playground and cursor visibility work.
- Added drag selection smoke path through mousedown/mousemove/mouseup, producing selection-only transactions without entering history.
- Added tests for drag selection across rendered line wrappers and suppressing the post-drag click collapse.
- Added code block-like cursor visibility fixture.
- Added [dom-view-m4-closeout.md](./dom-view-m4-closeout.md) documenting M4 scope, Playwright deferral to M5, deferred Windows Chinese IME manual checks, and known limits.
- Marked M4 complete and M5 as next.
- Verified `pnpm format`, `pnpm test` (112 tests), `pnpm typecheck`, `pnpm build`, and `pnpm lint` after drag selection and M4 closeout work.
- Started M5 by wiring `@milkup/view-dom` to `@milkup/markdown` for source-preserving live render projections.
- Updated `EditorView.setMode` so source/live/preview mode switches rerender the view, preserve scroll, and never touch `EditorState` or history.
- Added `renderMarkdownLines` with block and inline decoration classes for headings, strong, emphasis, inline code, links, blockquotes, and code blocks.
- Added playground Source/Live/Preview segmented mode controls.
- Added M5 tests for live decorations, preview placeholder rendering, source/live toggles preserving text/history/selection/scroll, and helper-level decoration rendering.
- Verified `pnpm format`, `pnpm test` (118 tests), `pnpm typecheck`, `pnpm build`, and `pnpm lint` after initial M5 mode/decorations work.
- Split inline live render output into content, marker, and syntax spans while preserving source ranges.
- Added marker hide/show rules for valid emphasis, strong, inline code, and link nodes based on cursor/selection intersection.
- Treated link destination as syntax so live render can show only the label when the cursor is outside the link.
- Kept incomplete inline syntax markers visible.
- Added tests for outside/inside marker visibility, selection-crossing syntax visibility, link syntax hiding/showing, inline-code marker hiding/showing, and incomplete syntax marker visibility.
- Verified `pnpm format`, `pnpm test` (125 tests), `pnpm typecheck`, `pnpm build`, and `pnpm lint` after marker hide/show work.
- Added line projection helpers: `buildLineProjection`, `sourcePositionToVisualOffset`, and `visualOffsetToSourcePosition`.
- Projection segments record source range, visual range, hidden state, and segment kind.
- Added tests for collapsed hidden emphasis markers, source-to-visual mapping, visual-to-source mapping with boundary affinity, visible syntax when cursor is inside a node, and collapsed link marker/destination syntax.
- Verified `pnpm format`, `pnpm test` (130 tests), `pnpm typecheck`, `pnpm build`, and `pnpm lint` after projection mapping helper work.
- Integrated line projection into `EditorView` instance geometry for live/preview mode, including `positionToRect`, `coordinateToPosition`, cursor overlays, selection overlays, and visual click/drag offsets.
- Added live-mode regression tests for visual clicking through hidden link syntax, drag selection across hidden inline markers, projected cursor geometry, link-marker mode switching, and editing incomplete inline syntax.
- Verified `pnpm format`, `pnpm test` (136 tests), `pnpm typecheck`, `pnpm build`, and `pnpm lint` after integrating projection mapping into live editor interactions.
- Added source-preserving list marker rendering in live mode, with separate `.milkup-list-marker` and `.milkup-list-content` spans while keeping inline decorations inside list content.
- Updated playground list marker styles.
- Added mode switch regression coverage for middle-of-document cursor anchors, scroll restoration, and cursor visibility when a measurable viewport exists.
- Added Playwright browser smoke coverage for live render projection in the playground, using the system `msedge` channel.
- Marked M5 Live Render Mode complete and M6 Desktop File Workflow as the next milestone.
- Verified `pnpm test:e2e`, `pnpm format`, `pnpm test` (139 Vitest tests), `pnpm typecheck`, `pnpm build`, and `pnpm lint` after M5 closeout work.
- Started M6 by creating `@milkup/tauri-bridge` as a pure TypeScript bridge package.
- Added `DocumentSession` with `documentId`, file identity, `documentVersion`, `savedVersion`, `diskSnapshotHash`, `dirty`, `readonly`, `externalChangeState`, `viewMode`, `themeId`, and parser cache version.
- Added session transition helpers for document transactions, saves, selection/mode/theme/parser-cache changes, readonly changes, and external file modification/deletion.
- Added documentId-scoped file action contracts for new/open/save/saveAs/reveal operations.
- Added 10 tauri-bridge tests covering clean open, dirty edits, selection-only transactions, save clearing dirty state, view-only dirty invariants, readonly state, clean external changes, dirty external conflicts, and documentId-scoped file action requirements.
- Verified `pnpm test` (149 Vitest tests), `pnpm typecheck`, `pnpm build`, `pnpm test:e2e`, `pnpm lint`, and `pnpm format` after the first M6 session-state chunk.
- Initialized `apps/desktop` as a Vite app with local `@milkup/core`, `@milkup/view-dom`, and `@milkup/tauri-bridge` dependencies.
- Added Tauri v2 source skeleton under `apps/desktop/src-tauri`, including `tauri.conf.json`, Rust `bridge_status` command source, `build.rs`, and app entry points.
- Wired the desktop frontend to `EditorView` and `DocumentSession`, including New, in-memory Save, source/live/preview mode controls, dirty indicator, version/saved-version display, and external-change display.
- Extended Playwright coverage with a desktop shell smoke test that verifies editor load, dirty-state updates after typing, mode switching, and save clearing dirty state.
- Verified `pnpm --filter @milkup/desktop typecheck`, `pnpm --filter @milkup/desktop build`, `pnpm test:e2e`, `pnpm test` (149 Vitest tests), `pnpm typecheck`, `pnpm build`, and `pnpm lint` after desktop shell work.
- Could not verify Rust/Tauri with `cargo check` because `cargo` is not installed or not available on PATH in this environment.
- Added `createDocumentSessionFromOpenResult` and explicit Save As path-update coverage in `@milkup/tauri-bridge`.
- Wired desktop mock Open Sample, Save, Save As, and New commands through documentId-scoped file action contracts and `DocumentSession` updates.
- Restored editor input focus after New/Open/Save/Save As commands so continued typing enters the editor transaction path.
- Extended desktop Playwright smoke to cover clean open, path display, dirty edits after open, save clearing dirty state, another edit after save, and Save As syncing `savedVersion` to `documentVersion`.
- Verified `pnpm test:e2e`, `pnpm test` (151 Vitest tests), `pnpm typecheck`, `pnpm build`, `pnpm lint`, and `pnpm format` after mock desktop file workflow work.
- Added `getSaveSafety`/`canSaveSession` to block readonly or externally changed saves before they can silently overwrite disk state.
- Added close protection helpers for tab/window/quit close requests, including dirty/conflicted document detection and cancel/confirm application.
- Added bridge tests for save blocking, dirty tab close prompts, multi-document window/quit close checks, cancel keeping documents open, confirmed tab close, and conflicted close prompts.
- Wired desktop mock UI to close protection and save safety with Close Tab and Simulate External Change smoke controls.
- Extended desktop Playwright smoke to prove dirty close is blocked and external-change save does not clear dirty state.
- Verified `pnpm test:e2e`, `pnpm test` (159 Vitest tests), `pnpm typecheck`, `pnpm build`, `pnpm lint`, and `pnpm format` after save safety and close protection work.
- Added recent-file helpers for path-based dedupe, most-recent-first ordering, length limiting, and removal of unavailable entries.
- Added reveal-target helper that resolves reveal paths through `documentId` and refuses missing or unsaved documents.
- Wired desktop mock UI to show recent files and a Reveal command that uses the documentId-scoped reveal-target contract.
- Extended desktop Playwright smoke to cover recent-file display, reveal path resolution, and unsaved-document reveal blocking.
- Verified `pnpm test:e2e`, `pnpm test` (166 Vitest tests), `pnpm typecheck`, `pnpm build`, `pnpm lint`, and `pnpm format` after recent/reveal work.

### 2026-07-03

- Added `DesktopFileService` in `apps/desktop/src/file-service.ts`, selecting a Tauri runtime adapter when `window.__TAURI_INTERNALS__` exists and a deterministic browser mock fallback otherwise.
- Added Tauri adapter source for native open/save/save-as/reveal flows using `@tauri-apps/plugin-dialog` and `@tauri-apps/api/core`.
- Added Rust command source in `apps/desktop/src-tauri/src/lib.rs` for `open_markdown_file`, `save_markdown_file`, and `reveal_in_folder`, plus dialog plugin initialization.
- Added Tauri dialog capability source and plugin dependencies in the desktop app.
- Verified browser/e2e fallback still covers desktop open/save/save-as/reveal, dirty-state updates, dirty close blocking, external-change save blocking, and recent-file display.
- Verified `pnpm build`, `pnpm test:e2e`, and `pnpm lint` after the latest desktop service and documentation updates.
- Native Rust/Tauri verification is still pending because `cargo`, `rustc`, and `rustup` are not installed or not available on PATH in this environment.
- Next M6 work should verify the native Tauri command bridge, confirm invoke argument casing for `documentId`/`document_id`, wire real filesystem watcher events, and convert dirty/save/file-watcher v1 lessons into regression tests.
- Added `recordFileSaveResult` in `@milkup/tauri-bridge` and switched desktop Save/Save As to use it, so a save result for a different `documentId` cannot clear the current session's dirty state.
- Added `packages/tauri-bridge/src/session/v1-file-workflow-regressions.test.ts` covering opened-file clean state, view-only dirty invariants, matching-document save completion, mismatched save result rejection, external conflict save blocking, deleted-file conflict blocking, and multi-document close protection.
- Verified `pnpm --filter @milkup/tauri-bridge test`, `pnpm --filter @milkup/tauri-bridge typecheck`, `pnpm --filter @milkup/desktop typecheck`, `pnpm test` (171 Vitest tests), `pnpm typecheck`, `pnpm format`, `pnpm build`, `pnpm test:e2e`, and `pnpm lint` after the bridge-level v1 file workflow regression work.
- Added `FileWatchEvent` and `createFileWatchEvent` in `@milkup/tauri-bridge` as the frontend-facing native watcher event shape.
- Added `applyFileWatchEvent` to validate watcher events against the current `documentId` and file path before mutating `DocumentSession`.
- Updated document transaction handling so editing after `modified-clean` or `deleted-clean` escalates the session to `conflict`.
- Added watcher contract tests for modified/deleted clean states, dirty conflict states, wrong-document events, stale-path events after Save As, unsaved documents, and clean-to-conflict escalation.
- Wired desktop simulated external modify/delete buttons through the watcher contract and extended the desktop Playwright smoke to cover clean external deletion, local edit conflict escalation, and blocked save.
- Verified `pnpm --filter @milkup/tauri-bridge test`, `pnpm --filter @milkup/tauri-bridge typecheck`, `pnpm --filter @milkup/desktop typecheck`, `pnpm test:e2e`, `pnpm test` (177 Vitest tests), `pnpm typecheck`, `pnpm build`, and `pnpm format` after watcher-contract work.
- Native filesystem watcher event source is still pending until Rust/Tauri can be built and run in an environment with `cargo`.
- Added Rust source for `watch_markdown_file` and `unwatch_markdown_file`, backed by an in-process watcher registry and a standard-library polling loop that emits `milkup-file-watch-event` payloads matching the frontend `FileWatchEvent` contract.
- Added frontend Tauri adapter methods for `watchFile`, `unwatchFile`, and `listenToFileWatchEvents`, using `@tauri-apps/api/core` and `@tauri-apps/api/event`.
- Wired desktop open/save/save-as/new/close flow to register or unregister file watchers, and routed native watcher events through `applyFileWatchEvent`.
- Exported `FILE_WATCH_EVENT_NAME` from `@milkup/tauri-bridge` so Rust and frontend event names can stay aligned.
- Verified `pnpm --filter @milkup/tauri-bridge test`, `pnpm --filter @milkup/tauri-bridge typecheck`, `pnpm --filter @milkup/desktop typecheck`, `pnpm test:e2e`, `pnpm test` (177 Vitest tests), `pnpm typecheck`, `pnpm build`, and `pnpm format` after native watcher source wiring.
- Could not verify the Rust watcher source with `cargo check` or a real Tauri app run because `cargo`, `rustc`, and `rustup` are still unavailable on PATH in this environment.
- Added watcher echo filtering so modified events with a `diskSnapshotHash` equal to the current `DocumentSession.diskSnapshotHash` are ignored, preventing app-initiated saves from being misclassified as external edits.
- Added regression coverage for own-save watcher echoes after save completion.
- Fixed Playwright infrastructure to avoid silently reusing unrelated local apps: playground now serves on strict port `5174`, Playwright uses `5174`, and `reuseExistingServer` is disabled for both e2e web servers.
- Verified `pnpm --filter @milkup/tauri-bridge test` (39 bridge tests), `pnpm --filter @milkup/tauri-bridge typecheck`, `pnpm test:e2e`, `pnpm test` (178 Vitest tests), `pnpm typecheck`, `pnpm build`, `pnpm format`, and `pnpm lint` after watcher echo filtering and e2e port hardening.
- Added file line-ending policy helpers in `@milkup/tauri-bridge`: `detectLineEnding`, `normalizeLineEndings`, and `prepareTextForFileSave`.
- Added `DocumentSession.lineEnding`, populated from opened file text so CRLF files can be saved back with CRLF while LF files stay LF.
- Wired desktop Save/Save As through `prepareTextForFileSave` and exposed line-ending state in the desktop session panel.
- Updated desktop mock open sample to use CRLF text and extended Playwright smoke coverage for detected CRLF state.
- Verified `pnpm --filter @milkup/tauri-bridge test` (44 bridge tests), `pnpm --filter @milkup/tauri-bridge typecheck`, `pnpm --filter @milkup/desktop typecheck`, `pnpm test:e2e`, `pnpm test` (183 Vitest tests), `pnpm typecheck`, `pnpm build`, `pnpm format`, and `pnpm lint` after line-ending policy work.
- Fixed `applyCloseDecision` so confirming a mixed clean/dirty tab close removes every requested tab; cancellation still preserves all documents.
- Added close-protection regression coverage for mixed clean/dirty requested tab sets and extended v1 file workflow coverage to assert confirmed window close clears the full requested set.
- Verified `pnpm --filter @milkup/tauri-bridge test` (45 bridge tests), `pnpm --filter @milkup/tauri-bridge typecheck`, `pnpm test` (184 Vitest tests), `pnpm typecheck`, `pnpm build`, `pnpm test:e2e`, `pnpm format`, and `pnpm lint` after close confirmation semantics work.
- Added `recordFileReloadResult` to apply clean external modification reloads only when the result matches the current `documentId` and file path.
- Reload now advances `documentVersion`, syncs `savedVersion`, clears `externalChangeState`, updates `diskSnapshotHash`, and re-detects file line ending from the reloaded text.
- Added desktop file-service reload support for both Tauri adapter source and browser mock fallback, plus a `Reload External` desktop UI action for clean `modified-clean` sessions.
- Extended desktop Playwright smoke to cover clean external modification, reload, clean session restoration, version/saved-version sync, and CRLF line-ending preservation.
- Documented a native follow-up: the current Tauri adapter reload path reuses `open_markdown_file`; real native verification must confirm it preserves the current `documentId` or replace it with a dedicated reload command.
- Verified `pnpm --filter @milkup/tauri-bridge test` (48 bridge tests), `pnpm --filter @milkup/tauri-bridge typecheck`, `pnpm --filter @milkup/desktop typecheck`, `pnpm test:e2e`, `pnpm test` (187 Vitest tests), `pnpm typecheck`, `pnpm build`, `pnpm format`, and `pnpm lint` after clean external reload work.
- Added `reload` as a document-scoped file action in `@milkup/tauri-bridge`.
- Added Rust source for `reload_markdown_file(document_id, path)`, sharing the file-read implementation with `open_markdown_file` while preserving the current document identity.
- Routed the desktop Tauri adapter reload path through `reload_markdown_file` instead of reusing `open_markdown_file`.
- Verified `pnpm --filter @milkup/tauri-bridge test` (48 bridge tests), `pnpm --filter @milkup/tauri-bridge typecheck`, `pnpm --filter @milkup/desktop typecheck`, `pnpm test:e2e`, and `pnpm --filter @milkup/desktop build` after dedicated native reload command source work.
- Started M7 by turning `packages/input` into `@milkup/input` with test/typecheck/build scripts.
- Added the first paste pipeline API: `collectClipboardPayload`, `normalizePaste`, and `convertHtmlToMarkdown`.
- Added basic paste strategies for plain text, basic HTML-to-Markdown conversion, code-block literal paste, file-only deferral, and empty payloads.
- Wired `EditorView` to handle `paste` events from the hidden textarea input proxy and dispatch paste as one `input.paste` document transaction.
- Added view-dom paste regressions proving plain text paste is undoable in one step, HTML-only paste becomes Markdown before dispatch, and fenced code block paste preserves literal text and blank lines.
- Verified `pnpm --filter @milkup/input test`, `pnpm --filter @milkup/input typecheck`, `pnpm --filter @milkup/view-dom test`, `pnpm --filter @milkup/view-dom typecheck`, `pnpm test` (196 Vitest tests), `pnpm typecheck`, `pnpm build`, `pnpm test:e2e`, `pnpm format`, and `pnpm lint` after the first M7 paste pipeline slice.
- Extended HTML paste conversion to preserve Markdown tables, escape table cell pipes, and avoid flattening nested block-level AI answer structures.
- Added converter coverage for AI-style nested HTML containing headings, bold text, ordered lists, code blocks, and tables.
- Added view-dom coverage proving pasted HTML tables survive source/live mode switches with document identity and history intact.
- Verified `pnpm --filter @milkup/input test` (8 input tests), `pnpm --filter @milkup/input typecheck`, `pnpm --filter @milkup/view-dom test` (72 view-dom tests), and `pnpm --filter @milkup/view-dom typecheck` after HTML table/AI paste work.
- Added `EditorView.markdownParse`, backed by a `MarkdownParseCache`, so view updates can carry incremental parser invalidation metadata.
- Updated document-changing `EditorView.updateState` calls to refresh the Markdown parse cache, using `parseMarkdownIncremental` for single-change transactions such as paste.
- Reused the cached Markdown root for internal live/preview line rendering, while keeping standalone `renderMarkdownLines` compatible with its existing full-parse behavior.
- Added view-dom regression coverage for parse cache version updates, paste invalidation range reporting, and mode switches preserving parse state.
- Started `@milkup/assets` with `AssetProvider`, `MemoryAssetProvider`, file-name sanitization, image MIME detection, and Markdown image syntax generation.
- Updated clipboard file payload collection to retain the original browser `File` object for asset import handoff.
- Added optional `assetProvider` injection to `EditorView`; pasted image files are imported and inserted as Markdown image syntax through the normal paste transaction path.
- Added asset provider tests for safe unique names, relative paths, Markdown image generation, and image detection.
- Added view-dom regression coverage proving pasted image files import through the provider, insert `![alt](relative/path)` text, and undo in one step.
- Verified `pnpm test` (202 Vitest tests), `pnpm typecheck`, `pnpm build`, `pnpm test:e2e`, `pnpm format`, `pnpm lint`, plus focused `@milkup/assets` and `@milkup/view-dom` test/typecheck runs after the first asset pipeline slice.
- Added `LocalAssetProvider` with an injected `AssetFileSystem` adapter so desktop/native code can provide real filesystem writes without coupling `@milkup/assets` to Tauri or Node.
- Local asset imports now ensure the asset directory, avoid collisions against existing files, write provided data to storage, and return both storage path and Markdown-relative path.
- Added local asset provider tests for directory creation, collision-safe file names, binary data writes, and missing-data rejection.
- Verified `pnpm --filter @milkup/assets test`, `pnpm --filter @milkup/assets typecheck`, `pnpm --filter @milkup/view-dom test`, `pnpm --filter @milkup/view-dom typecheck`, `pnpm test` (204 Vitest tests), `pnpm typecheck`, `pnpm build`, `pnpm test:e2e` (2 Playwright tests), `pnpm format`, and `pnpm lint` after the local asset provider slice.
- Added desktop `SessionAssetProvider` wiring so pasted images can resolve the current Markdown file path at import time without rebuilding `EditorView`.
- Added desktop asset service tests for sibling `assets/` directory resolution, local copy through an injected filesystem, and unsaved-document fallback behavior.
- Added browser/e2e coverage proving the desktop shell imports a pasted image file through the asset provider and inserts Markdown image syntax as one dirty document transaction.
- Added Rust/Tauri source commands for asset directory creation, asset existence checks, and binary asset writes; runtime verification remains blocked until Rust tooling is available.
- Verified `pnpm --filter @milkup/desktop test`, `pnpm --filter @milkup/desktop typecheck`, and `pnpm test:e2e` (3 Playwright tests) after desktop asset provider wiring.
- Verified `pnpm test` (207 Vitest tests), `pnpm typecheck`, `pnpm build`, `pnpm format`, `pnpm test:e2e` (3 Playwright tests), and `pnpm lint` after the desktop asset provider slice.
- Rechecked native tooling: `cargo --version` and `rustc --version` still fail because Rust tooling is not available on `PATH`, so native Tauri asset-write verification remains pending.
- Started M8 by adding `tests/regressions` as a pnpm workspace package, so v1 regressions run under the normal `pnpm test`, `pnpm typecheck`, and `pnpm build` gates.
- Added v1 regression helpers for issue metadata, operation logging, selection snapshots, paste/mode/dispatch capture, and operation-log replay.
- Added fixture Markdown files for table and fenced-code regression scenarios.
- Added first M8 regression files: `history-mode-switch.test.ts`, `history-code-block.test.ts`, `paste-ai-output.test.ts`, `paste-code-block-blank-lines.test.ts`, and `table-mode-switch-data-loss.test.ts`.
- Verified `pnpm --filter @milkup/regressions test` (5 regression tests), `pnpm --filter @milkup/regressions typecheck`, `pnpm test` (212 Vitest tests), `pnpm typecheck`, `pnpm build`, `pnpm test:e2e` (3 Playwright tests), and `pnpm format` after the first M8 regression suite slice.
- Re-verified `pnpm test` (212 Vitest tests), `pnpm typecheck`, `pnpm build`, `pnpm test:e2e` (3 Playwright tests), and `pnpm lint` after operation-log replay and documentation updates.
- Started `@milkup/export` with a documentId-scoped export context, explicit document resolution, Markdown export, and a minimal escaped HTML placeholder export.
- Added export-core tests proving export resolves by explicit `documentId`, rejects missing document contexts, and does not accidentally export the first document.
- Completed the required M8 v1 regression file set by adding `dirty-state-open-save.test.ts`, `file-watcher-conflict.test.ts`, `active-document-export.test.ts`, `renderer-error-boundary.test.ts`, `ime-windows-chinese.test.ts`, and `cursor-scroll-code-block.test.ts`.
- Added v1 regression coverage for dirty/open/save invariants, own-save watcher echoes, clean external reload, dirty external conflict blocking, documentId-scoped export, extension/render failure containment, Windows Chinese IME composition, and cursor visibility inside deep fenced code blocks.
- Verified `pnpm --filter @milkup/export test` (4 export tests), `pnpm --filter @milkup/export typecheck`, `pnpm --filter @milkup/regressions test` (11 regression tests), `pnpm --filter @milkup/regressions typecheck`, `pnpm test` (230 Vitest tests), `pnpm typecheck`, `pnpm build`, `pnpm test:e2e` (3 Playwright tests), and `pnpm format` after completing the required M8 regression files and the first M12 export-context slice.
- Replaced the first HTML export placeholder with `renderMarkdownDocumentHtml`, backed by the self-owned Markdown parser and inline parser instead of rendered DOM serialization.
- Added export HTML rendering for headings, paragraphs, blockquotes, ordered/unordered lists, thematic breaks, fenced/indented code blocks, text, escapes, hard breaks, inline code, strong/emphasis, links, images, and autolinks.
- Added an export URL resolver hook so HTML export can resolve local image paths and relative links while preserving explicit documentId-scoped export requests.
- Added export tests for parsed Markdown HTML output, code block language classes, image URL resolution, relative link resolution, raw HTML escaping, and explicit document lookup.
- Verified `pnpm --filter @milkup/export test` (6 export tests), `pnpm --filter @milkup/export typecheck`, `pnpm test` (231 Vitest tests), `pnpm typecheck`, `pnpm build`, `pnpm test:e2e` (3 Playwright tests), and `pnpm format` after the M12 Markdown-to-HTML export slice.
- Added GFM pipe table CST parsing and semantic table HTML export, including alignment metadata and inline content rendering inside cells.
- Added safe math placeholder HTML export for display-math and inline-math-only paragraphs until a real math renderer is introduced.
- Added export coverage for table output and math placeholders, and verified `pnpm --filter @milkup/markdown test`, `pnpm --filter @milkup/markdown typecheck`, `pnpm --filter @milkup/export test`, `pnpm --filter @milkup/export typecheck`, `pnpm test` (233 Vitest tests), `pnpm typecheck`, `pnpm build`, `pnpm test:e2e` (3 Playwright tests), and `pnpm format`.
- Added `themeStyles` to scoped HTML export, injected into exported HTML `<head>` without reading current DOM styles and with `</style` escaped to avoid breaking the style boundary.
- Added a PDF export provider contract with `exportDocumentAsync`, passing documentId-scoped rendered HTML/source/title into the provider while keeping the concrete PDF renderer outside `@milkup/export`.
- Added export tests for theme style inclusion, PDF provider input/output, and missing PDF provider rejection; verified `pnpm --filter @milkup/export test` (11 export tests), `pnpm --filter @milkup/export typecheck`, and `pnpm format`.
- Verified `pnpm test`, `pnpm typecheck`, `pnpm build`, `pnpm lint`, and `pnpm test:e2e` (3 Playwright tests) after the M12 theme/PDF-provider contract slice.
- Added `createPlainTextPdfProvider` as a baseline DOM-free PDF provider in `@milkup/export`, converting the self-owned Markdown CST into readable text lines and writing valid PDF 1.4 bytes.
- Added PDF baseline coverage for catalog/font/content references, extracted Markdown text, code block text, and EOF trailer; marked M12 Export Pipeline complete at the core package level while leaving high-fidelity/native PDF and CJK font embedding as follow-ups.
- Verified `pnpm --filter @milkup/export test` (12 export tests), `pnpm --filter @milkup/export typecheck`, `pnpm test`, `pnpm typecheck`, `pnpm build`, `pnpm lint`, and `pnpm test:e2e` (3 Playwright tests) after completing the M12 baseline PDF slice.
- Started M9 by adding an async `DocumentStore` contract in `@milkup/core`, with chunk reads, ChangeSet-based mutation, immutable snapshots, and flush results for persistence adapters.
- Added `MemoryDocumentStore` as the first store implementation, backed by `MemoryTextDocument` but exposing versioned store-level snapshots so future Tauri/Rust stores can share the same API.
- Added core store tests for initial snapshots, bounded UTF-16 chunk reads, out-of-range rejection, multi-change application, empty-change version stability, and full flush snapshots.
- Verified `pnpm --filter @milkup/core test` (31 core tests) and `pnpm --filter @milkup/core typecheck` after the first M9 DocumentStore slice.
- Verified `pnpm format`, `pnpm test`, `pnpm typecheck`, `pnpm build`, `pnpm lint`, and `pnpm test:e2e` (3 Playwright tests) after starting M9.
- Added `DocumentScaleMode` classification and default thresholds in `@milkup/core`; Windows preview thresholds are now conservative after manual latency feedback: normal under 128 KiB, incremental from 128 KiB, large/native from 256 KiB, and ultra-large from 2 MiB.
- Added `FeatureDegradationPolicy` so large and ultra-large modes explicitly avoid full-document DOM and full-document parse requirements, using viewport rendering, local/on-demand parsing, chunked search, and source-first behavior where needed.
- Added policy tests for default thresholds, custom thresholds, invalid inputs, normal/incremental/large/ultra-large degradation behavior, and full-DOM/full-parse invariants.
- Verified `pnpm --filter @milkup/core test` (38 core tests) and `pnpm --filter @milkup/core typecheck` after the M9 mode policy slice.
- Verified `pnpm format`, `pnpm test`, `pnpm typecheck`, `pnpm build`, `pnpm lint`, and `pnpm test:e2e` (3 Playwright tests) after the M9 mode policy slice.
- Extended `DocumentStore` with `readLine` and `readLineWindow`, giving virtual rendering, chunked search, and local parsing a shared way to request viewport-sized line ranges without reading the full document.
- Updated `MemoryDocumentStore` to expose line/window reads from the existing `MemoryTextDocument` line index, while leaving native Tauri file-store line indexing as a separate pending item.
- Added store tests for CRLF/LF line reads, multi-line window reads, and invalid line-window rejection.
- Verified `pnpm --filter @milkup/core test` (41 core tests) and `pnpm --filter @milkup/core typecheck` after the M9 core line-window slice.
- Verified `pnpm format`, `pnpm test`, `pnpm typecheck`, `pnpm build`, `pnpm lint`, and `pnpm test:e2e` (3 Playwright tests) after the M9 core line-window slice.
- Added `searchDocumentStore` as a reusable store-level chunked search helper over `DocumentStore.readLineWindow`, returning global UTF-16 offsets without requiring a full-document read.
- Added search support for string and RegExp queries, case-sensitive string matching, `maxResults`, and configurable line-window batch size.
- Added store-search tests for cross-window offsets, case-sensitive matching, non-global RegExp handling, early stop semantics, and invalid search inputs.
- Verified `pnpm --filter @milkup/core test` (46 core tests) and `pnpm --filter @milkup/core typecheck` after the M9 chunked search slice.
- Verified `pnpm format`, `pnpm test`, `pnpm typecheck`, `pnpm build`, `pnpm lint`, and `pnpm test:e2e` (3 Playwright tests) after the M9 chunked search slice.
- Added `parseMarkdownWindow` in `@milkup/markdown`, accepting a minimal line-window readable interface so `DocumentStore` can provide local Markdown parse input without making `@milkup/markdown` depend on `@milkup/core`.
- Local window parse results keep the window source separately and shift CST node, marker, content, and child ranges back into global document offsets.
- Added window parser tests proving requested line windows are parsed locally, outside lines are not included, and global CST offsets remain stable.
- Verified `pnpm --filter @milkup/markdown test` (49 markdown tests) and `pnpm --filter @milkup/markdown typecheck` after the M9 local parse window slice.
- Verified `pnpm format`, `pnpm test`, `pnpm typecheck`, `pnpm build`, `pnpm lint`, and `pnpm test:e2e` (3 Playwright tests) after the M9 local parse window slice.
- Added a large fenced-code local-parse test with a 256-line code block, proving `parseMarkdownWindow` parses only the requested line window and preserves global fenced-code marker/content offsets.
- Verified `pnpm --filter @milkup/markdown test` (50 markdown tests) and `pnpm --filter @milkup/markdown typecheck` after the M9 large-code-block local parse slice.
- Verified `pnpm format`, `pnpm test`, `pnpm typecheck`, `pnpm build`, `pnpm lint`, and `pnpm test:e2e` (3 Playwright tests) after the M9 large-code-block local parse slice.
- Added core large-document contract tests with a generated 10 MiB Markdown document, covering bounded line-window reads, edited flush snapshots, and global-history undo for a local edit.
- Verified `pnpm --filter @milkup/core test` (49 core tests) and `pnpm --filter @milkup/core typecheck` after the M9 10 MiB synthetic document slice.
- Verified `pnpm format`, `pnpm test`, `pnpm typecheck`, `pnpm build`, `pnpm lint`, and `pnpm test:e2e` (3 Playwright tests) after the M9 10 MiB synthetic document slice.
- Added a virtual 100 MiB synthetic Markdown `DocumentStore` contract test, proving store-level search can operate through bounded `readLineWindow` calls without materializing full document text.
- Verified `pnpm --filter @milkup/core test` (50 core tests) and `pnpm --filter @milkup/core typecheck` after the M9 virtual 100 MiB synthetic document slice.
- Verified `pnpm format`, `pnpm test`, `pnpm typecheck`, `pnpm build`, `pnpm lint`, and `pnpm test:e2e` (3 Playwright tests) after the M9 virtual 100 MiB synthetic document slice.
- Started M10 by adding `packages/core/src/actions`, including `ActionDefinition`, `ActionContext`, permission/risk metadata, schema validation, permission filtering, confirmation handling, and an `ActionRegistry` shared by future GUI/CLI/MCP surfaces.
- Added built-in core/document/view/file action definitions: undo, redo, replace selection, set selection, set view mode, and host-adapter-backed file placeholders for open/save/save-as/close.
- Added action registry tests for definition validation, input validation, permission filtering, missing-permission rejection, destructive action confirmation, transaction-backed document edits, and mode switches staying out of document history.
- Verified `pnpm --filter @milkup/core test` (57 core tests) and `pnpm --filter @milkup/core typecheck` after the M10 core Action Registry slice.
- Verified `pnpm format`, `pnpm test`, `pnpm typecheck`, `pnpm build`, `pnpm lint`, and `pnpm test:e2e` (3 Playwright tests) after the M10 core Action Registry slice.
- Added `@milkup/cli` with a `milkup` bin entry and testable `runCli` API.
- Implemented `milkup action list`, `milkup action describe`, and headless `milkup action run` over the shared core `ActionRegistry`, including JSON input, permission filtering, document text, and selection flags.
- Bundled the CLI bin with Vite so the compiled Node entry can run against workspace TypeScript packages without extensionless ESM resolution failures.
- Added CLI tests for action listing, permission-filtered listing, schema description, headless document action execution, and permission-denied action runs.
- Verified `pnpm --filter @milkup/cli test` (5 CLI tests), `pnpm --filter @milkup/cli typecheck`, `pnpm --filter @milkup/cli build`, and compiled Node smoke checks for `action list` and `action run document.replaceSelection`.
- Verified `pnpm format`, `pnpm test`, `pnpm typecheck`, `pnpm build`, `pnpm lint`, and `pnpm test:e2e` (3 Playwright tests) after the M10 CLI action command slice.
- Implemented `milkup export` in `@milkup/cli`, supporting headless Markdown/HTML/PDF export from `--document` or `--from-file`, stdout for text formats, `--out` file writes, and baseline PDF generation via `createPlainTextPdfProvider`.
- Added CLI export tests for HTML stdout, Markdown file-to-file export, PDF file export, and missing-input failure.
- Verified `pnpm --filter @milkup/cli test` (9 CLI tests), `pnpm --filter @milkup/cli typecheck`, `pnpm --filter @milkup/cli build`, and compiled Node smoke checks for HTML and PDF export.
- Verified `pnpm format`, `pnpm test`, `pnpm typecheck`, `pnpm build`, `pnpm lint`, and `pnpm test:e2e` (3 Playwright tests) after the M10 CLI export command slice.
- Added `@milkup/mcp` as a protocol-independent MCP projection package, so the transport wrapper can stay thin and generated from core contracts.
- Implemented MCP tool generation from `ActionRegistry`, including deterministic tool names, actionId metadata, required permissions, risk/read-only/destructive hints, confirmation metadata, allowlist filtering, and permission filtering.
- Implemented MCP resource projection for current document source, current selection, and workspace file tree.
- Added MCP tests for registry-derived tool generation, permission filtering, allowlist filtering, destructive confirmation metadata, and resource projection.
- Verified `pnpm --filter @milkup/mcp test` (5 MCP tests), `pnpm --filter @milkup/mcp typecheck`, and `pnpm --filter @milkup/mcp build` after the M10 MCP projection slice.
- Verified `pnpm format`, `pnpm test`, `pnpm typecheck`, `pnpm build`, `pnpm lint`, and `pnpm test:e2e` (3 Playwright tests) after the M10 MCP projection slice.
- Added a real `milkup-mcp` stdio JSON-RPC wrapper around the MCP projection layer, with handlers for `initialize`, `tools/list`, `tools/call`, `resources/list`, `resources/read`, and `notifications/initialized`.
- Added MCP server tests proving JSON-RPC initialization, permission-filtered tool listing, shared ActionRegistry tool execution, resource listing/reading, error responses, and one-response-per-line stdio behavior.
- Bundled the MCP bin with Vite SSR so the compiled stdio entry can run under Node without workspace TypeScript/ESM resolution issues.
- Verified `pnpm --filter @milkup/mcp test` (11 MCP tests), `pnpm --filter @milkup/mcp typecheck`, `pnpm --filter @milkup/mcp build`, and a compiled Node stdio smoke for `initialize`.
- Verified `pnpm format`, `pnpm test`, `pnpm typecheck`, `pnpm build`, `pnpm lint`, and `pnpm test:e2e` (3 Playwright tests) after the M10 MCP stdio transport slice.
- Started M11 by turning `packages/plugin` into `@milkup/plugin` with package scripts, TypeScript config, and Vitest config.
- Added plugin manifest schema and validation for plugin id/name/version/main/description, permissions, command contributions, keymap contributions, renderer contributions, and future markdown syntax declarations.
- Plugin permissions now reuse core action permissions; `network:access` was later promoted into core `ActionPermission` so action/CLI/MCP enforcement can use the same vocabulary.
- Added manifest tests for valid full contribution sets, top-level validation errors, unknown permissions, malformed contributions, markdown syntax block/inline requirements, and aggregate parse errors.
- Verified `pnpm --filter @milkup/plugin test` (5 plugin tests), `pnpm --filter @milkup/plugin typecheck`, and `pnpm --filter @milkup/plugin build` after the M11 plugin manifest slice.
- Verified `pnpm format`, `pnpm test`, `pnpm typecheck`, `pnpm build`, `pnpm lint`, and `pnpm test:e2e` (3 Playwright tests) after the M11 plugin manifest slice.
- Added `PluginRuntime` with local plugin load/enable/disable/unload/reload lifecycle, manifest permission allowlist checks, activation/deactivation hooks, renderer execution fallback, and plugin command actions registered into the shared `ActionRegistry`.
- Plugin command execution now uses a buffered editor context: plugin dispatches are replayed into the real editor only after the handler completes successfully, so thrown plugin commands cannot corrupt the document or create partial history entries.
- Added `ActionRegistry.unregister` to support dynamic plugin lifecycles and covered it with a core registry test.
- Added M11 runtime tests for plugin lifecycle, plugin command history/undo, failed-command rollback, action permission enforcement, destructive confirmation metadata, renderer throw fallback, MCP permission filtering, and activation-returned handlers.
- Verified `pnpm --filter @milkup/plugin test` (13 plugin tests), `pnpm --filter @milkup/core test` (58 core tests), `pnpm --filter @milkup/plugin typecheck`, `pnpm --filter @milkup/core typecheck`, and `pnpm --filter @milkup/plugin build` after the M11 plugin runtime slice.
- Verified `pnpm format`, `pnpm test`, `pnpm typecheck`, `pnpm build`, `pnpm lint`, and `pnpm test:e2e` (3 Playwright tests) after the M11 plugin runtime slice.
- Added a host-agnostic local plugin loader in `@milkup/plugin`, reading manifest JSON through an injected `readText` adapter and importing plugin modules through an injected `importModule` adapter, with default-export normalization for ESM plugin modules.
- Added restricted plugin host capabilities to activation and command contexts, exposing file/network helpers only when the manifest declares the corresponding permission; this is a capability baseline, not a full same-realm JavaScript sandbox.
- Added CLI plugin loading for `milkup action list`, `milkup action describe`, and `milkup action run` through `--plugin-manifest`, optional `--plugin-module`, and `--plugin-permissions`, so local plugin commands now appear in the same Action Registry used by CLI automation.
- Added plugin loader tests for manifest loading, dev module override, manifest-only plugins, invalid manifest JSON, and host capability restriction.
- Added CLI tests proving local plugin actions are listed as `category: "plugin"` and can run in the headless editor while producing normal transaction-backed history.
- Verified the compiled `packages/cli/dist/bin/milkup.js` can load a local plugin manifest/module and run the plugin action against a headless document; the smoke plugin uses the structural transaction protocol instead of importing `@milkup/core`, because a dedicated public plugin SDK entrypoint is still a follow-up.
- Verified `pnpm --filter @milkup/plugin test` (18 plugin tests), `pnpm --filter @milkup/cli test` (11 CLI tests), `pnpm --filter @milkup/plugin typecheck`, `pnpm --filter @milkup/cli typecheck`, `pnpm --filter @milkup/plugin build`, and `pnpm --filter @milkup/cli build` after the M11 loader/CLI plugin slice.
- Verified `pnpm format`, `pnpm test`, `pnpm typecheck`, `pnpm build`, `pnpm lint`, and `pnpm test:e2e` (3 Playwright tests) after the M11 loader/CLI plugin slice.
- Added `@milkup/plugin-sdk` as a stable public runtime entrypoint for external plugin modules, with plain JavaScript exports and TypeScript declarations so dynamically imported plugins do not need to import workspace TypeScript source packages directly.
- The plugin SDK now provides structural edit helpers (`insertText`, `replaceRange`, `deleteRange`), selection helpers (`cursor`, `rangeSelection`), and `dispatchInsert`, all shaped to work with the core transaction pipeline without coupling plugin modules to `@milkup/core`.
- Updated CLI plugin fixtures and compiled CLI smoke coverage to import `dispatchInsert` from `@milkup/plugin-sdk`, proving a local plugin can run through `packages/cli/dist/bin/milkup.js` and keep transaction-backed undo.
- Verified `pnpm --filter @milkup/plugin-sdk test` (5 SDK tests), `pnpm --filter @milkup/plugin-sdk typecheck`, `pnpm --filter @milkup/plugin-sdk build`, `pnpm --filter @milkup/cli test` (11 CLI tests), `pnpm --filter @milkup/cli typecheck`, and `pnpm --filter @milkup/cli build` after the plugin SDK slice.
- Verified `pnpm format`, `pnpm test`, `pnpm typecheck`, `pnpm build`, compiled CLI plugin-SDK smoke, `pnpm lint`, and `pnpm test:e2e` (3 Playwright tests) after the plugin SDK slice.
- Added `createIsolatedPluginModule` and the `PluginIsolationHost` protocol in `@milkup/plugin`, creating a serialization boundary for activation, command execution, renderer execution, dispose, and deactivate calls.
- Isolated commands now return serialized transactions that the main runtime converts back into core transactions, so a future Worker/Tauri realm never needs direct access to the live editor object.
- Added isolation protocol tests proving serialized command edits enter global history, the isolation host does not receive the real editor, restricted host capability names are the only capability data crossing the boundary, renderer failures still fall back, command failures do not modify the document, and dispose/deactivate are routed.
- Verified `pnpm --filter @milkup/plugin test` (25 plugin tests), `pnpm --filter @milkup/plugin typecheck`, and `pnpm --filter @milkup/plugin build` after the M11 isolation protocol slice.
- Verified `pnpm format`, `pnpm test`, `pnpm typecheck`, `pnpm build`, `pnpm lint`, and `pnpm test:e2e` (3 Playwright tests) after the M11 isolation protocol slice.
- Added Worker-style `postMessage` RPC transport for plugin isolation with `createRpcPluginIsolationHost` and `createPluginIsolationRpcServer`, keeping plugin activation, command, renderer, dispose, and deactivate calls on structured request/response messages.
- Added RPC transport tests for isolated command execution through `ActionRegistry`, renderer routing, remote error propagation, request timeouts, pending-call rejection on dispose, and cleanup.
- Verified `pnpm --filter @milkup/plugin test` (30 plugin tests), `pnpm --filter @milkup/plugin typecheck`, and `pnpm --filter @milkup/plugin build` after the M11 isolation RPC slice.
- Verified `pnpm format`, `pnpm test`, `pnpm typecheck`, `pnpm build`, `pnpm lint`, and `pnpm test:e2e` (3 Playwright tests) after the M11 isolation RPC slice.
- Added `createPluginModuleIsolationHost`, the isolated-realm executor that wraps a real plugin module behind the `PluginIsolationHost` protocol, gives plugins only a structural editor proxy, and returns serialized transactions to the main runtime.
- Added isolated module host coverage proving a plugin using `@milkup/plugin-sdk` can execute behind the RPC boundary, activation-returned commands/renderers work, host capabilities are filtered inside the realm, and plugin id mismatches are rejected before module code runs.
- Verified `pnpm --filter @milkup/plugin test` (34 plugin tests), `pnpm --filter @milkup/plugin typecheck`, and `pnpm --filter @milkup/plugin build` after the M11 isolated module host slice.
- Verified `pnpm format`, `pnpm test`, `pnpm typecheck`, `pnpm build`, `pnpm lint`, and `pnpm test:e2e` (3 Playwright tests) after the M11 isolated module host slice.
- Added browser Worker-style plugin loading APIs in `@milkup/plugin`: `createBrowserWorkerPluginHost`, `initializePluginWorkerRealm`, and `installNetworkGuards`.
- The Worker bootstrap now sends manifest/module init messages, dynamically imports plugin modules in the worker realm, wraps them with `createPluginModuleIsolationHost`, serves them through the existing RPC transport, reports initialization failures, and disposes/terminates worker endpoints.
- Added Worker isolation coverage for plugin command execution through `@milkup/plugin-sdk`, import failure reporting, no-network global guards before plugin import, preserved network globals with `network:access`, and worker termination on dispose.
- Verified `pnpm --filter @milkup/plugin test` (39 plugin tests), `pnpm --filter @milkup/plugin typecheck`, and `pnpm --filter @milkup/plugin build` after the M11 browser Worker loader slice.
- Verified `pnpm format`, `pnpm test`, `pnpm typecheck`, `pnpm build`, `pnpm lint`, and `pnpm test:e2e` (3 Playwright tests) after the M11 browser Worker loader slice.
- Wired the browser Worker plugin host into `@milkup/playground` with a real module Worker bootstrap, a dynamically imported worker-realm demo plugin, `PluginRuntime`, `ActionRegistry`, and the isolated plugin module adapter.
- Added playground UI state for the Worker plugin fixture and a view-backed editor adapter so Worker plugin commands still mutate the document through the shared transaction/history pipeline.
- Updated playground Vite worker output to `format: "es"` so worker-realm dynamic imports build as real JS chunks; production build now emits both `plugin-worker-*.js` and `worker-demo-plugin-*.js`.
- Suppressed the intentional runtime plugin dynamic-import warning in the generic Worker loader with `/* @vite-ignore */`.
- Added Playwright coverage proving a real browser Worker plugin command loads, runs, inserts text into the editor, advances the cursor, and flips global undo history from `false` to `true`.
- Verified `pnpm --filter @milkup/plugin test` (39 plugin tests), `pnpm --filter @milkup/plugin typecheck`, `pnpm --filter @milkup/playground typecheck`, `pnpm --filter @milkup/playground build`, and `pnpm exec playwright test tests/e2e/live-render.spec.ts --project=playground-msedge` (2 Playwright tests) after the playground Worker integration slice.
- Verified `pnpm format`, `pnpm test`, `pnpm typecheck`, `pnpm build`, `pnpm lint`, and `pnpm test:e2e` (4 Playwright tests) after the playground Worker integration slice.
- Added [plugin-native-host-decision.md](./plugin-native-host-decision.md), accepting a tiered plugin host model: Browser module Worker as the default JS plugin realm, Tauri as a broker for desktop filesystem policy, and native sidecar only for explicitly approved advanced plugins.
- The native host decision keeps all plugin commands on the shared `ActionRegistry` and transaction/history path, and defines the next implementation slice as a host-agnostic filesystem broker with permission checks, scoped roots, canonicalized path validation, and audit-friendly operations.
- Kept `Restrict filesystem/network access` unchecked because the decision document does not yet implement broker enforcement or native filesystem capability checks.
- Added `createPluginFileBroker` in `@milkup/plugin`, defining a host-agnostic filesystem broker contract over an injected adapter with explicit `readText`, `writeText`, and `deleteFile` operations.
- The broker enforces manifest permissions (`file:read`, `file:write`, `file:delete`), per-root operation limits, canonicalized path scope checks, Windows separator normalization, and audit records for allowed/denied operations before delegating to any host filesystem adapter.
- Added broker tests for permission denial, read/write/delete separation, per-root operation limits, sibling prefix escapes, `..` traversal after canonicalization, symlink-style adapter resolution escapes, Windows paths, audit records, and duplicate root validation.
- Exported the filesystem broker API from `@milkup/plugin`; broker integration into `PluginRuntime`/isolated host capabilities remains the next slice, so `Restrict filesystem/network access` stays unchecked.
- Verified `pnpm --filter @milkup/plugin test` (49 plugin tests), `pnpm --filter @milkup/plugin typecheck`, and `pnpm --filter @milkup/plugin build` after the filesystem broker contract slice.
- Wired `PluginFileBroker` into `PluginRuntime` with a `fileBroker` option, allowing hosts to provide either a broker instance or a manifest-aware provider while keeping broker-backed file functions preferred over raw host file functions.
- Wired `PluginFileBroker` into `createPluginModuleIsolationHost`, so isolated executors can expose broker-backed file capabilities only when the incoming isolated request includes the matching `hostCapabilities` entries.
- Added `createPluginFileHostCapabilities` as the shared adapter from broker operations to plugin `context.host.readText/writeText/deleteFile` functions.
- Added runtime and isolated module host tests proving broker-backed file host functions are used instead of raw host functions, and that isolated `hostCapabilities` still disable file access even when a broker exists.
- Verified `pnpm --filter @milkup/plugin test` (51 plugin tests), `pnpm --filter @milkup/plugin typecheck`, and `pnpm --filter @milkup/plugin build` after the broker runtime/isolation wiring slice.
- Added Worker/main-thread filesystem capability RPC with `createRpcPluginFileBroker` and `createPluginFileRpcServer`, using a separate postMessage protocol over the same Worker endpoint as plugin isolation RPC.
- Wired `createBrowserWorkerPluginHost` to host an optional main-thread `PluginFileBroker`, and wired `initializePluginWorkerRealm` to pass a remote file broker into `createPluginModuleIsolationHost`.
- Added Worker isolation tests proving a Worker plugin can read/write through the main-thread filesystem broker, and that broker path denials propagate back as plugin command failures without calling the host adapter.
- Verified `pnpm --filter @milkup/plugin test` (53 plugin tests), `pnpm --filter @milkup/plugin typecheck`, and `pnpm --filter @milkup/plugin build` after the Worker filesystem RPC bridge slice.
- Added a desktop plugin filesystem broker adapter in `apps/desktop`, mapping the broker adapter contract to dedicated Tauri invoke commands: `resolve_plugin_file_path`, `read_plugin_text_file`, `write_plugin_text_file`, and `delete_plugin_file`.
- Added frontend tests proving the desktop adapter calls the dedicated Tauri commands and composes with `PluginFileBroker` scope checks before invoking host reads for escaped paths.
- Added Rust source for the dedicated plugin file commands, including canonicalized path resolution for existing paths and parent-canonicalized resolution for new file writes.
- Verified `pnpm --filter @milkup/desktop test` (5 desktop tests), `pnpm --filter @milkup/desktop typecheck`, and `pnpm --filter @milkup/desktop build` after the desktop plugin filesystem broker adapter slice.
- `cargo --version` still fails in this environment, so native Rust/Tauri command verification remains blocked and `Restrict filesystem/network access` stays unchecked.
- Added desktop TS-level Worker plugin filesystem broker smoke coverage, composing `createDesktopPluginFileBroker`, `createBrowserWorkerPluginHost`, `initializePluginWorkerRealm`, `createIsolatedPluginModule`, `PluginRuntime`, and `ActionRegistry` in one test.
- The smoke test proves a Worker plugin command can read/write through the desktop broker adapter and main-thread file RPC while still using plugin permissions and the shared action surface.
- Verified `pnpm --filter @milkup/desktop test` (6 desktop tests), `pnpm --filter @milkup/desktop typecheck`, and `pnpm --filter @milkup/desktop build` after the desktop Worker broker smoke slice.
- Wired CLI/headless plugin file host capabilities through a Node-backed `PluginFileBroker`, defaulting the allowed root to the plugin manifest directory and supporting an explicit `--plugin-root` override.
- Added CLI tests proving a plugin command can read/write through `context.host.readText/writeText` inside the scoped root, and that paths outside the CLI plugin root are rejected by the broker and surfaced as plugin command failures.
- This does not make same-realm Node plugin modules a hard sandbox, because a malicious plugin can still import Node APIs directly; it does make the official milkup plugin host file capabilities scoped and brokered.
- Verified `pnpm --filter @milkup/cli test` (13 CLI tests), `pnpm --filter @milkup/cli typecheck`, and `pnpm --filter @milkup/cli build` after the CLI filesystem broker slice.
- Added `createPluginNetworkBroker` in `@milkup/plugin`, defining a host-agnostic network broker contract over an injected adapter with manifest `network:access` enforcement, URL validation, optional allowed-origin policy, and audit records.
- Wired `PluginNetworkBroker` into `PluginRuntime` and `createPluginModuleIsolationHost`, so official plugin `context.host.fetch` prefers broker-backed fetch over raw host fetch while still respecting exposed host capabilities.
- Added Worker/main-thread network capability RPC with `createRpcPluginNetworkBroker` and `createPluginNetworkRpcServer`, and wired Browser Worker plugin host/bootstrap APIs so Worker plugins can fetch through the main-thread network broker.
- Added network broker, runtime routing, isolated module host routing, and Worker RPC tests proving allowed fetches use the broker and broker denials surface as plugin command failures.
- Verified `pnpm --filter @milkup/plugin test` (62 plugin tests), `pnpm --filter @milkup/plugin typecheck`, and `pnpm --filter @milkup/plugin build` after the M11 network broker/RPC slice.
- Wired CLI/headless plugin network host capabilities through a Node-backed `PluginNetworkBroker`, with optional `--plugin-network-origin` allowlist support for official `context.host.fetch`.
- Added CLI tests proving a plugin command can fetch through the broker with explicit `network:access`, and that disallowed origins are rejected by the broker and surfaced as plugin command failures.
- Verified `pnpm --filter @milkup/cli test` (15 CLI tests), `pnpm --filter @milkup/cli typecheck`, and `pnpm --filter @milkup/cli build` after the CLI network broker slice.
- Routed CLI/headless plugin modules through `createPluginModuleIsolationHost` and `createIsolatedPluginModule` by default, reusing the same CLI file/network brokers on both the runtime capability side and isolated host execution side.
- Added CLI coverage proving plugin commands still edit through the shared transaction/history pipeline while the command context only sees the isolated structural editor proxy, not the full host editor document object.
- Verified `pnpm --filter @milkup/cli test` (16 CLI tests), `pnpm --filter @milkup/cli typecheck`, and `pnpm --filter @milkup/cli build` after the CLI isolated module host slice.
- Extended the playground real Browser Worker plugin fixture with a network command that calls official `context.host.fetch`, routes through the main-thread `PluginNetworkBroker`, and applies the fetched text through the shared transaction/history pipeline.
- Added Playwright coverage proving the real Browser Worker network command reaches `fetched` status, inserts broker-returned text into the editor, and creates an undoable document transaction.
- Verified `pnpm --filter @milkup/playground typecheck`, `pnpm --filter @milkup/playground build`, and `pnpm exec playwright test tests/e2e/live-render.spec.ts --project=playground-msedge` (3 Playwright tests) after the playground Worker network broker slice.
- Extended the playground real Browser Worker plugin fixture with a file command that calls official `context.host.readText`, routes through the main-thread `PluginFileBroker`, and applies the broker-returned text through the shared transaction/history pipeline.
- Added Playwright coverage proving the real Browser Worker file command reaches `filed` status, inserts broker-returned text into the editor, and creates an undoable document transaction.
- Verified `pnpm --filter @milkup/playground typecheck`, `pnpm --filter @milkup/playground build`, and `pnpm exec playwright test tests/e2e/live-render.spec.ts --project=playground-msedge` (4 Playwright tests) after the playground Worker file broker slice.
- Tightened Browser Worker network globals: the worker realm now creates its remote `PluginNetworkBroker` before importing plugin code, routes ambient `fetch` through that broker when `network:access` is granted, and blocks unbrokered `WebSocket`/`EventSource`/`XMLHttpRequest` globals.
- Added Worker isolation tests proving top-level plugin import code cannot use ambient `fetch` to bypass the main-thread broker, and that broker-backed ambient fetch replaces any raw worker fetch function.
- Verified `pnpm --filter @milkup/plugin test` (63 plugin tests), `pnpm --filter @milkup/plugin typecheck`, `pnpm --filter @milkup/plugin build`, `pnpm --filter @milkup/playground typecheck`, `pnpm --filter @milkup/playground build`, and `pnpm exec playwright test tests/e2e/live-render.spec.ts --project=playground-msedge` (4 Playwright tests) after the Worker ambient network guard slice.
- Added Worker broker audit coverage proving main-thread `PluginFileBroker` and `PluginNetworkBroker` audit sinks receive records for Worker-originated successful operations and broker denials.
- Verified `pnpm --filter @milkup/plugin test` (65 plugin tests), `pnpm --filter @milkup/plugin typecheck`, and `pnpm --filter @milkup/plugin build` after the Worker broker audit slice.
- Promoted `network:access` into core `ActionPermission`, so plugin actions with network capability now require action-level network permission in `ActionRegistry`, CLI, and MCP instead of only being checked at plugin enable time.
- Network-capable plugin actions are projected as `write` risk and non-read-only MCP tools, with `network:access` included in MCP `requiredPermissions`.
- Added runtime/MCP coverage for network plugin action permission projection and CLI coverage proving network plugin actions are rejected without action-level `--permissions network:access`.
- Verified `pnpm --filter @milkup/core test`, `pnpm --filter @milkup/core typecheck`, `pnpm --filter @milkup/core build`, `pnpm --filter @milkup/plugin test`, `pnpm --filter @milkup/plugin typecheck`, `pnpm --filter @milkup/plugin build`, `pnpm --filter @milkup/cli test`, `pnpm --filter @milkup/cli typecheck`, `pnpm --filter @milkup/cli build`, `pnpm --filter @milkup/mcp test`, `pnpm --filter @milkup/mcp typecheck`, `pnpm --filter @milkup/mcp build`, `pnpm --filter @milkup/playground typecheck`, `pnpm --filter @milkup/playground build`, and `pnpm exec playwright test tests/e2e/live-render.spec.ts --project=playground-msedge` (4 Playwright tests) after the network ActionPermission projection slice.
- Added optional command-level `permissions` to plugin command contributions, validated as a subset of top-level manifest permissions.
- `PluginRuntime` now derives action permissions/risk and command `context.host` exposure from command-level permissions when present, so a plugin can keep broad manifest capabilities while exposing narrower CLI/MCP/AI tools.
- Updated the playground Worker demo manifest to narrow each command separately: text insertion, file read, and network fetch no longer share one over-broad action permission set.
- Verified `pnpm --filter @milkup/plugin test` (67 plugin tests), `pnpm --filter @milkup/plugin typecheck`, `pnpm --filter @milkup/plugin build`, `pnpm --filter @milkup/playground typecheck`, `pnpm --filter @milkup/playground build`, `pnpm exec playwright test tests/e2e/live-render.spec.ts --project=playground-msedge` (4 Playwright tests), `pnpm --filter @milkup/cli test`, `pnpm --filter @milkup/cli typecheck`, `pnpm --filter @milkup/cli build`, `pnpm --filter @milkup/mcp test`, `pnpm --filter @milkup/mcp typecheck`, and `pnpm --filter @milkup/mcp build` after the command-level plugin permission slice.
- Strengthened plugin manifest validation for contribution integrity: duplicate command ids, duplicate command actions, duplicate renderer ids, duplicate markdown syntax ids, and keymaps pointing at unknown command actions are now rejected during manifest parsing.
- Added manifest tests for duplicate contribution detection and unknown keymap command references.
- Verified `pnpm --filter @milkup/plugin test` (68 plugin tests), `pnpm --filter @milkup/plugin typecheck`, `pnpm --filter @milkup/plugin build`, and `pnpm --filter @milkup/cli test` after the manifest contribution integrity slice.
- Added optional `inputSchema` to plugin command contributions, using the existing core `ActionInputSchema` shape so plugin actions can expose structured inputs to CLI/MCP/AI surfaces.
- `PluginRuntime` now projects command `inputSchema` into registered plugin actions, so Action Registry validates plugin command input and MCP tools expose the same JSON schema.
- Added manifest, runtime/MCP, and CLI tests proving plugin command schemas are parsed, malformed schemas are rejected, MCP tool schemas are generated, and `milkup action run` rejects invalid plugin input before running module code.
- Verified `pnpm --filter @milkup/plugin test` (70 plugin tests), `pnpm --filter @milkup/plugin typecheck`, `pnpm --filter @milkup/plugin build`, `pnpm --filter @milkup/cli test` (18 CLI tests), `pnpm --filter @milkup/cli typecheck`, `pnpm --filter @milkup/cli build`, `pnpm --filter @milkup/mcp test`, `pnpm --filter @milkup/mcp typecheck`, and `pnpm --filter @milkup/mcp build` after the plugin command input schema slice.
- Blocked Browser Worker `importScripts` before plugin modules are imported, including when `network:access` is present and ambient `fetch` is broker-backed, so Worker plugins cannot bypass the declared module specifier and brokered network policy by loading extra scripts.
- Added Worker isolation tests proving `importScripts` is blocked both without network permission and with brokered network permission, while brokered ambient `fetch` still works.
- Verified `pnpm --filter @milkup/plugin test` (71 plugin tests), `pnpm --filter @milkup/plugin typecheck`, `pnpm --filter @milkup/plugin build`, `pnpm --filter @milkup/playground typecheck`, `pnpm --filter @milkup/playground build`, and `pnpm exec playwright test tests/e2e/live-render.spec.ts --project=playground-msedge` (4 Playwright tests) after the Worker code-loading guard slice.
- Extended the Browser Worker code-loading guard to block child `Worker` and `SharedWorker` construction before plugin modules are imported, preventing plugins from spawning unbrokered execution realms even when `network:access` is granted.
- Added Worker isolation tests proving child worker creation is blocked both without network permission and with brokered network permission, while brokered ambient `fetch` remains usable.
- Verified `pnpm --filter @milkup/plugin test` (72 plugin tests), `pnpm --filter @milkup/plugin typecheck`, `pnpm --filter @milkup/plugin build`, `pnpm --filter @milkup/playground typecheck`, `pnpm --filter @milkup/playground build`, and `pnpm exec playwright test tests/e2e/live-render.spec.ts --project=playground-msedge` (4 Playwright tests) after the child Worker guard slice.
- Extended the Browser Worker code-loading guard to block `eval` and `Function` before plugin modules are imported, preventing dynamic code execution outside the declared plugin module path even when `network:access` is granted.
- Added Worker isolation tests proving dynamic code execution is blocked both without network permission and with brokered network permission, while brokered ambient `fetch` remains usable.
- Verified `pnpm --filter @milkup/plugin test` (73 plugin tests), `pnpm --filter @milkup/plugin typecheck`, `pnpm --filter @milkup/plugin build`, `pnpm --filter @milkup/playground typecheck`, `pnpm --filter @milkup/playground build`, and `pnpm exec playwright test tests/e2e/live-render.spec.ts --project=playground-msedge` (4 Playwright tests) after the dynamic code guard slice.
- Extended `PluginFileBroker` audit coverage so adapter/native read/write/delete failures after successful authorization are recorded as failed audit entries rather than only surfacing as thrown errors.
- Tightened the desktop plugin file broker adapter so false native write/delete command results are rejected explicitly, allowing the shared broker audit path to capture native denials.
- Verified `pnpm --filter @milkup/plugin test` (74 plugin tests), `pnpm --filter @milkup/plugin typecheck`, `pnpm --filter @milkup/plugin build`, `pnpm --filter @milkup/desktop test` (8 desktop tests), `pnpm --filter @milkup/desktop typecheck`, and `pnpm --filter @milkup/desktop build` after the adapter/native file failure audit slice.
- Installed/enabled a user-level Rust toolchain and WinLibs GNU toolchain in this environment, added a minimal required Tauri Windows icon resource, and narrowed the desktop Rust library crate type to `rlib` so the desktop binary can build under the GNU target without linking an unnecessary cdylib.
- Verified native Rust/Tauri CLI paths with `cargo +stable-x86_64-pc-windows-gnu check` in `apps/desktop/src-tauri`, `pnpm --filter @milkup/desktop tauri info`, and `pnpm --filter @milkup/desktop tauri build --debug --target x86_64-pc-windows-gnu`; the debug binary was produced at `apps/desktop/src-tauri/target/x86_64-pc-windows-gnu/debug/milkup-desktop.exe`.
- Ran a native binary launch smoke by starting `milkup-desktop.exe`, confirming the process was still alive after 5 seconds, and then stopping it; real window-level open/save/save-as/reload/watch verification remains pending.
- Added a deterministic native-test path override for the desktop Tauri file service so WebDriver automation can bypass OS dialogs while still invoking `open_markdown_file` and `save_markdown_file`.
- Added `tests/native/tauri-webdriver-smoke.mjs` and root `pnpm test:native:desktop`, which starts `tauri-driver`, launches the real debug Tauri binary, opens a temp Markdown file, types through WebDriver, verifies native save and save-as writes on disk, calls reveal with a test-only Rust no-op guard, reloads external disk changes while preserving `DocumentSession.documentId`, and verifies real filesystem modify/delete watcher events reach the desktop session UI.
- Downloaded matching Microsoft Edge WebDriver `149.0.4022.98` for the WebView2 runtime and verified `pnpm test:native:desktop` passes against `apps/desktop/src-tauri/target/x86_64-pc-windows-gnu/debug/milkup-desktop.exe`; the first attempted `150.0.4078.48` driver proved the machine's Edge browser version can differ from the WebView2 runtime version.
- Verified `pnpm --filter @milkup/desktop test` (8 desktop tests), `pnpm --filter @milkup/desktop typecheck`, `pnpm --filter @milkup/desktop build`, `cargo +stable-x86_64-pc-windows-gnu test`, `cargo +stable-x86_64-pc-windows-gnu check`, `cargo +stable-x86_64-pc-windows-gnu fmt --check`, `pnpm --filter @milkup/desktop tauri build --debug --target x86_64-pc-windows-gnu`, `pnpm test:native:desktop`, `pnpm format`, and `pnpm lint` after native WebDriver coverage.
- Extended the native Tauri WebDriver smoke with watcher-backed v1 dirty/save/file-watcher regression checks: own-save watcher echo must leave `externalChangeState` as `none`, dirty documents receiving a real filesystem modification must enter `conflict`, and conflict-state Save must be blocked without overwriting the external disk content.
- Verified the extended native regression path with `pnpm test:native:desktop`.
- Extended the native Tauri WebDriver smoke to paste an image file into an opened Markdown document, verifying the desktop session-aware asset provider inserts `assets/native-diagram.png` Markdown and the Tauri asset commands write the expected image bytes to the sibling `assets/` directory on disk.
- Verified the native asset-write path with `pnpm test:native:desktop` and `pnpm format`.
- Added a desktop Worker plugin fixture and test-only desktop harness entrypoint that launches a real module Worker in the Tauri WebView, routes plugin `readText`/`writeText` through `createDesktopPluginFileBroker` and native Tauri file commands, and applies the plugin's serialized document transaction back through the desktop editor/session pipeline.
- Updated the native Tauri WebDriver smoke to call the desktop Worker plugin fixture against a real temporary file, verifying brokered read/write results on disk and confirming the plugin command mutates the current document through the shared transaction path.
- Verified the desktop Worker/Tauri broker fixture with `pnpm --filter @milkup/desktop typecheck`, `pnpm --filter @milkup/desktop build`, `pnpm --filter @milkup/desktop tauri build --debug --target x86_64-pc-windows-gnu`, and `pnpm test:native:desktop`.
- Added `PluginManifest.host` with `worker` and `sidecar` host tiers, defaulting missing `host` to the worker policy.
- Added `PluginRuntime.allowedHosts`, defaulting to `worker`, so `host: "sidecar"` plugins are rejected during enable unless the embedding host explicitly allows that tier.
- Tightened `loadLocalPlugin` so sidecar-declared plugins are not imported through the ordinary JavaScript module loader unless the caller explicitly opts into that host tier.
- Updated [plugin-native-host-decision.md](./plugin-native-host-decision.md) to record the sidecar declaration/approval gate and keep sidecar process IPC deferred.
- Verified `pnpm --filter @milkup/plugin test` (79 plugin tests), `pnpm --filter @milkup/plugin typecheck`, `pnpm --filter @milkup/plugin build`, `pnpm --filter @milkup/cli test` (18 CLI tests), `pnpm --filter @milkup/cli typecheck`, `pnpm --filter @milkup/cli build`, `pnpm format`, and `pnpm lint` after the sidecar host gate slice.
- Added `createSidecarPluginModule` in `@milkup/plugin`, defining a host-agnostic sidecar process contract with explicit `start`/`stop` lifecycle, an endpoint compatible with the existing plugin isolation RPC transport, and optional `moduleSpecifier` handoff.
- Sidecar-hosted plugins now reuse `createIsolatedPluginModule` and `PluginIsolationHost` RPC, so sidecar command results still return serialized transactions that are applied through the normal runtime/action/editor transaction path.
- Added sidecar adapter tests proving explicit `allowedHosts: ["sidecar"]` starts the sidecar endpoint, runs a command over RPC, mutates the editor through serialized transactions/history, calls remote dispose/deactivate, closes the endpoint, and stops the process on disable.
- Added a sidecar default-denial test proving runtime host-tier rejection happens before the sidecar process is started.
- Verified `pnpm --filter @milkup/plugin test` (82 plugin tests) and `pnpm --filter @milkup/plugin typecheck` after the sidecar lifecycle/RPC adapter slice.
- Added `createDesktopPluginSidecarProcess` in `apps/desktop`, adapting `PluginSidecarProcess` to Tauri invoke/listen with `start_plugin_sidecar_process`, `send_plugin_sidecar_message`, `stop_plugin_sidecar_process`, and `milkup-plugin-sidecar-message`.
- Added Rust command source for stdio sidecar processes: sidecar executable paths must be absolute, outgoing messages are written as JSON lines to stdin, stdout JSON lines are emitted to the frontend as plugin-scoped Tauri events, and stop kills/waits the child process.
- Added desktop frontend tests for sidecar start/message/event filtering/stop and Rust tests for executable path policy plus camelCase sidecar event payload serialization.
- Verified `pnpm --filter @milkup/desktop test` (10 desktop tests), `pnpm --filter @milkup/desktop typecheck`, `pnpm --filter @milkup/desktop build`, `cargo +stable-x86_64-pc-windows-gnu test`, `cargo +stable-x86_64-pc-windows-gnu fmt --check`, `cargo +stable-x86_64-pc-windows-gnu check`, `pnpm lint`, and `pnpm --filter @milkup/desktop tauri build --debug --target x86_64-pc-windows-gnu` after the desktop/Tauri sidecar adapter slice.
- Extended the desktop test harness with `runDesktopSidecarPluginFixture`, using `createSidecarPluginModule`, `createDesktopPluginSidecarProcess`, `PluginRuntime.allowedHosts: ["sidecar"]`, and the shared `ActionRegistry`/editor transaction path.
- Extended `tests/native/tauri-webdriver-smoke.mjs` with a temporary Node stdio sidecar fixture launched by the running Tauri app, verifying isolation RPC `activate`/`runCommand`/`dispose`/`deactivate`, serialized transaction insertion of `native sidecar content`, and sidecar process exit after plugin unload.
- Verified the native sidecar fixture with `pnpm --filter @milkup/desktop typecheck`, `pnpm --filter @milkup/desktop build`, `pnpm lint`, `pnpm --filter @milkup/desktop tauri build --debug --target x86_64-pc-windows-gnu`, and `pnpm test:native:desktop`.
- Tightened `PluginRuntime` so direct in-process plugin modules are rejected by default; trusted same-realm fixtures must explicitly opt in with `allowInProcessModules`, while isolated Worker/CLI/sidecar modules advertise `runtimeHost: "isolated"`.
- Added [m11-plugin-sandbox-audit.md](./m11-plugin-sandbox-audit.md), mapping M11 filesystem/network/host-tier sandbox requirements to concrete package, CLI, desktop, Rust, and native WebDriver evidence.
- Marked M11 `Restrict filesystem/network access`, `Move plugin execution into a true isolated host realm`, and the sandbox audit follow-up complete after the audit and focused verification.
- Verified `pnpm --filter @milkup/plugin test` (83 plugin tests), `pnpm --filter @milkup/plugin typecheck`, `pnpm --filter @milkup/plugin build`, `pnpm --filter @milkup/cli test` (18 CLI tests), `pnpm --filter @milkup/cli typecheck`, `pnpm --filter @milkup/desktop typecheck`, `pnpm format`, and `pnpm lint` after the runtime default in-process denial and M11 sandbox audit slice.
- Verified `pnpm --filter @milkup/cli typecheck`, `pnpm --filter @milkup/desktop test` (10 desktop tests), `pnpm --filter @milkup/desktop typecheck`, and `pnpm lint` during final M11 closeout, then marked M11 Plugin Runtime complete.
- Started the M9 Tauri file store slice with read-only large text file commands: `open_large_text_file`, `read_large_text_file_chunk`, `read_large_text_file_line_window`, and `close_large_text_file`.
- The Rust large text file service now keeps a line index, validates byte ranges against UTF-8 character boundaries, and returns global UTF-16 editor offsets alongside byte ranges for chunks, line windows, and individual lines.
- Added `createDesktopLargeTextFileService` in `apps/desktop`, mapping the frontend adapter to the dedicated Tauri large-file commands and exposing byte/UTF-16 range metadata to TypeScript callers.
- Added desktop adapter tests and Rust helper tests for LF/CRLF line indexing, UTF-8 boundary rejection, line-window bounds, and byte-to-UTF-16 offset mapping over ASCII, emoji, and CJK text.
- Verified `pnpm --filter @milkup/desktop test` (11 desktop tests), `pnpm --filter @milkup/desktop typecheck`, `pnpm --filter @milkup/desktop build`, `cargo +stable-x86_64-pc-windows-gnu check`, and `cargo +stable-x86_64-pc-windows-gnu fmt --check` after the M9 Tauri read/index/UTF-16 mapping slice.
- `cargo +stable-x86_64-pc-windows-gnu test` compiled the Rust test binary but could not launch it in this environment due to `STATUS_ENTRYPOINT_NOT_FOUND` while loading the Tauri/WebView2-linked test executable; MSVC fallback also remains unavailable because `link.exe` is not installed.
- Extended the M9 Tauri large text file service with version-checked safe change application: frontend changes are expressed in global UTF-16 editor offsets, Rust maps them to UTF-8 byte ranges, rejects invalid surrogate-boundary offsets, rejects overlapping ranges, rebuilds the line index, and advances the version only for non-empty change sets.
- Added atomic flush for changed large text files by writing a same-directory temporary file, syncing it, and replacing the destination with a Windows `MoveFileExW(REPLACE_EXISTING | WRITE_THROUGH)` path on Windows plus `rename` on non-Windows targets.
- Extended the desktop frontend large-file adapter with `applyChanges` and `flush`, including expected-version payloads and snapshot results.
- Added Rust helper tests for UTF-16 change application and atomic disk flush; note that this M9 slice is still an in-memory text-backed Tauri service and does not yet prove GB-scale lazy streaming behavior.
- Verified `pnpm --filter @milkup/desktop test` (11 desktop tests), `pnpm --filter @milkup/desktop typecheck`, `pnpm --filter @milkup/desktop build`, `pnpm format`, `pnpm lint`, `cargo +stable-x86_64-pc-windows-gnu fmt --check`, and `cargo +stable-x86_64-pc-windows-gnu check` after the safe apply/atomic flush slice.
- Re-ran `cargo +stable-x86_64-pc-windows-gnu test`; it still compiled successfully and then failed to launch the Tauri/WebView2-linked test executable with `STATUS_ENTRYPOINT_NOT_FOUND` in this environment.
- Added `packages/markdown/src/ast` with `parseMarkdownAst`/`createMarkdownAst`, projecting the source-preserving CST into an immutable Markdown AST with `raw`, source ranges, optional semantic `text`, structural `children`, and block-level `inlineChildren`.
- Added `packages/markdown/src/stringify` with `stringifyMarkdownAst`, defaulting to exact source-preserving roundtrip output while also supporting basic synthesized Markdown output when `preserveSource: false`.
- Added AST/stringify tests covering CST-to-AST projection, inline semantic children, exact roundtrip stringification, and synthesized heading/list output.
- Verified `pnpm --filter @milkup/markdown test` (53 markdown tests), `pnpm --filter @milkup/markdown typecheck`, and `pnpm --filter @milkup/markdown build` after the M3 AST/stringify slice.
- Added `createBrowserPrintPdfProvider` in `@milkup/export`, adapting the existing scoped `PdfExportProvider` contract to a host browser/native PDF renderer that receives the rendered HTML, title, document id, and font strategy metadata.
- Added `PdfFontStrategy` with CJK-capable fallback families and explicit `embeddingMode` values (`host-default`, `prefer-embed`, `require-embed`) so production renderers can either embed required fonts or fail clearly instead of silently producing missing glyphs.
- Added [export-pdf-font-strategy.md](./export-pdf-font-strategy.md), documenting the CJK/font embedding policy and the responsibility split between core export rendering and host PDF engines.
- Added export tests proving the browser/native print provider receives scoped HTML/CSS for the requested document, carries the CJK font strategy, and rejects renderer output that is not PDF bytes by default.
- Verified `pnpm --filter @milkup/export test` (14 export tests), `pnpm --filter @milkup/export typecheck`, and `pnpm --filter @milkup/export build` after the browser print PDF provider/font strategy slice.
- Added Shift+Arrow selection extension in `@milkup/view-dom`, so keyboard selection changes now dispatch selection-only transactions and render selection overlays without entering document history.
- Added browser Playwright coverage for selection rendering and scroll restoration in `tests/e2e/live-render.spec.ts`.
- Added [cross-cutting-test-audit.md](./cross-cutting-test-audit.md), mapping M16 unit, integration, and browser test strategy items to concrete current test files and verification commands while leaving the manual cross-platform matrix open.
- Verified `pnpm --filter @milkup/view-dom test` (74 view-dom tests), `pnpm --filter @milkup/view-dom typecheck`, and `pnpm exec playwright test tests/e2e/live-render.spec.ts --project=playground-msedge` (6 browser tests) after the Shift+Arrow selection and browser test strategy slice.
- Verified `pnpm test`, `pnpm typecheck`, `pnpm --filter @milkup/view-dom build`, `pnpm exec playwright test tests/e2e/live-render.spec.ts --project=playground-msedge` (6 browser tests), `pnpm format`, and `pnpm lint` after marking M16 unit/integration/browser strategy items complete.
- Added [implementation-decisions.md](./implementation-decisions.md), closing the remaining known open architecture questions: framework-free current app shells with Svelte preferred for future product UI, replaceable text-store contracts with Piece Table preferred before Rope, CommonMark+GFM compliance target, Worker/default plus sidecar/advanced plugin isolation, and Action Registry-generated headless MCP runtime.
- Added [core-invariants-audit.md](./core-invariants-audit.md), mapping each non-negotiable invariant to current unit, integration, browser, native, plugin, and regression evidence; marked the invariant checklist complete while leaving per-task development protocol checkboxes as reusable templates.
- Added [regression-policy.md](./regression-policy.md), requiring bug fixes to add automated regression coverage, a manual regression entry, or a documented exception before they can be considered complete.
- Added an `@milkup/regressions` policy guard that scans v1 regression test files for `v1Issue(...)` metadata with lesson and risk fields, then marked the M8 new-bug-fix regression-entry acceptance criterion complete.
- Verified `pnpm --filter @milkup/regressions test` (12 regression tests) and `pnpm --filter @milkup/regressions typecheck` after the M8 regression policy slice.
- Added a desktop file-service test proving Tauri Save As calls `@tauri-apps/plugin-dialog.save` when no deterministic native-test path override is present, then invokes `save_markdown_file` with the selected path.
- Marked the M6 Save As native-dialog implementation item complete while keeping manual OS dialog interaction verification open.
- Verified `pnpm --filter @milkup/desktop test` (12 desktop tests) and `pnpm --filter @milkup/desktop typecheck` after the Save As native-dialog adapter test.
- Added `pnpm bench:large-file` and [large-file-benchmark-protocol.md](./large-file-benchmark-protocol.md), providing a deterministic Markdown fixture generator plus scan/random-read baseline output for future GB-scale native benchmark reports.
- Verified `pnpm bench:large-file -- --size-mib 1` as a dry run; this proves the harness works, but does not satisfy the M9 GB-scale acceptance criterion because it is not a 1 GiB native Tauri benchmark.
- Added CLI attached app mode via `--attached-url` for `milkup action list`, `milkup action describe`, and `milkup action run`; when present, the CLI sends JSON-RPC 2.0 HTTP POST requests to the attached app endpoint instead of creating a headless editor.
- Added [attached-app-cli-protocol.md](./attached-app-cli-protocol.md), documenting the attached app JSON-RPC methods, payload shape, host responsibilities, and local-only security expectation.
- Added CLI tests for attached action listing, attached action run, and attached JSON-RPC error surfacing, then marked the M10 attached app CLI mode item complete.
- Verified `pnpm --filter @milkup/cli test` (21 CLI tests) and `pnpm --filter @milkup/cli typecheck` after the attached app CLI client slice.
- Added [manual-verification-protocol.md](./manual-verification-protocol.md), defining the evidence format and concrete manual steps for native Save As dialogs, cross-platform IME, Cmd/Ctrl shortcuts, file watcher behavior, and external editor conflicts.
- Linked the remaining manual M6/M16 checklist items to the manual verification protocol without marking them complete.
- Added `pnpm bench:native:large-file`, a native WebDriver benchmark harness that launches the debug Tauri app, generates a Markdown fixture, calls the dedicated large text file Tauri commands from the WebView, verifies head/middle/tail edits are flushed to disk, and can write a JSON report via `MILKUP_NATIVE_LARGE_FILE_REPORT`.
- Exposed `runDesktopLargeTextFileBenchmark` on the desktop test harness and optimized the Rust large text file service with per-line UTF-16 start offsets so line-window reads no longer compute global UTF-16 positions by scanning from the start of the file for each line.
- Added [native-large-file-benchmark-dry-run-2026-07-06.md](./native-large-file-benchmark-dry-run-2026-07-06.md), recording a 1 MiB native Tauri dry run. Middle/tail line-window timings improved from roughly 701 ms/1265 ms before the UTF-16 line index to 7.2 ms/5.6 ms after the optimization.
- Verified `pnpm --filter @milkup/desktop typecheck`, `pnpm --filter @milkup/desktop build`, `cargo +stable-x86_64-pc-windows-gnu check`, `cargo +stable-x86_64-pc-windows-gnu fmt --check`, `pnpm --filter @milkup/desktop tauri build --debug --target x86_64-pc-windows-gnu`, and `MILKUP_NATIVE_LARGE_FILE_MIB=1 pnpm bench:native:large-file` after the native large-file benchmark harness and UTF-16 line-index optimization.
- Updated `tests/native/tauri-large-file-benchmark.mjs` to keep native large-file reports stream-safe for larger fixtures: fixture generation, hash verification, and marker scans are streamed/batched, WebDriver script timeout is extended, and JSON reports are written before marker verification failures are thrown.
- Added [native-large-file-benchmark-256mib-2026-07-06.json](./native-large-file-benchmark-256mib-2026-07-06.json), recording a passing 256 MiB native Tauri benchmark on Windows 10.0.22631. It used native Tauri large-file commands, opened 268,435,456 bytes in 13,058.2 ms, applied edits in 49,846.9 ms, flushed in 1,127.4 ms, and verified head/middle/tail markers after flush.
- Added [native-large-file-benchmark-1gib-2026-07-06.json](./native-large-file-benchmark-1gib-2026-07-06.json), recording a passing 1 GiB native Tauri benchmark on the same Windows machine. It used native Tauri large-file commands, opened 1,073,741,824 bytes with 15,574,996 lines in 48,278.8 ms, read line windows in 10.1/5.2/4.0 ms, applied edits in 188,909.4 ms, flushed in 4,415.8 ms, and verified head/middle/tail markers after flush.
- Marked the M9 GB-scale benchmark evidence acceptance criterion complete based on the 256 MiB and 1 GiB native reports. This supports cautious public wording about documented 1 GiB native behavior, but the current Tauri service still keeps full text in memory after open and should not be described as true lazy streaming.
- Refreshed the current Windows native desktop automated evidence with `pnpm test:native:desktop`; it passed with the existing Tauri WebDriver smoke. Added [manual-verification-status-2026-07-06.md](./manual-verification-status-2026-07-06.md) to record the command, environment, and why this automated evidence still does not close the OS dialog, IME, shortcut, watcher, and external-editor manual checklist items.
- Synchronized the milestone overview for M7 and M8 to `Complete` after auditing their sections: all M7 paste/assets and M8 regression-suite checklist items and acceptance criteria are already checked, with remaining open items belonging to M6 manual native dialogs and M16 manual cross-platform verification.
- Added [manual-verification-windows-runbook-2026-07-06.md](./manual-verification-windows-runbook-2026-07-06.md), a Windows-first manual verification runbook with fixture setup, app launch command, concrete native Save As dialog, Windows Chinese IME, Windows Ctrl shortcut, Windows file watcher, and external-editor conflict steps plus report fields. This prepares the remaining Windows manual evidence but does not mark any manual checklist item complete.
- Added [manual-verification-report-template.md](./manual-verification-report-template.md), a reusable manual evidence report template with checklist mapping rows and sections for native dialogs, IME, shortcuts, file watcher, and external-editor conflict. This makes manual pass/fail evidence easier to record and audit before updating `coding-plan.md`.
- Added [manual-verification-cross-platform-runbook-2026-07-06.md](./manual-verification-cross-platform-runbook-2026-07-06.md), covering macOS Chinese IME, Linux IME, macOS Cmd shortcuts, and macOS file watcher manual runs with fixture setup, launch-command recording, platform metadata, and report fields. This prepares the remaining cross-platform evidence path but does not mark any manual checklist item complete.
- Added [completion-audit-2026-07-06.md](./completion-audit-2026-07-06.md), a conservative completion audit that maps each milestone to evidence, identifies M6/M16 manual requirements as the remaining project blockers, and names the exact reports needed before the overall goal can be marked complete.
- Routed desktop New/Open/Save/Save As/Reload/Reveal/Close/simulated external events, view-mode changes, select-all, cut, undo, and redo through a desktop `ActionRegistry`, then wired primary Windows/Linux Ctrl and macOS Cmd shortcuts to the same action dispatch path.
- Added Playwright coverage for desktop shortcut routing across open, save, save-as, source/live/preview mode switching, undo/redo, select-all plus cut, dirty close blocking, saved close, and new document creation.
- Updated [manual-verification-status-2026-07-06.md](./manual-verification-status-2026-07-06.md) with the new shortcut automation evidence; this earlier Windows Ctrl shortcut open item was later closed by [manual-verification-windows-ctrl-shortcuts-native-2026-07-07.md](./manual-verification-windows-ctrl-shortcuts-native-2026-07-07.md).
- Verified `pnpm --filter @milkup/desktop typecheck`, `pnpm --filter @milkup/desktop test`, `pnpm test:e2e`, `pnpm lint`, and `pnpm --filter @milkup/desktop build` after the desktop shortcut/action-registry slice.
- Extended `tests/native/tauri-webdriver-smoke.mjs` so the real Tauri WebDriver smoke now exercises Ctrl-triggered open/save/save-as/new/mode-switch/undo/redo/select-all-cut/close-protection paths when a native driver is available.
- Added native smoke driver bootstrapping: `tests/native/tauri-webdriver-smoke.mjs` now uses `TAURI_NATIVE_DRIVER` when provided, falls back to PATH, and otherwise downloads the matching Microsoft Edge WebView2 `msedgedriver.exe` from `msedgedriver.microsoft.com` into `.tmp/`.
- Rebuilt the Windows GNU Tauri debug binary after the shortcut work with `pnpm --filter @milkup/desktop tauri build --debug --target x86_64-pc-windows-gnu`.
- Verified `node --check tests/native/tauri-webdriver-smoke.mjs`, `pnpm --filter @milkup/desktop typecheck`, `pnpm --filter @milkup/desktop test`, `pnpm test:e2e`, `pnpm --filter @milkup/desktop build`, `pnpm --filter @milkup/desktop tauri build --debug --target x86_64-pc-windows-gnu`, `pnpm test:native:desktop`, and `pnpm lint` after the native shortcut smoke script update.
- Upgraded `scripts/open-manual-verification-windows.ps1` from a template copier into a prefilled Chinese Windows verification report generator: it records OS/build metadata, input-language hints, fixture paths, suggested Save As target, and external watcher/conflict commands, and supports `-PrepareOnly` plus `-Stamp` for non-interactive smoke checks.
- Updated `scripts/open-manual-verification-windows.cmd` to prefer `pwsh` while keeping a Windows PowerShell fallback, saved the PowerShell script with a UTF-8 BOM for Windows PowerShell compatibility, and routed `pnpm manual:windows` through the `.cmd` entrypoint.
- Updated [manual-verification-windows-runbook-2026-07-06.md](./manual-verification-windows-runbook-2026-07-06.md) and [manual-verification-status-2026-07-06.md](./manual-verification-status-2026-07-06.md) to describe the one-click prefilled Windows report path.
- Added `scripts/validate-manual-verification-report.mjs` and `pnpm manual:validate`, a conservative manual report validator that only accepts checklist rows backed by matching `Result: pass` sections with required fields and evidence text; `--allow-pending` supports draft structure checks before manual execution.
- Verified the validator against a generated Windows pending draft, confirmed ordinary validation rejects pending-only reports, and confirmed a `.tmp` minimal pass report is accepted as a checklist-proof smoke.
- Added `scripts/apply-manual-verification-report.mjs` and `pnpm manual:apply`, which reuses the manual report validator and safely maps passed report rows to the exact remaining `coding-plan.md` checkboxes. It defaults to dry-run and only writes when `--write` is supplied.
- Verified `manual:apply` against a temporary copy of `coding-plan.md`: dry-run left the file unchanged, `--write` checked only the report-backed rows, and a generated pending Windows draft was rejected before any plan update.
- Added `scripts/open-manual-verification-cross-platform.mjs` and `pnpm manual:cross-platform`, generating prefilled Chinese macOS/Linux manual verification report drafts with fixture paths and suggested external modification commands.
- Updated [manual-verification-cross-platform-runbook-2026-07-06.md](./manual-verification-cross-platform-runbook-2026-07-06.md), [manual-verification-status-2026-07-06.md](./manual-verification-status-2026-07-06.md), and [completion-audit-2026-07-06.md](./completion-audit-2026-07-06.md) to record the cross-platform report generator and validation/apply flow.
- Verified `node --check scripts/open-manual-verification-cross-platform.mjs`, `node --check scripts/validate-manual-verification-report.mjs`, `node --check scripts/apply-manual-verification-report.mjs`, `pnpm manual:cross-platform -- --platform macos --prepare-only --stamp codex-cross-pnpm-smoke`, `pnpm manual:cross-platform -- --platform linux --prepare-only --stamp codex-cross-pnpm-smoke`, both generated pending drafts with `pnpm manual:validate ... --allow-pending`, and that `pnpm manual:apply` rejects those pending-only drafts before any plan update. Smoke drafts and temp fixtures were cleaned afterward.
- Added [manual-verification-windows-os-dialog-user-2026-07-07.md](./manual-verification-windows-os-dialog-user-2026-07-07.md), recording the user's manual confirmation that Windows open/save/save-as/new OS interactions and the real OS Save As dialog are good.
- Verified `pnpm manual:validate docs/manual-verification-windows-os-dialog-user-2026-07-07.md`, dry-ran `pnpm manual:apply docs/manual-verification-windows-os-dialog-user-2026-07-07.md`, then applied it with `--write` to close the two remaining M6 native file dialog checklist items.
- Marked M6 Desktop File Workflow complete; remaining project blockers are now limited to the M16 manual matrix items that still need direct pass reports.
- Added [manual-verification-windows-native-watcher-conflict-2026-07-07.md](./manual-verification-windows-native-watcher-conflict-2026-07-07.md), recording current `pnpm test:native:desktop` evidence for Windows file watcher and same-file external conflict behavior in the real Tauri app.
- Verified `pnpm test:native:desktop`, `pnpm manual:validate docs/manual-verification-windows-native-watcher-conflict-2026-07-07.md`, dry-ran `pnpm manual:apply docs/manual-verification-windows-native-watcher-conflict-2026-07-07.md`, then applied it with `--write` to close M16 File watcher on Windows and M16 External editor conflict.
- Reworked `tests/native/tauri-webdriver-smoke.mjs` Windows Ctrl shortcut coverage to avoid the current Codex desktop session's unavailable system clipboard path: Ctrl+C is verified through the real copy event, paste transaction is verified with a standard WebView `ClipboardEvent`, and the fixture now checks the post-paste cut text correctly.
- Added [manual-verification-windows-ctrl-shortcuts-native-2026-07-07.md](./manual-verification-windows-ctrl-shortcuts-native-2026-07-07.md), validated it, dry-ran `pnpm manual:apply`, and applied it with `--write` to close M16 Windows Ctrl shortcuts.
- Verified `node --check tests/native/tauri-webdriver-smoke.mjs`, `pnpm exec prettier --check tests/native/tauri-webdriver-smoke.mjs`, `pnpm test:native:desktop`, `pnpm manual:validate docs/manual-verification-windows-ctrl-shortcuts-native-2026-07-07.md`, `pnpm manual:apply docs/manual-verification-windows-ctrl-shortcuts-native-2026-07-07.md`, and `pnpm manual:apply docs/manual-verification-windows-ctrl-shortcuts-native-2026-07-07.md --write` after the Windows Ctrl evidence update.
- Added native Tauri synthetic IME composition coverage to `tests/native/tauri-webdriver-smoke.mjs`: source mode composition update does not mutate the document, compositionend commits Chinese mixed text once, undo removes the commit, live mode list/inline-marker composition commits once, and source/live/preview switching preserves the committed text.
- Reduced the Windows manual verification entrypoint to the current remaining Windows item only: `scripts/open-manual-verification-windows.ps1` now generates an IME-only Chinese report draft, and [manual-verification-windows-runbook-2026-07-06.md](./manual-verification-windows-runbook-2026-07-06.md) now only asks the user to verify Windows Chinese IME.
- Verified `pnpm test:native:desktop`, `pnpm manual:windows -- -PrepareOnly -Stamp codex-ime-only-smoke`, and `pnpm manual:validate docs/manual-verification-windows-codex-ime-only-smoke.md --allow-pending`; the generated smoke report and temp fixture were cleaned afterward.
- Trimmed `scripts/open-manual-verification-cross-platform.mjs` so macOS reports contain only macOS IME/Cmd shortcuts/file watcher, Linux reports contain only Linux IME, and unused conflict fixtures are no longer created.
- Updated [manual-verification-cross-platform-runbook-2026-07-06.md](./manual-verification-cross-platform-runbook-2026-07-06.md) to match the trimmed macOS/Linux report generator.
- Verified `node --check scripts/open-manual-verification-cross-platform.mjs`, generated macOS/Linux pending smoke drafts with `pnpm manual:cross-platform -- --platform <platform> --prepare-only --stamp codex-cross-trim-smoke`, and validated both drafts with `pnpm manual:validate ... --allow-pending`; generated smoke reports and fixtures were cleaned afterward.
- Hardened `scripts/validate-manual-verification-report.mjs` so platform-specific pass rows must match the summary platform, evidence-section platform, and OS name/version; this prevents a Windows-generated report from closing macOS/Linux checklist items while still allowing pending cross-platform drafts to pass `--allow-pending` structure checks.
- Verified the stricter validator against existing Windows pass reports, deliberate Linux/macOS platform-mismatch pass reports that are now rejected, and fresh Windows/macOS/Linux pending draft reports that still pass with `--allow-pending`; all temporary reports and fixtures were cleaned afterward.
- Removed the stale all-items pending draft `docs/manual-verification-windows-20260706-140048.md` and reduced [manual-verification-report-template.md](./manual-verification-report-template.md) to the current remaining M16 items only, so future copied reports no longer ask for already-completed Save As/Ctrl/watcher/conflict evidence.
- Added [windows-ime-automation-probe-2026-07-07.md](./windows-ime-automation-probe-2026-07-07.md), recording that the current Windows environment has Chinese input configured but WebDriver key actions insert raw pinyin and WScript SendKeys does not reliably reach the Tauri WebView; those probes did not close Windows Chinese IME, which was later closed by the real desktop-control pass report.
- Added [manual-verification-windows-ime-computer-use-2026-07-07.md](./manual-verification-windows-ime-computer-use-2026-07-07.md), recording real Windows desktop-control input into the Tauri app with the Chinese IME candidate UI, source/live composition behavior, undo, list/inline-marker cases, and mode-switch retention. Validated and applied it with `pnpm manual:validate docs/manual-verification-windows-ime-computer-use-2026-07-07.md`, `pnpm manual:apply docs/manual-verification-windows-ime-computer-use-2026-07-07.md`, and `pnpm manual:apply docs/manual-verification-windows-ime-computer-use-2026-07-07.md --write` to close M16 Windows Chinese IME.
- Trimmed [manual-verification-report-template.md](./manual-verification-report-template.md) again after closing Windows Chinese IME, so new user-facing reports only list macOS Chinese IME, Linux IME, macOS Cmd shortcuts, and macOS file watcher.
- Tightened the cross-platform manual verification entrypoint: `scripts/open-manual-verification-cross-platform.mjs` now prints the exact launch, validate, dry-run apply, and write commands after generating a report, and generated reports include the same Chinese next-step section. Updated [manual-verification-cross-platform-runbook-2026-07-06.md](./manual-verification-cross-platform-runbook-2026-07-06.md) to state that Windows items are already closed.
