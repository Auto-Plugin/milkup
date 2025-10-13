import type { ExportPDFOptions } from '@/main/types'

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
      .export-container > #milkdown {
        width: 100%!important;
      }
      .export-container > #milkdown .milkdown,.export-container > #milkdown .milkdown > div[contenteditable="true"] {
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
