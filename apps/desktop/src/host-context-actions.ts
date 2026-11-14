import { ChangeSet } from '@milkup/core'
import {
  PluginEditingError,
  type PluginEditingApplyRequest,
  type PluginEditingBrokerAdapter,
  type PluginEditingErrorCode,
  type PluginEditingOperationOptions,
  type PluginEditingSnapshot,
} from '@milkup/plugin'
import {
  ClipboardPaste,
  Code2,
  Copy,
  Heading,
  Heading1,
  Heading2,
  Heading3,
  Heading4,
  Heading5,
  Heading6,
  Image,
  Link,
  List,
  ListOrdered,
  ListTodo,
  Minus,
  Plus,
  Quote,
  Redo2,
  Scissors,
  Table2,
  TextSelect,
  Undo2,
  type IconNode,
} from 'lucide'
import type { DesktopEditingCurrent } from './editing-service'
import type { HostContextMenuItem } from './editor-context-menu'

export interface HostContextSnapshot extends DesktopEditingCurrent {
  readonly canUndo: boolean
  readonly canRedo: boolean
}

export interface HostContextActionsOptions {
  /** The private host owner from the desktop editing service. Readonly capture
   * is permitted for copy; writes retain the service's bounded CAS/history. */
  readonly editing: PluginEditingBrokerAdapter
  captureSnapshot(): HostContextSnapshot | undefined
  isCurrent(snapshot: HostContextSnapshot): boolean
  readonly clipboard: {
    readText(): Promise<string>
    writeText(text: string): Promise<void>
    /** Optional ClipboardItem writer: starts the platform write synchronously
     * in the invocation gesture, while the bounded source read is pending. */
    writeTextDeferred?(text: Promise<string>): Promise<void>
  }
  /** Must use the active source-view queue and revalidate before committing.
   * Whole-document selection must not materialize a windowed document. */
  selectAll(snapshot: HostContextSnapshot, signal: AbortSignal): Promise<void>
  /** Must await the actual memory/native history commit, revalidating the
   * snapshot inside the same edit queue immediately before the commit. */
  history(
    direction: 'undo' | 'redo',
    snapshot: HostContextSnapshot,
    signal: AbortSignal,
  ): Promise<void>
}

type ActionErrorCode = PluginEditingErrorCode | 'clipboard-read' | 'clipboard-write'
const MAX_TEXT = 65_536
const errorMessages: Record<ActionErrorCode, string> = {
  aborted: '操作已取消，未提交新的文档更改。',
  revoked: '编辑操作已失效，请重新打开菜单。',
  'invalid-input': '当前选区不支持此操作；不能拆分 emoji、组合字符或 CRLF 换行。',
  'invalid-snapshot': '编辑快照已失效，请重新打开菜单。',
  stale: '文档、选区或保存位置已改变，请重新打开菜单后操作。',
  readonly: '当前文档为只读，可以复制或全选。',
  busy: '另一项编辑操作正在进行，请稍后重试。',
  'too-large':
    '操作超出有界编辑范围（读取总计最多 65,536 个 UTF-16 单元、选区最多 256 行）；请缩小选区。超长行也可能超出限制，全选不代表可以复制整份大文件。',
  unsupported: '当前选区或命令不支持此操作。',
  unavailable: '编辑操作不可用，请重试。',
  'clipboard-read': '读取系统剪贴板失败，请检查剪贴板权限，或使用系统粘贴快捷键。',
  'clipboard-write':
    '写入系统剪贴板失败，请检查剪贴板权限，或使用系统复制快捷键；未删除选中的文字。',
}

export class HostContextActionError extends Error {
  constructor(
    readonly code: ActionErrorCode,
    options?: ErrorOptions,
  ) {
    super(errorMessages[code], options)
    this.name = 'HostContextActionError'
  }
}

/** Host-owned constants only. Plugin strings and arbitrary SVG never enter this model. */
const insertDefinitions: readonly [string, string, IconNode][] = [
  ['bullet-list', '无序列表', List],
  ['ordered-list', '有序列表', ListOrdered],
  ['task-list', '任务列表', ListTodo],
  ['quote', '引用', Quote],
  ['code-block', '代码块', Code2],
  ['link', '链接', Link],
  ['image', '图片链接', Image],
  ['table', '表格', Table2],
  ['horizontal-rule', '分隔线', Minus],
]
const headingIcons = [Heading1, Heading2, Heading3, Heading4, Heading5, Heading6] as const
const commandIds = new Set([
  'host.copy',
  'host.cut',
  'host.paste',
  'host.select-all',
  'host.undo',
  'host.redo',
  ...headingIcons.map((_, index) => `host.insert.heading-${index + 1}`),
  ...insertDefinitions.map(([id]) => `host.insert.${id}`),
])

export function createHostContextActions(options: HostContextActionsOptions) {
  const lifetime = new AbortController()
  let running = false

  function items(snapshot = options.captureSnapshot()): readonly HostContextMenuItem[] {
    const blocked = !snapshot || snapshot.busy || running || lifetime.signal.aborted
    const writeBlocked = blocked || snapshot!.readonly
    const selectionEmpty = !snapshot || snapshot.selection.empty
    const singleSelection = snapshot?.selection.ranges.length === 1
    const insertBlocked = writeBlocked || !singleSelection
    const insertions: HostContextMenuItem[] = [
      {
        id: 'host.insert.heading',
        label: '标题',
        icon: Heading,
        disabled: insertBlocked,
        children: headingIcons.map((icon, index) => ({
          id: `host.insert.heading-${index + 1}`,
          label: `${index + 1} 级标题`,
          icon,
          disabled: insertBlocked,
        })),
      },
      ...insertDefinitions.map(([id, label, icon]) => ({
        id: `host.insert.${id}`,
        label,
        icon,
        disabled: insertBlocked,
        ...(id === 'quote' || id === 'link' || id === 'table' ? { separatorBefore: true } : {}),
      })),
    ]
    return [
      {
        id: 'host.copy',
        label: '复制',
        icon: Copy,
        shortcut: 'Ctrl+C',
        disabled: blocked || selectionEmpty || !singleSelection,
      },
      {
        id: 'host.cut',
        label: '剪切',
        icon: Scissors,
        shortcut: 'Ctrl+X',
        disabled: writeBlocked || selectionEmpty || !singleSelection,
      },
      {
        id: 'host.paste',
        label: '粘贴',
        icon: ClipboardPaste,
        shortcut: 'Ctrl+V',
        disabled: writeBlocked || !singleSelection,
      },
      {
        id: 'host.select-all',
        label: '全选',
        icon: TextSelect,
        shortcut: 'Ctrl+A',
        disabled: blocked,
      },
      {
        id: 'host.undo',
        label: '撤销',
        icon: Undo2,
        shortcut: 'Ctrl+Z',
        disabled: writeBlocked || !snapshot?.canUndo,
        separatorBefore: true,
      },
      {
        id: 'host.redo',
        label: '重做',
        icon: Redo2,
        shortcut: 'Ctrl+Shift+Z',
        disabled: writeBlocked || !snapshot?.canRedo,
      },
      {
        id: 'host.insert',
        label: '插入',
        icon: Plus,
        disabled: insertBlocked,
        children: insertions,
        separatorBefore: true,
      },
    ]
  }

  async function run(
    id: string,
    snapshot: HostContextSnapshot,
    _event?: Event,
    operationOptions?: PluginEditingOperationOptions,
  ): Promise<void> {
    if (!commandIds.has(id)) throw new HostContextActionError('unsupported')
    if (running) throw new HostContextActionError('busy')
    const controller = new AbortController()
    const abort = () => controller.abort()
    lifetime.signal.addEventListener('abort', abort, { once: true })
    operationOptions?.signal?.addEventListener('abort', abort, { once: true })
    if (lifetime.signal.aborted || operationOptions?.signal?.aborted) abort()
    const signal = controller.signal
    const write = id !== 'host.copy' && id !== 'host.select-all'
    const guard = () => {
      if (signal.aborted) throw new HostContextActionError('aborted')
      if (!options.isCurrent(snapshot)) throw new HostContextActionError('stale')
      const current = options.captureSnapshot()
      if (!current) throw new HostContextActionError('unavailable')
      if (write && (snapshot.readonly || current.readonly))
        throw new HostContextActionError('readonly')
      if (current.busy) throw new HostContextActionError('busy')
    }
    let lease: PluginEditingSnapshot | undefined
    running = true
    try {
      guard()
      if (id === 'host.select-all') {
        await options.selectAll(snapshot, signal)
        return
      }
      if (id === 'host.undo' || id === 'host.redo') {
        if (id === 'host.undo' ? !snapshot.canUndo : !snapshot.canRedo)
          throw new HostContextActionError('unavailable')
        await options.history(id === 'host.undo' ? 'undo' : 'redo', snapshot, signal)
        return
      }
      if (snapshot.selection.ranges.length !== 1) throw new HostContextActionError('unsupported')
      const selection = snapshot.selection.main
      if ((id === 'host.copy' || id === 'host.cut') && selection.empty)
        throw new HostContextActionError('invalid-input')

      let pasted: string | undefined
      if (id === 'host.paste') {
        // Start the browser read before the first await, while the trusted menu
        // event still owns transient user activation. Never use execCommand.
        try {
          pasted = await abortable(options.clipboard.readText(), signal)
        } catch (error) {
          if (signal.aborted) throw new HostContextActionError('aborted')
          throw new HostContextActionError('clipboard-read', { cause: error })
        }
        guard()
        if (typeof pasted !== 'string') throw new HostContextActionError('invalid-input')
        if (!pasted) return
        if (pasted.length > MAX_TEXT) throw new HostContextActionError('too-large')
      }

      const insertion = id.startsWith('host.insert.') ? id.slice('host.insert.'.length) : undefined
      const extent =
        insertion && insertion !== 'link' && insertion !== 'image' ? 'lines' : 'selection'
      const captured = options.editing.capture({ extent }, { signal })
      let clipboardWrite: Promise<void> | undefined
      if ((id === 'host.copy' || id === 'host.cut') && options.clipboard.writeTextDeferred) {
        const text = captured.then((snapshot) => {
          guard()
          return snapshot.text
        })
        // Some implementations reject immediately or never consume the item.
        // Keep both rejections observed while preserving the original failures.
        void text.catch(() => undefined)
        try {
          clipboardWrite = options.clipboard.writeTextDeferred(text)
        } catch (error) {
          clipboardWrite = Promise.reject(error)
        }
        void clipboardWrite.catch(() => undefined)
      }
      lease = await captured
      guard()
      if (id === 'host.copy' || id === 'host.cut') {
        try {
          // Source reads can outlive user activation on some platforms. A
          // denied system write is an explicit failure, never a pretend copy.
          await abortable(clipboardWrite ?? options.clipboard.writeText(lease.text), signal)
        } catch (error) {
          if (signal.aborted) throw new HostContextActionError('aborted')
          throw new HostContextActionError('clipboard-write', { cause: error })
        }
        if (id === 'host.copy') return
        guard()
        await options.editing.apply(replaceSelection(lease, ''), { signal })
      } else if (id === 'host.paste') {
        const text = pasted!.replace(/\r\n|\r|\n/g, lease.lineEnding === 'crlf' ? '\r\n' : '\n')
        if (text.length > MAX_TEXT) throw new HostContextActionError('too-large')
        guard()
        await options.editing.apply(replaceSelection(lease, text), { signal })
      } else if (insertion) {
        const request = insertionRequest(insertion, lease)
        guard()
        await options.editing.apply(request, { signal })
      }
      // Once apply resolves, the document/history committed. Do not turn an
      // accepted mutation into a cancellation if dismissal happened in paint.
    } catch (error) {
      if (error instanceof HostContextActionError) throw error
      throw new HostContextActionError(
        error instanceof PluginEditingError
          ? error.code
          : signal.aborted
            ? 'aborted'
            : 'unavailable',
        { cause: error },
      )
    } finally {
      if (lease) {
        // Release independently of caller cancellation. A disposed owner has
        // already revoked its leases, so cleanup failure cannot change outcome.
        try {
          await options.editing.release(lease.id)
        } catch {}
      }
      running = false
      lifetime.signal.removeEventListener('abort', abort)
      operationOptions?.signal?.removeEventListener('abort', abort)
    }
  }

  return Object.freeze({ items, run, dispose: () => lifetime.abort() })
}

function replaceSelection(
  snapshot: PluginEditingSnapshot,
  text: string,
): PluginEditingApplyRequest {
  const from = Math.min(snapshot.selection.anchor, snapshot.selection.head)
  const to = Math.max(snapshot.selection.anchor, snapshot.selection.head)
  return {
    snapshotId: snapshot.id,
    changes: [{ from, to, insert: text }],
    selection: { anchor: from + text.length, head: from + text.length },
  }
}

function insertionRequest(id: string, snapshot: PluginEditingSnapshot): PluginEditingApplyRequest {
  const heading = /^heading-([1-6])$/.exec(id)
  const prefix = heading
    ? `${'#'.repeat(Number(heading[1]))} `
    : id === 'bullet-list'
      ? '- '
      : id === 'ordered-list'
        ? '1. '
        : id === 'task-list'
          ? '- [ ] '
          : id === 'quote'
            ? '> '
            : undefined
  if (prefix !== undefined) {
    const pieces = snapshot.text.split(/(\r\n|\n|\r)/)
    const changes: { from: number; to: number; insert: string }[] = []
    let position = 0
    for (let index = 0; index < pieces.length; index += 2) {
      const line = pieces[index]!
      // A selection ending at the next line start includes the separator but
      // must not add a marker to that unselected line.
      if (!line && index === pieces.length - 1 && index > 0) break
      const previous = heading
        ? (/^ {0,3}#{1,6}(?:[ \t]+|$)/.exec(line)?.[0] ?? '')
        : id === 'quote'
          ? ''
          : (/^(?:[-+*]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]+)?/.exec(line)?.[0] ?? '')
      changes.push({ from: position, to: position + previous.length, insert: prefix })
      position += line.length + (pieces[index + 1]?.length ?? 0)
    }
    const local = ChangeSet.of(changes)
    let text = '',
      offset = 0
    for (const change of local.changes) {
      text += snapshot.text.slice(offset, change.from) + change.insert
      offset = change.to
    }
    text += snapshot.text.slice(offset)
    // Collapse the bounded line edit to one isolated transaction rather than
    // spending one service change slot per selected line.
    return {
      snapshotId: snapshot.id,
      changes: [{ from: 0, to: snapshot.text.length, insert: text }],
      selection: {
        anchor: local.mapPosition(snapshot.selection.anchor),
        head: local.mapPosition(snapshot.selection.head),
      },
    }
  }
  const from = Math.min(snapshot.selection.anchor, snapshot.selection.head)
  const to = Math.max(snapshot.selection.anchor, snapshot.selection.head)
  const selected = snapshot.text.slice(from, to)
  const eol = snapshot.lineEnding === 'crlf' ? '\r\n' : '\n'
  let text: string, anchor: number, head: number
  if (id === 'link' || id === 'image') {
    const image = id === 'image'
    const label = (selected || (image ? '图片说明' : '链接文字')).replace(/([\\\[\]])/g, '\\$1')
    const url = image ? 'https://example.com/image.png' : 'https://example.com'
    text = `${image ? '!' : ''}[${label}](${url})`
    anchor = text.indexOf('](') + 2
    head = anchor + url.length
  } else {
    if (id === 'code-block') {
      const content = selected || '代码'
      const fence = '`'.repeat(
        Math.max(3, ...Array.from(content.matchAll(/`+/g), (match) => match[0].length + 1)),
      )
      text = `${fence}${eol}${content}${content.endsWith(eol) ? '' : eol}${fence}`
      anchor = fence.length + eol.length
      head = anchor + content.length
    } else if (id === 'table') {
      const cell = (selected || '内容')
        .replace(/\\/g, '\\\\')
        .replace(/\|/g, '\\|')
        .replace(/\r\n|\r|\n/g, ' ')
      text = `| 列 1 | 列 2 |${eol}| --- | --- |${eol}| ${cell} | 内容 |`
      anchor = 2
      head = 5
    } else if (id === 'horizontal-rule') {
      text = '---'
      anchor = head = text.length
    } else throw new HostContextActionError('unsupported')
    const before = snapshot.text.slice(0, from),
      after = snapshot.text.slice(to)
    const prefix =
      before && !before.endsWith(eol + eol) ? (before.endsWith(eol) ? eol : eol + eol) : ''
    const suffix =
      after && !after.startsWith(eol + eol) ? (after.startsWith(eol) ? eol : eol + eol) : ''
    text = prefix + text + suffix
    anchor += prefix.length
    head += prefix.length
  }
  return {
    snapshotId: snapshot.id,
    changes: [{ from, to, insert: text }],
    selection: { anchor: from + anchor, head: from + head },
  }
}

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new HostContextActionError('aborted'))
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
    // Attach both callbacks even after cancellation to consume any late browser
    // rejection. A clipboard promise itself cannot be cancelled by AbortSignal.
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
  })
}
