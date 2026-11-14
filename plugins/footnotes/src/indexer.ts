export interface Line {
  readonly number: number
  readonly from: number
  readonly to: number
  readonly text: string
}
export interface Reference {
  readonly key: string
  readonly number: number
  readonly from: number
  readonly to: number
  readonly line: number
}
export interface Definition {
  readonly key: string
  readonly from: number
  readonly to: number
  readonly line: number
  body: string
  truncated: boolean
}
/** NFC, trimmed, case-sensitive labels; punctuation delimiters, whitespace and controls are forbidden. */
export function normalizeLabel(label: string): string | undefined {
  const value = label.trim().normalize('NFC')
  return value.length > 0 && value.length <= 128 && !/[\s\u0000-\u001f\u007f\[\]\\]/u.test(value)
    ? value
    : undefined
}
export class FootnoteIndex {
  readonly references: Reference[] = []
  readonly definitions = new Map<string, Definition>()
  readonly duplicates: Definition[] = []
  complete = false
  private outputRevision = 0
  get revision(): number {
    return this.outputRevision
  }
  partialReason: string | undefined
  private readonly numbers = new Map<string, number>()
  private readonly maxEntries: number
  private readonly maxBody: number
  private active: Definition | undefined
  private blank = false
  private fence: { marker: string; length: number } | undefined
  private html: string | undefined
  private ticks = 0
  private entries = 0
  constructor(options: { maxEntries?: number; maxBody?: number } = {}) {
    this.maxEntries = options.maxEntries ?? 4096
    this.maxBody = options.maxBody ?? 8192
  }
  limit(reason: string): void {
    if (this.partialReason === undefined || this.complete) this.outputRevision++
    this.partialReason ??= reason
    this.complete = false
  }
  private reserve(): boolean {
    if (this.entries >= this.maxEntries) {
      this.limit('entry-limit')
      return false
    }
    this.entries++
    return true
  }
  private body(text: string): void {
    const active = this.active
    if (!active) return
    const value = active.body + (this.blank ? '\n\n' : '\n') + text
    this.blank = false
    const body = value.slice(0, this.maxBody)
    const truncated = active.truncated || value.length > this.maxBody
    if (body !== active.body || truncated !== active.truncated) this.outputRevision++
    active.body = body
    active.truncated = truncated
  }
  consume(line: Line): void {
    if (this.partialReason) return
    const text = line.text
    if (this.fence) {
      const close = /^ {0,3}(`+|~+)[\t ]*$/.exec(text)
      if (close && close[1]![0] === this.fence.marker && close[1]!.length >= this.fence.length)
        this.fence = undefined
      return
    }
    if (this.html) {
      if (this.html === 'blank' && !text.trim()) this.html = undefined
      else if (this.html !== 'blank' && text.toLowerCase().includes(this.html))
        this.html = undefined
      return
    }
    if (this.active) {
      if (!text.trim()) {
        this.blank = true
        return
      }
      const continuation = /^(?: {4}|\t)(.*)$/.exec(text)
      if (continuation) {
        this.body(continuation[1]!)
        return
      }
      this.active = undefined
      this.blank = false
    }
    if (/^ {0,3}(?:>|[-+*][\t ]|\d+[.)][\t ])/.test(text)) {
      if (/`{3,}|~{3,}|<\/?[A-Za-z!]/.test(text)) this.limit('nested-context')
      return
    }
    const fence = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(text)
    if (fence && !(fence[1]![0] === '`' && fence[2]!.includes('`'))) {
      this.fence = { marker: fence[1]![0]!, length: fence[1]!.length }
      this.ticks = 0
      return
    }
    if (/^(?: {4}|\t)/.test(text)) return
    const html = /^ {0,3}<(script|pre|style|textarea)(?:[\t >]|$)/i.exec(text)
    const end = html
      ? `</${html[1]!.toLowerCase()}>`
      : /^ {0,3}<!--/.test(text)
        ? '-->'
        : /^ {0,3}<\?/.test(text)
          ? '?>'
          : /^ {0,3}<!\[CDATA\[/.test(text)
            ? ']]>'
            : /^ {0,3}<![A-Z]/.test(text)
              ? '>'
              : /^ {0,3}<\/?[A-Za-z][\w-]*(?:[\t >\/]|$)/.test(text)
                ? 'blank'
                : undefined
    if (end) {
      if (end === 'blank' || !text.toLowerCase().includes(end)) this.html = end
      return
    }
    if (/<\/?[A-Za-z!][^>]*>/.test(text)) return
    if (!this.ticks) {
      const definition = /^ {0,3}\[\^([^\]\r\n]{1,128})\]:[\t ]?(.*)$/.exec(text)
      const key = definition && normalizeLabel(definition[1]!)
      if (definition && key) {
        if (!this.reserve()) return
        const body = definition[2]!
        const def = {
          key,
          from: line.from,
          to: line.to,
          line: line.number,
          body: body.slice(0, this.maxBody),
          truncated: body.length > this.maxBody,
        }
        if (this.definitions.has(key)) this.duplicates.push(def)
        else this.definitions.set(key, def)
        this.outputRevision++
        this.active = def
        return
      }
    }
    for (let i = 0; i < text.length;) {
      if (text[i] === '\\' && !this.ticks) {
        i += 2
        continue
      }
      if (text[i] === '`') {
        let end = i + 1
        while (text[end] === '`') end++
        const count = end - i
        if (this.ticks === count) this.ticks = 0
        else if (!this.ticks) this.ticks = count
        i = end
        continue
      }
      if (this.ticks) {
        i++
        continue
      }
      if (text[i] === '[' || (text[i] === '!' && text[i + 1] === '[')) {
        const open = text[i] === '!' ? i + 1 : i
        let close = open + 1
        for (; close < text.length; close++) {
          if (text[close] === '\\') close++
          else if (text[close] === ']') break
        }
        if (close >= text.length) return
        if (text[close + 1] === '(') {
          let end = close + 2
          for (; end < text.length; end++) {
            if (text[end] === '\\') end++
            else if (text[end] === ')') break
          }
          i = Math.min(text.length, end + 1)
          continue
        }
        if (text[i] === '!' || text[open + 1] !== '^') {
          i = close + 1
          continue
        }
      }
      if (text[i] === '[' && text[i + 1] === '^') {
        const close = text.indexOf(']', i + 2)
        if (close > i && close - i <= 131) {
          const key = normalizeLabel(text.slice(i + 2, close))
          if (key) {
            if (!this.reserve()) return
            let number = this.numbers.get(key)
            if (number === undefined) {
              number = this.numbers.size + 1
              this.numbers.set(key, number)
            }
            this.outputRevision++
            this.references.push({
              key,
              number,
              from: line.from + i,
              to: line.from + close + 1,
              line: line.number,
            })
            i = close + 1
            continue
          }
        }
      }
      i++
    }
  }
  finish(): void {
    if (this.ticks) this.limit('incomplete-inline-code')
    const complete = !this.partialReason
    if (complete !== this.complete) this.outputRevision++
    this.complete = complete
    this.active = undefined
  }
}
