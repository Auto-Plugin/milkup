/** A deliberately bounded CSS theme language. No untrusted CSS reaches a live stylesheet.
 * Tokenize escapes/comments/strings first, validate structure and capabilities, then rebuild.
 * The browser remains responsible for property grammar (CSS.supports), never security policy.
 */
export const maximumThemeBytes = 128 * 1024
export class ThemeCssError extends Error {
  constructor(message: string) {
    super(`主题 CSS 未应用：${message}`)
    this.name = 'ThemeCssError'
  }
}
type Token = { kind: 'word' | 'string' | 'number' | 'space' | 'comment' | 'punct'; value: string }
type Mode = 'light' | 'dark' | undefined
export interface CompiledThemeCss {
  css: string
  ruleCount: number
}
const colors = new Set(
  `chrome-bg button-text neutral-hover menu-overlay loading-overlay modal-shade primary-bg primary-hover on-primary danger-border danger-soft quote-bg table-header-bg code-text code-bg inline-code-bg inline-code-text link search-outline scroll-thumb scroll-hover app-bg panel-bg panel-subtle border border-strong text text-muted text-soft accent accent-strong accent-soft warning danger selection`
    .split(' ')
    .map((v) => `--${v}`),
)
const rootVariables = new Set([...colors, '--shadow-soft'])
const properties = new Set(
  `color background background-color background-image font-family font-size font-weight font-style font-variant font-variant-ligatures letter-spacing word-spacing text-align text-decoration text-decoration-color text-decoration-line text-decoration-style text-decoration-thickness text-underline-offset text-indent text-shadow line-height border border-color border-style border-width border-top border-right border-bottom border-left border-top-color border-right-color border-bottom-color border-left-color border-top-width border-right-width border-bottom-width border-left-width border-radius border-top-left-radius border-top-right-radius border-bottom-left-radius border-bottom-right-radius padding padding-top padding-right padding-bottom padding-left padding-inline padding-inline-start padding-inline-end padding-block padding-block-start padding-block-end margin margin-top margin-right margin-bottom margin-left margin-inline margin-inline-start margin-inline-end margin-block margin-block-start margin-block-end box-shadow`.split(
    ' ',
  ),
)
for (const property of [...properties]) {
  if (
    /^(?:margin|padding)/.test(property) ||
    (property.startsWith('border') && !property.endsWith('color') && !property.endsWith('radius'))
  )
    properties.delete(property)
}
for (const property of [
  'outline',
  'outline-color',
  'outline-width',
  'outline-style',
  'outline-offset',
])
  properties.add(property)
const functions = new Set(
  `rgb rgba hsl hsla hwb lab lch oklab oklch color color-mix light-dark linear-gradient radial-gradient conic-gradient repeating-linear-gradient repeating-radial-gradient repeating-conic-gradient calc min max clamp var`.split(
    ' ',
  ),
)
const classes = new Set(
  `milkup-editor milkup-editor-content milkup-line milkup-line-live milkup-block-heading milkup-heading-level-1 milkup-heading-level-2 milkup-heading-level-3 milkup-heading-level-4 milkup-heading-level-5 milkup-heading-level-6 milkup-block-blockquote milkup-block-list milkup-list-marker milkup-list-content milkup-block-table milkup-table-cell milkup-block-code milkup-inline-strong milkup-inline-emphasis milkup-inline-inlineCode milkup-inline-link milkup-inline-autolink milkup-inline-marker milkup-inline-syntax milkup-block-marker milkup-code-token-keyword milkup-code-token-string milkup-code-token-number milkup-code-token-comment milkup-code-token-property`.split(
    ' ',
  ),
)
const tags = new Set(
  'p h1 h2 h3 h4 h5 h6 blockquote pre code strong em a table thead tbody tr th td ul ol li hr'.split(
    ' ',
  ),
)
const error = (message: string): never => {
  throw new ThemeCssError(message)
}
function escaped(source: string, at: number): { value: string; end: number } {
  const tail = source.slice(at + 1)
  if (!tail || /^[\n\r\f]/.test(tail)) return error('不完整的转义。')
  const hex = /^[0-9a-fA-F]{1,6}/.exec(tail)?.[0]
  if (hex) {
    const code = parseInt(hex, 16)
    if (!code || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff))
      return error('无效字符转义。')
    let end = at + 1 + hex.length
    if (/\s/.test(source[end] ?? 'x')) {
      if (source[end] === '\r' && source[end + 1] === '\n') end++
      end++
    }
    return { value: String.fromCodePoint(code), end }
  }
  return { value: tail[0]!, end: at + 2 }
}
function tokenize(source: string): Token[] {
  if (new TextEncoder().encode(source).length > maximumThemeBytes) error('文件超过 128 KiB。')
  if (/[\u0000-\u0008\u000b\u000e-\u001f\u007f]/.test(source)) error('包含无效控制字符。')
  const result: Token[] = []
  let i = source.charCodeAt(0) === 0xfeff ? 1 : 0
  const add = (kind: Token['kind'], value: string) => {
    result.push({ kind, value })
    if (result.length > 20000) error('内容过于复杂。')
  }
  while (i < source.length) {
    const c = source[i]!
    if (/\s/.test(c)) {
      while (/\s/.test(source[++i] ?? 'x')) {}
      add('space', ' ')
      continue
    }
    if (source.startsWith('/*', i)) {
      const end = source.indexOf('*/', i + 2)
      if (end < 0) error('注释未闭合。')
      i = end + 2
      add('comment', '/**/')
      continue
    }
    if (c === '"' || c === "'") {
      const quote = c
      let value = ''
      i++
      while (i < source.length && source[i] !== quote) {
        if (/[\n\r\f]/.test(source[i]!)) error('字符串未闭合。')
        if (source[i] === '\\') {
          const e = escaped(source, i)
          value += e.value
          i = e.end
        } else value += source[i++]
      }
      if (source[i++] !== quote) error('字符串未闭合。')
      add('string', value)
      continue
    }
    const number = /^[+-]?(?:\d*\.\d+|\d+)(?:[eE][+-]?\d+)?/.exec(source.slice(i))?.[0]
    if (number) {
      add('number', number)
      i += number.length
      continue
    }
    if (/[a-zA-Z_-]/.test(c) || c === '\\') {
      let value = ''
      while (i < source.length && (/[a-zA-Z0-9_-]/.test(source[i]!) || source[i] === '\\')) {
        if (source[i] === '\\') {
          const e = escaped(source, i)
          value += e.value
          i = e.end
        } else value += source[i++]
      }
      if (!/^[a-zA-Z_-][a-zA-Z0-9_-]*$/.test(value))
        error('标识符只能使用 ASCII 字母、数字、连字符和下划线。')
      add('word', value)
      continue
    }
    if (!'{}():;,.#%[]+>~*/=-!@'.includes(c)) error(`不支持的 CSS 标记 ${c}。`)
    add('punct', c)
    i++
  }
  return result
}
const compact = (tokens: readonly Token[]) =>
  tokens.filter((t) => t.kind !== 'space' && t.kind !== 'comment')
const serialize = (tokens: readonly Token[]) =>
  tokens
    .map((t) => (t.kind === 'string' ? JSON.stringify(t.value).replace(/</g, '\\3c ') : t.value))
    .join('')
    .trim()
function declarations(
  tokens: Token[],
  root: boolean,
  editorRoot: boolean,
  supports: (property: string, value: string) => boolean,
  dependencies: Map<string, Set<string>>,
): string {
  const groups: Token[][] = [[]]
  let depth = 0
  for (const token of tokens) {
    if (token.value === '(' && token.kind === 'punct') depth++
    if (token.value === ')' && token.kind === 'punct' && --depth < 0) error('多余的右括号。')
    if (depth > 12) error('函数嵌套过深。')
    if (token.value === ';' && token.kind === 'punct' && depth === 0) groups.push([])
    else groups.at(-1)!.push(token)
  }
  if (depth) error('函数括号未闭合。')
  if (groups.length > 129) error('单条规则最多 128 个声明。')
  const output: string[] = []
  for (const group of groups) {
    const list = compact(group)
    if (!list.length) continue
    if (list[0]?.kind !== 'word' || list[1]?.value !== ':') error('声明必须为 属性: 值。')
    const property = list[0]!.value
    const custom = property.startsWith('--theme-') && /^--theme-[a-z0-9-]{1,60}$/.test(property)
    if (root ? !rootVariables.has(property) && !custom : !properties.has(property))
      error(`不允许属性 ${property}。`)
    const valueStart = group.findIndex((t) => t.value === ':') + 1
    const valueTokens = group.slice(valueStart)
    const valueList = compact(valueTokens)
    if (
      !valueList.length ||
      valueList.some((t) => t.kind === 'punct' && '{};@![]'.includes(t.value))
    )
      error(`属性 ${property} 的值无效或包含不支持的 !important。`)
    if (valueList.length > 512) error('单个声明过于复杂。')
    const refs = new Set<string>()
    for (let i = 0; i < valueList.length; i++) {
      const t = valueList[i]!
      if (t.kind === 'word' && valueList[i + 1]?.value === '(') {
        const name = t.value.toLowerCase()
        if (!functions.has(name)) error(`不允许函数 ${name}；主题不能加载外部资源。`)
        if (name === 'var') {
          const reference = valueList[i + 2]
          if (
            reference?.kind !== 'word' ||
            (!rootVariables.has(reference.value) &&
              !/^--theme-[a-z0-9-]{1,60}$/.test(reference.value))
          )
            error('var() 只能引用主题变量。')
          refs.add(reference!.value)
        }
      }
    }
    // CSS is data, but pathological paint/filter sizes can still monopolize a renderer.
    // Reject unbounded math/variable substitution in paint lengths; color properties
    // may still use shared theme variables and modern color functions.
    const paintBound =
      /shadow/.test(property) || /radius$/.test(property)
        ? 64
        : ['outline', 'outline-width', 'outline-offset'].includes(property)
          ? 16
          : [
                'letter-spacing',
                'word-spacing',
                'text-indent',
                'text-underline-offset',
                'text-decoration-thickness',
              ].includes(property)
            ? 32
            : undefined
    const colorFunctions = new Set([
      'rgb',
      'rgba',
      'hsl',
      'hsla',
      'hwb',
      'lab',
      'lch',
      'oklab',
      'oklch',
      'color',
      'color-mix',
      'light-dark',
    ])
    const stack: string[] = []
    for (let i = 0; i < valueList.length; i++) {
      const token = valueList[i]!
      if (token.value === '(' && token.kind === 'punct') {
        const fn = valueList[i - 1]?.kind === 'word' ? valueList[i - 1]!.value.toLowerCase() : ''
        stack.push(fn)
        if (paintBound !== undefined && !colorFunctions.has(fn))
          error('阴影、圆角、轮廓和字距须用有限常量，不支持变量或计算。')
      } else if (token.value === ')' && token.kind === 'punct') stack.pop()
      if (token.kind === 'number' && valueList[i - 1]?.value !== '#') {
        const bound =
          paintBound !== undefined && !stack.some((fn) => colorFunctions.has(fn))
            ? paintBound
            : 4096
        if (!Number.isFinite(Number(token.value)) || Math.abs(Number(token.value)) > bound)
          error(`数值超出主题范围（最大 ${bound}）。`)
      }
    }
    if (valueList.filter((t) => t.kind === 'punct' && t.value === ',').length > 64)
      error('渐变/字体/颜色列表最多 64 个分隔项。')
    const value = serialize(valueTokens)
    const grammarProperty = colors.has(property)
      ? 'color'
      : property === '--shadow-soft'
        ? 'box-shadow'
        : property
    if (!custom && !supports(grammarProperty, value)) error(`属性 ${property} 的值无法解析。`)
    if (property === 'font-size' || property === 'line-height') {
      if (!editorRoot) error('字号和行高只能统一设置在 .milkup-editor 根，不支持逐行尺寸。')
      const match = /^(\d+(?:\.\d+)?)(px)?$/.exec(value)
      if (!match) return error('字号/行高需要明确正数，字号使用 px；不支持变量、计算或 normal。')
      const number = Number(match[1])
      const px = match[2] === 'px'
      if (
        property === 'font-size'
          ? !px || number < 8 || number > 72
          : px
            ? number < 8 || number > 144
            : number < 0.8 || number > 4
      )
        error('字号支持 8–72px；行高支持 8–144px 或 0.8–4 倍。')
    }
    if (property.startsWith('--')) dependencies.set(property, refs)
    output.push(
      `${property}:${value}${editorRoot && ['font-size', 'line-height', 'font-family'].includes(property) ? '!important' : ''};`,
    )
  }
  if (!output.length) error('规则没有可用声明。')
  return output.join('')
}
function selector(tokens: Token[]): string[] {
  const list = compact(tokens)
  if (list.length > 256) error('单条选择器过于复杂。')
  let i = 0
  const parseList = (nested = false, depth = 0): string[] => {
    if (depth > 8) error('选择器嵌套过深。')
    const results: string[] = []
    let part = ''
    let atoms = 0
    while (i < list.length && (!nested || list[i]!.value !== ')')) {
      const token = list[i++]!
      if (token.value === ',') {
        if (!atoms) error('空选择器。')
        results.push(part)
        part = ''
        atoms = 0
        continue
      }
      if (token.value === '.' && list[i]?.kind === 'word') {
        const name = list[i++]!.value
        if (!classes.has(name)) error(`不允许选择器 .${name}。`)
        part += `.${name}`
        atoms++
        continue
      }
      if (token.kind === 'word' && tags.has(token.value)) {
        if (atoms) part += ' '
        part += token.value
        atoms++
        continue
      }
      if (token.value === '*') {
        if (atoms) part += ' '
        part += '*'
        atoms++
        continue
      }
      if (['>', '+', '~', ' '].includes(token.value) && atoms) {
        part += ` ${token.value} `
        atoms = 0
        continue
      }
      if (token.value === ':' && list[i]?.kind === 'word') {
        const name = list[i++]!.value
        if (['first-child', 'last-child', 'only-child', 'empty'].includes(name)) {
          part += `:${name}`
          atoms++
          continue
        }
        if (['where', 'is', 'not'].includes(name) && list[i++]?.value === '(') {
          const items = parseList(true, depth + 1)
          if (list[i++]?.value !== ')') error('选择器括号未闭合。')
          part += `:${name}(${items.join(',')})`
          atoms++
          continue
        }
        error(`不允许伪类 ${name}。`)
      }
      if (token.value === '[') {
        const field = list[i++]
        const equals = list[i++]
        const val = list[i++]
        const end = list[i++]
        if (
          field?.value !== 'data-mode' ||
          equals?.value !== '=' ||
          !['source', 'live'].includes(val?.value ?? '') ||
          end?.value !== ']'
        )
          error('仅支持 [data-mode="source"] / [data-mode="live"] 属性选择器。')
        part += `[data-mode="${val!.value}"]`
        atoms++
        continue
      }
      error('选择器超出文档主题范围。')
    }
    if (!atoms) error('选择器不能以组合符结尾。')
    results.push(part)
    return results
  }
  // Whitespace descendant combinators must survive canonicalization.
  const normalized: Token[] = []
  for (let n = 0; n < tokens.length; n++) {
    const t = tokens[n]!
    if (t.kind === 'comment') continue
    if (t.kind === 'space') {
      const prev = normalized.at(-1)
      const next = tokens.slice(n + 1).find((x) => x.kind !== 'space' && x.kind !== 'comment')
      if (
        prev &&
        next &&
        !['>', '+', '~', ',', '(', ':', '[', '='].includes(prev.value) &&
        !['>', '+', '~', ',', ')', '='].includes(next.value)
      )
        normalized.push({ kind: 'punct', value: ' ' })
    } else normalized.push(t)
  }
  list.splice(0, list.length, ...normalized)
  return parseList()
}
export function compileThemeCss(
  source: string,
  supports: (property: string, value: string) => boolean,
): CompiledThemeCss {
  const tokens = tokenize(source)
  let at = 0
  let count = 0
  const output: string[] = []
  const dependencyModes = {
    all: new Map<string, Set<string>>(),
    light: new Map<string, Set<string>>(),
    dark: new Map<string, Set<string>>(),
  }
  const skip = () => {
    while (tokens[at]?.kind === 'space' || tokens[at]?.kind === 'comment') at++
  }
  function rules(mode?: Mode, nested = false): void {
    while (at < tokens.length) {
      skip()
      if (at >= tokens.length) break
      if (tokens[at]!.value === '}' && tokens[at]!.kind === 'punct') {
        if (!nested) error('多余的右花括号。')
        at++
        return
      }
      const head: Token[] = []
      while (at < tokens.length && !(tokens[at]!.kind === 'punct' && tokens[at]!.value === '{'))
        head.push(tokens[at++]!)
      if (tokens[at++]?.value !== '{') error('规则缺少花括号。')
      const h = compact(head)
      const raw = serialize(h)
      if (h[0]?.value === '@') {
        if (nested || !/^@media\(prefers-color-scheme:(light|dark)\)$/.test(raw))
          error('仅支持 @media (prefers-color-scheme: light/dark)，不支持 @import 或其他规则。')
        rules(raw.includes(':dark)') ? 'dark' : 'light', true)
        continue
      }
      const body: Token[] = []
      while (at < tokens.length && !(tokens[at]!.kind === 'punct' && tokens[at]!.value === '}')) {
        if (tokens[at]!.kind === 'punct' && tokens[at]!.value === '{') error('不支持嵌套规则。')
        body.push(tokens[at++]!)
      }
      if (tokens[at++]?.value !== '}') error('规则未闭合。')
      if (++count > 256) error('规则超过 256 条。')
      const root = /^:root(?:\[data-theme=(?:"(light|dark)"|(light|dark))\])?$/.exec(raw)
      const ownMode = root ? ((root[1] ?? root[2]) as Mode) : undefined
      if (ownMode && mode && ownMode !== mode) error('浅深模式条件互相冲突。')
      const effectiveMode = ownMode ?? mode
      const prefix = effectiveMode ? `:root[data-theme="${effectiveMode}"]` : ':root'
      const parsedSelectors = root ? [] : selector(head)
      const editorRoot =
        parsedSelectors.length > 0 &&
        parsedSelectors.every((value) =>
          /^\.milkup-editor(?:\[data-mode="(?:source|live)"\])?$/.test(value),
        )
      const values = declarations(
        body,
        !!root,
        editorRoot,
        supports,
        dependencyModes[effectiveMode ?? 'all'],
      )
      if (root) output.push(`${prefix}{${values}}`)
      else {
        const selectors = parsedSelectors.map(
          (s) => `${effectiveMode ? `${prefix} ` : ''}${s}:where(.milkup-editor, .milkup-editor *)`,
        )
        output.push(`${selectors.join(',')}{${values}}`)
      }
    }
    if (nested) error('@media 规则未闭合。')
  }
  rules()
  if (!count) error('文件没有主题规则。')
  if (
    new Set([
      ...dependencyModes.all.keys(),
      ...dependencyModes.light.keys(),
      ...dependencyModes.dark.keys(),
    ]).size > 192
  )
    error('主题变量超过 192 个。')
  for (const mode of ['light', 'dark'] as const) {
    const dependencies = new Map([...dependencyModes.all, ...dependencyModes[mode]])
    const active = new Set<string>()
    const done = new Set<string>()
    const visit = (name: string, depth = 0) => {
      if (depth > 32) error('变量引用链过深。')
      if (done.has(name)) return
      if (active.has(name)) error('主题变量存在循环引用。')
      active.add(name)
      for (const ref of dependencies.get(name) ?? []) visit(ref, depth + 1)
      active.delete(name)
      done.add(name)
    }
    for (const name of dependencies.keys()) visit(name)
  }
  return { css: output.join('\n'), ruleCount: count }
}
