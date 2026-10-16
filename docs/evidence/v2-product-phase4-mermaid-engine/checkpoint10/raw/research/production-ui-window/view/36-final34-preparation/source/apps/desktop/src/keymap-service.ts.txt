import {
  PluginKeymapError,
  copyKeymapInput,
  type PluginKeymapHost,
  type PluginKeymapSnapshot,
} from '@milkup/plugin'

export const desktopKeymapDefaults: Readonly<Record<string, readonly string[]>> = Object.freeze({
  'file.new': ['Mod+N'],
  'file.open': ['Mod+O'],
  'file.reloadExternal': ['Mod+R'],
  'file.save': ['Mod+S'],
  'file.saveAs': ['Mod+Shift+S'],
  'file.close': ['Mod+W'],
  'view.source': ['Mod+1'],
  'view.live': ['Mod+2'],
  'view.toggle': ['Mod+/'],
  'document.selectAll': ['Mod+A'],
  'core.undo': ['Mod+Z'],
  'core.redo': ['Mod+Y', 'Mod+Shift+Z'],
  'search.find': ['Mod+F'],
  'search.replace': ['Mod+H'],
  'search.next': ['F3'],
  'search.previous': ['Shift+F3'],
  'appearance.zoomIn': ['Mod+=', 'Mod+Shift+='],
  'appearance.zoomOut': ['Mod+-'],
  'appearance.zoomReset': ['Mod+0'],
})
export interface KeymapCommandDefinition {
  readonly id: string
  readonly title: string
  readonly category: string
  readonly defaultKeys?: readonly string[]
  readonly defaultBindings?: readonly { readonly key: string; readonly when?: string }[]
  readonly available: boolean
  readonly bindable: boolean
  readonly input?: string
}
export interface KeymapContext {
  readonly platform: 'macos' | 'windows' | 'linux'
  readonly editorFocus: boolean
  readonly documentOpen: boolean
  readonly sourceMode: boolean
  readonly liveMode: boolean
  readonly inputFocus?: boolean
  readonly searchFocus?: boolean
}
export const fixedShortcuts: PluginKeymapSnapshot['fixedShortcuts'] = Object.freeze([
  {
    keys: 'F6 / Shift+F6',
    title: '切换操作区域',
    description: '在编辑器、表格操作、状态栏和菜单之间循环。',
  },
  {
    keys: 'Tab / Shift+Tab',
    title: '焦点、缩进或表格移动',
    description: '界面中移动焦点；正文中缩进或反缩进；表格内切换单元格。',
  },
  {
    keys: 'Escape',
    title: '关闭或退出',
    description: '关闭菜单、搜索、窄窗侧栏和确认框；编辑器表格内退出表格；中止进行中的替换。',
  },
  {
    keys: 'Mod+C / Mod+X / Mod+V',
    title: '复制、剪切、粘贴',
    description: '使用系统剪贴板；原生输入框内保留系统文本行为。',
  },
  {
    keys: 'Mod+A / Mod+Z / Mod+Y / Mod+Shift+Z',
    title: '输入框全选与历史',
    description:
      '搜索及插件输入框内由原生控件处理，不执行文档命令。搜索框仍支持文件、视图和查找等全局命令。',
  },
  {
    keys: '方向键 / Shift+方向键',
    title: '移动光标与选择',
    description:
      '文本编辑器中移动光标或扩展选区；按钮与选择框保持原生行为。侧栏分隔条获焦后，左右键每次调整宽度 16px。',
  },
  {
    keys: 'Home / End / Mod+Home / Mod+End',
    title: '行或文档边界',
    description: '移动到行首、行尾、文档首尾；配合 Shift 扩展选区。',
  },
  {
    keys: 'PageUp / PageDown',
    title: '源码翻页',
    description: '源码视图按可视页移动，Shift 扩展选区。',
  },
  {
    keys: 'Enter / Shift+Enter',
    title: '换行与表格',
    description:
      '正文换行、列表延续；表格中向下移动，Shift+Enter 插入单元格换行。搜索框 Enter/Shift+Enter 查找下一项/上一项；替换输入框 Enter 执行一次替换。',
  },
  {
    keys: 'Backspace / Delete',
    title: '删除',
    description: '按字符边界删除；表格保护结构分隔符。',
  },
  {
    keys: 'Space / Enter',
    title: '激活控件',
    description: '按钮、任务复选框等遵循控件原生键盘行为。',
  },
  {
    keys: 'IME / Alt / AltGraph',
    title: '输入法与系统组合键',
    description: '组合输入期间及 Alt/AltGraph 组合不触发可配置应用快捷键。',
  },
])
const STORAGE_KEY = 'milkup.desktop.keymap.v1'
const protectedKeys: Readonly<Record<string, string>> = {
  'Mod+A': 'document.selectAll',
  'Mod+Z': 'core.undo',
  'Mod+Y': 'core.redo',
  'Mod+Shift+Z': 'core.redo',
}
/** Portable single chords only. Navigation, clipboard, AltGr and unmodified text are reserved. */
export function normalizeKeymapKey(value: string): string {
  if (typeof value !== 'string' || value.length > 64 || value.trim() !== value || /\s/.test(value))
    throw new PluginKeymapError('invalid-input')
  const parts = value.replace(/^Control\+|^Ctrl\+|^Meta\+|^Cmd\+/i, 'Mod+').split('+')
  const last = parts.pop()?.toUpperCase()
  const modifiers = parts.map((part) => part.toLowerCase())
  if (
    !last ||
    new Set(modifiers).size !== modifiers.length ||
    modifiers.some((part) => !['mod', 'shift'].includes(part))
  )
    throw new PluginKeymapError('invalid-input')
  const mod = modifiers.includes('mod'),
    shift = modifiers.includes('shift')
  if (
    [
      'TAB',
      'ESCAPE',
      'ESC',
      'ENTER',
      'SPACE',
      'BACKSPACE',
      'DELETE',
      'HOME',
      'END',
      'PAGEUP',
      'PAGEDOWN',
      'F6',
    ].includes(last) ||
    last.startsWith('ARROW') ||
    (mod && ['C', 'X', 'V'].includes(last))
  )
    throw new PluginKeymapError('reserved')
  if (!(/^[A-Z0-9/=,.;'\[\]\\-]$/.test(last) && mod) && !/^F(?:[1-9]|1[0-2])$/.test(last))
    throw new PluginKeymapError('invalid-input')
  return `${mod ? 'Mod+' : ''}${shift ? 'Shift+' : ''}${last}`
}
function whenMatches(expression: string | undefined, context: KeymapContext): boolean {
  if (!expression) return true
  return expression.split('||').some((alternative) =>
    alternative.split('&&').every((raw) => {
      const term = raw.trim(),
        negated = term.startsWith('!'),
        name = negated ? term.slice(1) : term
      if (!['editorFocus', 'documentOpen', 'sourceMode', 'liveMode'].includes(name)) return false
      return negated
        ? !context[name as keyof KeymapContext]
        : !!context[name as keyof KeymapContext]
    }),
  )
}
export function createKeymapService(options: {
  readonly storage?: Pick<Storage, 'getItem' | 'setItem'>
  readonly commands: () => readonly KeymapCommandDefinition[]
}): PluginKeymapHost & {
  match(
    event: Pick<
      KeyboardEvent,
      'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey' | 'isComposing' | 'keyCode'
    > & { getModifierState?: (key: string) => boolean },
    context: KeymapContext,
  ): { readonly id: string } | undefined
} {
  let revision = 0,
    fingerprint = ''
  let overrides: Record<string, readonly string[]> = Object.create(null)
  let error: string | undefined
  try {
    const raw = options.storage?.getItem(STORAGE_KEY)
    if (raw) {
      const saved = JSON.parse(raw)
      if (saved?.version !== 1) throw new Error('version')
      const input = copyKeymapInput({ revision: saved.revision, bindings: saved.bindings })
      revision = input.revision
      for (const binding of input.bindings)
        overrides[binding.command] = binding.keys.map((key) => normalizeKeymapKey(key))
    }
  } catch {
    overrides = Object.create(null)
    error = '保存的快捷键无法读取，已使用默认快捷键。可恢复默认设置后重试。'
  }
  function catalog() {
    const items = options.commands().map((command) => {
      const keys =
        command.defaultKeys ??
        command.defaultBindings?.map((binding) => binding.key) ??
        desktopKeymapDefaults[command.id] ??
        []
      const defaults: string[] = []
      for (const key of keys) {
        try {
          const normalized = normalizeKeymapKey(key)
          if (!defaults.includes(normalized) && defaults.length < 8) defaults.push(normalized)
        } catch {
          /* Host/context-reserved plugin bindings remain help-only. */
        }
      }
      return { ...command, defaultKeys: defaults }
    })
    const next = JSON.stringify(items)
    if (fingerprint && next !== fingerprint) revision++
    fingerprint = next
    return items
  }
  function effective(
    command: KeymapCommandDefinition & { defaultKeys: readonly string[] },
    draft = overrides,
  ) {
    return (Object.hasOwn(draft, command.id) ? draft[command.id]! : command.defaultKeys).filter(
      (key) => !protectedKeys[key] || protectedKeys[key] === command.id,
    )
  }
  function snapshotNow(): PluginKeymapSnapshot {
    return {
      revision: (catalog(), revision),
      commands: catalog().map((command) => ({
        id: command.id,
        title: command.title,
        category: command.category,
        defaultKeys: [...command.defaultKeys],
        keys: [...effective(command)],
        available: command.available,
        bindable: command.bindable,
        ...(command.input ? { input: command.input } : {}),
      })),
      fixedShortcuts,
      ...(error ? { error } : {}),
    }
  }
  function check(signal?: AbortSignal) {
    if (signal?.aborted) throw new PluginKeymapError('aborted')
  }
  function persist(draft: Record<string, readonly string[]>, signal?: AbortSignal) {
    check(signal)
    try {
      if (!options.storage) throw new Error('unavailable')
      options.storage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          version: 1,
          revision: revision + 1,
          bindings: Object.entries(draft).map(([command, keys]) => ({ command, keys })),
        }),
      )
    } catch {
      throw new PluginKeymapError('persist-failed')
    }
    overrides = draft
    revision++
    error = undefined
    return snapshotNow()
  }
  return {
    async snapshot(operation) {
      check(operation?.signal)
      return snapshotNow()
    },
    async update(input, operation) {
      check(operation?.signal)
      const copied = copyKeymapInput(input),
        commands = catalog()
      if (copied.revision !== revision) throw new PluginKeymapError('stale')
      const draft = { ...overrides }
      for (const binding of copied.bindings) {
        const command = commands.find((item) => item.id === binding.command)
        if (!command?.available || !command.bindable) throw new PluginKeymapError('invalid-input')
        const keys = binding.keys.map(normalizeKeymapKey)
        if (new Set(keys).size !== keys.length) throw new PluginKeymapError('invalid-input')
        if (keys.some((key) => protectedKeys[key] && protectedKeys[key] !== command.id))
          throw new PluginKeymapError('reserved')
        draft[binding.command] = keys
      }
      const used = new Map<string, string>()
      for (const command of commands.filter((item) => item.available && item.bindable)) {
        for (const key of effective(command, draft)) {
          if (used.has(key) && used.get(key) !== command.id) throw new PluginKeymapError('conflict')
          used.set(key, command.id)
        }
      }
      return persist(draft, operation?.signal)
    },
    async reset(input, operation) {
      check(operation?.signal)
      const copied = copyKeymapInput(input, true)
      catalog()
      if (copied.revision !== revision) throw new PluginKeymapError('stale')
      return persist(Object.create(null), operation?.signal)
    },
    match(event, context) {
      if (
        event.isComposing ||
        event.keyCode === 229 ||
        event.key === 'Process' ||
        event.altKey ||
        event.getModifierState?.('AltGraph') ||
        (context.inputFocus && !context.searchFocus) ||
        (event.ctrlKey && event.metaKey)
      )
        return undefined
      const mod = context.platform === 'macos' ? event.metaKey : event.ctrlKey
      if (context.platform === 'macos' ? event.ctrlKey : event.metaKey) return undefined
      const shifted: Readonly<Record<string, string>> = {
        '+': '=',
        _: '-',
        '?': '/',
        ':': ';',
        '<': ',',
        '>': '.',
        '{': '[',
        '}': ']',
        '|': '\\',
        '"': "'",
        '!': '1',
        '@': '2',
        '#': '3',
        $: '4',
        '%': '5',
        '^': '6',
        '&': '7',
        '*': '8',
        '(': '9',
        ')': '0',
      }
      let key = event.shiftKey ? (shifted[event.key] ?? event.key) : event.key
      try {
        key = normalizeKeymapKey(`${mod ? 'Mod+' : ''}${event.shiftKey ? 'Shift+' : ''}${key}`)
      } catch {
        return undefined
      }
      for (const command of catalog()) {
        if (
          context.inputFocus &&
          !['file.', 'view.', 'search.', 'appearance.'].some((prefix) =>
            command.id.startsWith(prefix),
          )
        )
          continue
        if (!command.available || !command.bindable || !effective(command).includes(key)) continue
        const bindings = command.defaultBindings
        if (bindings?.length) {
          const original = bindings.filter((binding) => {
            try {
              return normalizeKeymapKey(binding.key) === key
            } catch {
              return false
            }
          })
          if (
            !(original.length ? original : bindings).some((binding) =>
              whenMatches(binding.when, context),
            )
          )
            continue
        }
        return { id: command.id }
      }
      return undefined
    },
  }
}
