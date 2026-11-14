import katex from 'katex'
import type { SdkDocumentMathNode } from '@milkup/plugin-sdk'
import { parseMathMarkup } from './mathml'

export function renderFormula(source: string, display: boolean): SdkDocumentMathNode {
  if (!source.trim() || source.length > 8192) throw new Error('公式为空或超过 8 Ki 字符限制。')
  let depth = 0
  for (let i = 0; i < source.length; i++) {
    if (source[i] === '\\') {
      i++
      continue
    }
    if (source[i] === '{' && ++depth > 64) throw new Error('公式嵌套超过 64 层。')
    if (source[i] === '}') depth--
  }
  let denied = false
  const markup = katex.renderToString(source, {
    output: 'mathml',
    displayMode: display,
    throwOnError: true,
    strict: 'error',
    maxExpand: 1000,
    maxSize: 20,
    macros: Object.create(null),
    globalGroup: false,
    trust: () => {
      denied = true
      return false
    },
  })
  if (denied) throw new Error('公式不能包含链接、资源或 HTML 扩展。')
  return parseMathMarkup(markup, source)
}
