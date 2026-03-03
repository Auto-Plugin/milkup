import type { Block, ExportPDFOptions } from '@/main/types'

/**
 * 导出选定元素为一个带样式和图片的独立 HTML 文件
 * @param element - 要导出的元素
 * @param filename - 导出文件名（默认为 export.html）
 */
export async function exportElementWithStylesAndImages(
  element: HTMLElement,
  filename: string = 'export.html',
): Promise<void> {
  // 克隆元素并应用内联样式
  const cloned = cloneWithInlineStyles(element)

  // 将 <img> 转为 base64
  await inlineImages(cloned)

  // 生成完整 HTML
  const html = `<!doctype html>
  <html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <style>
      html, body {
        margin: 0;
        padding: 0;
        width: 100%;
        min-width: 1100px;
        height: auto;
      }
      .export-container {
        box-sizing: border-box;
        display: flex;
        justify-content: center;
      }
      .export-container > .milkup-container {
        width: 100%!important;
      }
      .export-container > .milkup-container .milkup-editor,.export-container > .milkup-container .milkup-editor > div[contenteditable="true"] {
        width: 100%!important;
      }
      p {
        word-break: break-word;
        width: 100%!important;
      }
    </style>
  </head>
  <body>
    <div class="export-container">${cloned.outerHTML}</div>
  </body>
  </html>`

  // 下载文件
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
  const url = URL.createObjectURL(blob)

  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()

  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/**
 * 克隆元素及其所有子元素，并将样式内联化
 * @param element - 原始元素
 * @returns 克隆后的元素（样式已内联）
 */
function cloneWithInlineStyles(element: HTMLElement): HTMLElement {
  const clone = element.cloneNode(true) as HTMLElement
  applyStylesRecursive(element, clone)
  return clone
}

/**
 * 递归地应用 computed style
 * @param src - 原始节点
 * @param dest - 克隆节点
 */
function applyStylesRecursive(src: Element, dest: Element): void {
  const computed = getComputedStyle(src)
  const style = Array.from(computed)
    .map(key => `${key}:${computed.getPropertyValue(key)};`)
    .join('')
  dest.setAttribute('style', style)

  // 🚨 修复 <a> 链接的点击性
  if (dest instanceof HTMLAnchorElement) {
    dest.style.pointerEvents = 'auto'
    dest.style.cursor = 'pointer'
    dest.style.textDecoration = 'underline'
    dest.setAttribute('target', '_blank') // 可选：让导出文件中点击在新标签打开
  }

  const srcChildren = Array.from(src.children)
  const destChildren = Array.from(dest.children)
  for (let i = 0; i < srcChildren.length; i++) {
    applyStylesRecursive(srcChildren[i], destChildren[i])
  }
}

/**
 * 将元素中的所有 <img> src 转换为 base64（data URL）
 * @param root - 要处理的根元素
 */
async function inlineImages(root: HTMLElement): Promise<void> {
  const images = Array.from(root.querySelectorAll('img'))

  const tasks = images.map(async (img) => {
    const src = img.src
    if (src.startsWith('data:'))
      return // 已经是内联的

    try {
      const res = await fetch(src, { mode: 'cors' })
      const blob = await res.blob()
      const base64 = await blobToDataURL(blob)
      img.src = base64
    } catch (err) {
      console.warn('图片内联失败:', src, err)
    }
  })

  await Promise.all(tasks)
}

/**
 * Blob → data URL
 * @param blob - Blob 对象
 * @returns base64 编码的 data URL
 */
function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onloadend = () => resolve(reader.result as string)
    reader.readAsDataURL(blob)
  })
}

// 导出为 PDF
export async function exportElementAsPDF(
  elementSelector: string,
  outputName: string,
  options?: ExportPDFOptions,
): Promise<void> {
  await window.electronAPI.exportAsPDF(elementSelector, outputName, options)
}
// 导出为 Word

/**
 * 遍历 Markdown 渲染后的 DOM，生成结构化数据
 * 过滤非正文节点（toolbar、控件等）
 */
export function serializeMarkdownToBlocks(selector: string): Block[] {
  const el = document.querySelector(selector)
  if (!el)
    throw new Error('Element not found')

  const blocks: Block[] = []

  function traverse(node: Node) {
    if (!(node instanceof HTMLElement))
      return

    const className = node.className || ''
    if (
      className.includes('milkdown-block-handle')
      || className.includes('crepe-drop-cursor')
      || className.includes('milkdown-link-preview')
      || className.includes('milkdown-link-edit')
      || className.includes('milkdown-toolbar')
      || className.includes('milkdown-latex-inline-edit')
      || className.includes('milkdown-slash-menu')
    ) {
      return
    }

    if (node.dataset.ignore)
      return
    if (node.classList.contains('cm-content')) {
      const lines: string[] = []
      node.querySelectorAll('.cm-line').forEach((line) => {
        lines.push(line.textContent || '')
      })
      blocks.push({ type: 'code', lines })
      return
    }
    const tag = node.tagName.toLowerCase()
    if (tag.startsWith('h')) {
      blocks.push({ type: 'heading', level: Number(tag[1]) as 1 | 2 | 3, text: node.textContent || '' })
    } else if (tag === 'p') {
      blocks.push({ type: 'paragraph', text: node.textContent || '' })
    } else if (tag === 'pre') {
      blocks.push({ type: 'code', lines: node.textContent?.split('\n') || [] })
    } else if (tag === 'ul' || tag === 'ol') {
      const items: string[] = []
      node.querySelectorAll('li').forEach(li => items.push(li.textContent || ''))
      blocks.push({ type: 'list', items, ordered: tag === 'ol' })
    }

    node.childNodes.forEach(traverse)
  }

  traverse(el)
  return blocks
}

export async function exportMarkdownAsWord(
  markdown: string,
  outputName: string,
): Promise<void> {
  const blocks = parseMarkdownToBlocks(markdown)
  await window.electronAPI.exportAsWord(blocks, outputName)
}

/**
 * 将 Markdown 源码文本解析为结构化 Block 数据
 */
export function parseMarkdownToBlocks(markdown: string): Block[] {
  const blocks: Block[] = []
  const lines = markdown.split('\n')
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    // 标题
    const headingMatch = line.match(/^(#{1,6})\s+(.*)/)
    if (headingMatch) {
      const level = Math.min(headingMatch[1].length, 3) as 1 | 2 | 3
      blocks.push({ type: 'heading', level, text: headingMatch[2] })
      i++
      continue
    }

    // 代码块
    if (line.trimStart().startsWith('```')) {
      const codeLines: string[] = []
      i++
      while (i < lines.length && !lines[i].trimStart().startsWith('```')) {
        codeLines.push(lines[i])
        i++
      }
      blocks.push({ type: 'code', lines: codeLines })
      i++ // 跳过结束的 ```
      continue
    }

    // 无序列表
    if (/^\s*[-*+]\s+/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*+]\s+/, ''))
        i++
      }
      blocks.push({ type: 'list', items, ordered: false })
      continue
    }

    // 有序列表
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ''))
        i++
      }
      blocks.push({ type: 'list', items, ordered: true })
      continue
    }

    // 空行跳过
    if (line.trim() === '') {
      i++
      continue
    }

    // 段落
    blocks.push({ type: 'paragraph', text: line })
    i++
  }

  return blocks
}

/**
 * 导出为纯文本文件（使用 Markdown 源码）
 */
export function exportAsText(
  markdown: string,
  outputName: string = 'export.txt',
): void {
  const blob = new Blob([markdown], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)

  const a = document.createElement('a')
  a.href = url
  a.download = outputName
  a.click()

  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
