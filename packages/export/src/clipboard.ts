import { parseMarkdown } from '@milkup/markdown'
import { renderMarkdownDocumentHtml } from './markdown-html'

/** Keep Markdown byte-for-byte for plain destinations; enrich valid live tables. */
export function createMarkdownClipboardPayload(
  source: string,
  richTables: boolean,
): Readonly<{ text: string; html?: string }> {
  if (!richTables || !parseMarkdown(source).root.children?.some((node) => node.type === 'table'))
    return { text: source }
  const html = renderMarkdownDocumentHtml(source, {
    resolveUrl: (url) => {
      const compact = url.replace(/[\u0000-\u0020\u007f]/g, '')
      const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(compact)?.[1]?.toLowerCase()
      return scheme && !['http', 'https', 'mailto', 'tel'].includes(scheme) ? '' : url
    },
  }).replaceAll('<table>', '<table border="1" style="border-collapse:collapse">')
  return { text: source, html }
}
