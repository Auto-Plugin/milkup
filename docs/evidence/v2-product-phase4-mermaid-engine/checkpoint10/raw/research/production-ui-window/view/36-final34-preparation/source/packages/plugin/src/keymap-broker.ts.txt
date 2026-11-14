import type { PluginManifest } from './manifest'

export interface PluginKeymapCommand {
  readonly id: string
  readonly title: string
  readonly category: string
  readonly defaultKeys: readonly string[]
  readonly keys: readonly string[]
  readonly available: boolean
  readonly bindable: boolean
  readonly input?: string
}
export interface PluginKeymapSnapshot {
  readonly revision: number
  readonly commands: readonly PluginKeymapCommand[]
  readonly fixedShortcuts: readonly {
    readonly keys: string
    readonly title: string
    readonly description: string
  }[]
  readonly error?: string
}
export interface PluginKeymapUpdate {
  readonly revision: number
  readonly bindings: readonly { readonly command: string; readonly keys: readonly string[] }[]
}
export interface PluginKeymapOperationOptions {
  readonly signal?: AbortSignal
}
export interface PluginKeymapHost {
  snapshot(options?: PluginKeymapOperationOptions): Promise<PluginKeymapSnapshot>
  update(
    input: PluginKeymapUpdate,
    options?: PluginKeymapOperationOptions,
  ): Promise<PluginKeymapSnapshot>
  reset(
    input: { readonly revision: number },
    options?: PluginKeymapOperationOptions,
  ): Promise<PluginKeymapSnapshot>
}
export interface PluginKeymapBroker extends PluginKeymapHost {}
export const PLUGIN_KEYMAP_ERROR_CODES = [
  'revoked',
  'invalid-input',
  'stale',
  'conflict',
  'reserved',
  'persist-failed',
  'aborted',
  'busy',
  'unavailable',
] as const
export type PluginKeymapErrorCode = (typeof PLUGIN_KEYMAP_ERROR_CODES)[number]
const messages: Record<PluginKeymapErrorCode, string> = {
  revoked: '快捷键权限已撤销。',
  'invalid-input': '快捷键或命令不合法。',
  stale: '快捷键列表已改变，请重新加载后再保存。',
  conflict: '快捷键已被其他命令占用，请先清空或修改冲突命令。',
  reserved: '该按键由系统、文本编辑或焦点导航保留。',
  'persist-failed': '快捷键未能保存，原设置保持不变。',
  aborted: '快捷键操作已取消。',
  busy: '快捷键操作繁忙，请稍后重试。',
  unavailable: '快捷键服务暂不可用。',
}
export class PluginKeymapError extends Error {
  readonly code: PluginKeymapErrorCode
  constructor(code: PluginKeymapErrorCode) {
    super(messages[code])
    this.name = 'PluginKeymapError'
    this.code = code
  }
}
export function keymapRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
export function keymapKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  return (
    required.every((key) => Object.hasOwn(value, key)) &&
    Object.keys(value).every((key) => required.includes(key) || optional.includes(key))
  )
}
function text(value: unknown, max = 512): value is string {
  return typeof value === 'string' && value.length <= max
}
function keyList(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.length <= 8 && value.every((key) => text(key, 64))
}
export function copyKeymapInput(value: unknown, reset = false): PluginKeymapUpdate {
  if (
    !keymapRecord(value) ||
    !keymapKeys(value, reset ? ['revision'] : ['revision', 'bindings']) ||
    !Number.isSafeInteger(value.revision) ||
    (value.revision as number) < 0
  )
    throw new PluginKeymapError('invalid-input')
  const bindings = reset ? [] : value.bindings
  if (!Array.isArray(bindings) || bindings.length > 2048)
    throw new PluginKeymapError('invalid-input')
  const commands = new Set<string>()
  return {
    revision: value.revision as number,
    bindings: bindings.map((binding) => {
      if (
        !keymapRecord(binding) ||
        !keymapKeys(binding, ['command', 'keys']) ||
        !text(binding.command, 256) ||
        !binding.command ||
        commands.has(binding.command) ||
        !keyList(binding.keys)
      )
        throw new PluginKeymapError('invalid-input')
      commands.add(binding.command)
      return { command: binding.command, keys: [...binding.keys] }
    }),
  }
}
export function copyKeymapSnapshot(value: unknown): PluginKeymapSnapshot {
  if (
    !keymapRecord(value) ||
    !keymapKeys(value, ['revision', 'commands', 'fixedShortcuts'], ['error']) ||
    !Number.isSafeInteger(value.revision) ||
    (value.revision as number) < 0 ||
    !Array.isArray(value.commands) ||
    value.commands.length > 2048 ||
    !Array.isArray(value.fixedShortcuts) ||
    value.fixedShortcuts.length > 64 ||
    ('error' in value && !text(value.error))
  )
    throw new PluginKeymapError('unavailable')
  const ids = new Set<string>()
  return {
    revision: value.revision as number,
    commands: value.commands.map((command) => {
      if (
        !keymapRecord(command) ||
        !keymapKeys(
          command,
          ['id', 'title', 'category', 'defaultKeys', 'keys', 'available', 'bindable'],
          ['input'],
        ) ||
        !text(command.id, 256) ||
        !command.id ||
        ids.has(command.id) ||
        !text(command.title) ||
        !text(command.category) ||
        !keyList(command.defaultKeys) ||
        !keyList(command.keys) ||
        typeof command.available !== 'boolean' ||
        typeof command.bindable !== 'boolean' ||
        ('input' in command && !text(command.input))
      )
        throw new PluginKeymapError('unavailable')
      ids.add(command.id)
      return {
        id: command.id,
        title: command.title,
        category: command.category,
        defaultKeys: [...command.defaultKeys],
        keys: [...command.keys],
        available: command.available,
        bindable: command.bindable,
        ...(typeof command.input === 'string' ? { input: command.input } : {}),
      }
    }),
    fixedShortcuts: value.fixedShortcuts.map((item) => {
      if (
        !keymapRecord(item) ||
        !keymapKeys(item, ['keys', 'title', 'description']) ||
        !text(item.keys) ||
        !text(item.title) ||
        !text(item.description)
      )
        throw new PluginKeymapError('unavailable')
      return { keys: item.keys, title: item.title, description: item.description }
    }),
    ...(typeof value.error === 'string' ? { error: value.error } : {}),
  }
}
export function createPluginKeymapBroker(config: {
  readonly manifest: PluginManifest
  readonly adapter: PluginKeymapHost
  readonly isActive?: () => boolean
}): PluginKeymapBroker & { dispose(): void } {
  let disposed = false
  const controllers = new Set<AbortController>()
  const dispose = () => {
    disposed = true
    for (const controller of controllers) controller.abort()
    controllers.clear()
  }
  const active = () => {
    if (
      disposed ||
      config.isActive?.() === false ||
      !config.manifest.permissions?.includes('app:keymap')
    ) {
      dispose()
      throw new PluginKeymapError('revoked')
    }
  }
  const run = async (
    operation: (options: PluginKeymapOperationOptions) => Promise<PluginKeymapSnapshot>,
    options?: PluginKeymapOperationOptions,
  ) => {
    active()
    const signal = options?.signal
    if (
      options !== undefined &&
      (!keymapRecord(options) ||
        !keymapKeys(options, [], ['signal']) ||
        (options.signal !== undefined && !(options.signal instanceof AbortSignal)))
    )
      throw new PluginKeymapError('invalid-input')
    if (signal?.aborted) throw new PluginKeymapError('aborted')
    if (controllers.size >= 16) throw new PluginKeymapError('busy')
    const controller = new AbortController()
    controllers.add(controller)
    const abort = () => controller.abort()
    signal?.addEventListener('abort', abort, { once: true })
    let abortReject: (() => void) | undefined
    try {
      const result = await Promise.race([
        Promise.resolve().then(() => {
          active()
          if (controller.signal.aborted) throw new PluginKeymapError('aborted')
          return operation({ signal: controller.signal })
        }),
        new Promise<never>((_, reject) => {
          abortReject = () => reject(new PluginKeymapError(disposed ? 'revoked' : 'aborted'))
          controller.signal.addEventListener('abort', abortReject, { once: true })
        }),
      ])
      active()
      if (controller.signal.aborted) throw new PluginKeymapError('aborted')
      return copyKeymapSnapshot(result)
    } catch (error) {
      throw error instanceof PluginKeymapError ? error : new PluginKeymapError('unavailable')
    } finally {
      if (abortReject) controller.signal.removeEventListener('abort', abortReject)
      controllers.delete(controller)
      signal?.removeEventListener('abort', abort)
    }
  }
  return Object.freeze<PluginKeymapBroker & { dispose(): void }>({
    snapshot: (options) => run((o) => config.adapter.snapshot(o), options),
    update: async (input, options) => {
      const copied = copyKeymapInput(input)
      return run((o) => config.adapter.update(copied, o), options)
    },
    reset: async (input, options) => {
      const copied = copyKeymapInput(input, true)
      return run((o) => config.adapter.reset({ revision: copied.revision }, o), options)
    },
    dispose,
  })
}
export function createPluginKeymapHostCapabilities(
  broker: PluginKeymapBroker,
  isActive: () => boolean = () => true,
): PluginKeymapHost {
  const check = async (operation: () => Promise<PluginKeymapSnapshot>) => {
    if (!isActive()) throw new PluginKeymapError('revoked')
    const result = await operation()
    if (!isActive()) throw new PluginKeymapError('revoked')
    return result
  }
  return Object.freeze<PluginKeymapHost>({
    snapshot: (options) => check(() => broker.snapshot(options)),
    update: (input, options) => check(() => broker.update(input, options)),
    reset: (input, options) => check(() => broker.reset(input, options)),
  })
}
