import type { SyntaxNode } from '@milkup/markdown'

const languages = [
  ['', 'Plain text'],
  ['javascript', 'JavaScript'],
  ['typescript', 'TypeScript'],
  ['json', 'JSON'],
  ['python', 'Python'],
  ['bash', 'Shell'],
  ['sql', 'SQL'],
  ['css', 'CSS'],
  ['html', 'HTML'],
  ['java', 'Java'],
  ['c', 'C'],
  ['cpp', 'C++'],
  ['rust', 'Rust'],
  ['go', 'Go'],
] as const
const aliases: Record<string, string> = {
  js: 'javascript',
  ts: 'typescript',
  py: 'python',
  sh: 'bash',
  shell: 'bash',
  'c++': 'cpp',
  rs: 'rust',
  xml: 'html',
  text: '',
  txt: '',
  plaintext: '',
}
const keywords = new Set(
  'as async await break case catch class const continue def default delete do elif else enum except export extends false finally fn for from function if impl import in interface let match mod move mut new None null package pass private protected pub public raise return self static struct super switch this throw trait true try type typeof undefined use var void while with yield True False SELECT FROM WHERE INSERT INTO UPDATE DELETE CREATE TABLE JOIN ON AND OR NOT NULL VALUES SET select from where insert into update delete create table join on and or not null values set'.split(
    ' ',
  ),
)
const maxHighlightLineLength = 4096
const maxHighlightTokens = 256

export function codeBlockForLine(
  blocks: readonly SyntaxNode[],
  from: number,
  to: number,
): SyntaxNode | undefined {
  for (const block of blocks) {
    if (block.from > from || block.to < to) continue
    if (block.type === 'fencedCode' || block.type === 'indentedCode') return block
    const nested = block.children && codeBlockForLine(block.children, from, to)
    if (nested) return nested
  }
  return undefined
}

function languageName(info: unknown): string {
  const name = typeof info === 'string' ? info.trim().split(/\s/u, 1)[0]!.toLowerCase() : ''
  return aliases[name] ?? name
}

/** Bounded line-local coloring. Unknown languages/long lines retain exact plain source. */
export function renderCodeLine(
  lineDOM: HTMLElement,
  text: string,
  from: number,
  block: SyntaxNode,
): void {
  const document = lineDOM.ownerDocument
  const language = languageName(block.data?.info)
  const marker = block.markerRanges?.find(
    (range) => range.from >= from && range.to <= from + text.length,
  )
  const content = document.createElement('span')
  content.className = 'milkup-code-source'
  content.dataset.from = String(from)
  content.dataset.to = String(from + text.length)
  lineDOM.replaceChildren(content)
  lineDOM.dataset.codeLanguage = language
  if (
    marker ||
    !language ||
    !languages.some(([id]) => id === language) ||
    text.length > maxHighlightLineLength
  ) {
    content.textContent = text || '\u200b'
  } else {
    // No HTML parser or source-derived class names. Every token is a text node.
    const pattern =
      /\/\/[^\r\n]*|#[^\r\n]*|--[^\r\n]*|\/\*.*?(?:\*\/|$)|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b\d+(?:\.\d+)?\b|[A-Za-z_$][\w$]*/gu
    let cursor = 0,
      count = 0
    for (const match of text.matchAll(pattern)) {
      if (++count > maxHighlightTokens) break
      const value = match[0],
        start = match.index
      let kind = ''
      if (value.startsWith('//') || value.startsWith('/*'))
        kind = ['python', 'bash', 'json', 'html'].includes(language) ? '' : 'comment'
      else if (value.startsWith('#')) kind = ['python', 'bash'].includes(language) ? 'comment' : ''
      else if (value.startsWith('--')) kind = language === 'sql' ? 'comment' : ''
      else if (/^["'`]/u.test(value))
        kind =
          language === 'json' && /^\s*:/u.test(text.slice(start + value.length))
            ? 'property'
            : 'string'
      else if (/^\d/u.test(value)) kind = 'number'
      else if (keywords.has(value)) kind = 'keyword'
      content.append(document.createTextNode(text.slice(cursor, start)))
      const token = document.createElement('span')
      if (kind) token.className = `milkup-code-token-${kind}`
      token.textContent = value
      content.append(token)
      cursor = start + value.length
    }
    content.append(
      document.createTextNode(text.slice(cursor) || (text.length === 0 ? '\u200b' : '')),
    )
  }
  if (marker && block.type === 'fencedCode' && from !== block.from)
    lineDOM.classList.add('milkup-code-closing')
  if (block.type !== 'fencedCode' || from !== block.from || text.length > maxHighlightLineLength)
    return
  lineDOM.classList.add('milkup-code-opening')
  const picker = document.createElement('select')
  picker.className = 'milkup-code-language'
  picker.setAttribute('aria-label', 'Code language')
  picker.title = 'Code language'
  picker.dataset.codeFrom = String(from)
  picker.dataset.codeOpening = text
  for (const [id, label] of languages) {
    const option = document.createElement('option')
    option.value = id
    option.textContent = label
    picker.append(option)
  }
  if (!languages.some(([id]) => id === language)) {
    const option = document.createElement('option')
    option.value = language
    option.textContent = language
    picker.append(option)
  }
  picker.value = language
  // Preserve native selection/keyboard behavior; editor pointer routing must not steal focus.
  for (const name of ['mousedown', 'pointerdown', 'click', 'keydown', 'keyup'])
    picker.addEventListener(name, (event) => event.stopPropagation())
  lineDOM.append(picker)
}

export function codeLanguagePicker(
  event: Event,
  content: HTMLElement,
): HTMLSelectElement | undefined {
  const target = event.target
  return target instanceof HTMLSelectElement &&
    target.classList.contains('milkup-code-language') &&
    content.contains(target)
    ? target
    : undefined
}

export function codeLanguageEdit(
  picker: HTMLSelectElement,
  from: number,
  text: string,
): { from: number; to: number; insert: string } | undefined {
  if (
    picker.disabled ||
    text !== picker.dataset.codeOpening ||
    !languages.some(([id]) => id === picker.value)
  )
    return
  const match = /^( {0,3}(?:`{3,}|~{3,}))([ \t]*)([^\s]*)(.*)$/u.exec(text)
  if (!match) return
  const tokenFrom = from + match[1]!.length + match[2]!.length
  // Plain text clears the language only when no trailing info could become a language.
  const insert = picker.value || (match[4]!.trim() ? 'text' : '')
  if (insert === match[3]) return
  return { from: tokenFrom, to: tokenFrom + match[3]!.length, insert }
}
