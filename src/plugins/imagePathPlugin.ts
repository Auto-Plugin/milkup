// 设置当前 Markdown 文件路径（保留接口兼容性）
export function setCurrentMarkdownFilePath(_filePath: string | null) {
  // 不再需要存储全局路径
}

/**
 * 浏览器兼容的 base64 编码
 */
function encodeBase64(str: string): string {
  // 使用浏览器的 btoa，但需要先处理 Unicode 字符
  return btoa(encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, (_, p1) => {
    return String.fromCharCode(Number.parseInt(p1, 16))
  }))
}

/**
 * 检查是否为绝对路径（浏览器兼容版本）
 */
function isAbsolutePath(filePath: string): boolean {
  // Windows: C:\, D:\, \\server\share
  // Unix: /path
  return /^(?:[a-z]:[\\/]|\\\\|\/)/i.test(filePath)
}

/**
 * 处理 Markdown 中的图片路径
 * 使用自定义协议 milkup:// 来加载本地图片，避免修改源文件
 *
 * @param markdownContent - Markdown 内容
 * @param markdownFilePath - Markdown 文件的绝对路径
 * @returns 处理后的 Markdown 内容（仅在渲染时使用）
 */
export function processImagePaths(markdownContent: string, markdownFilePath: string | null): string {
  if (!markdownFilePath) {
    return markdownContent
  }

  // 将 Markdown 文件路径编码为 base64
  const base64Path = encodeBase64(markdownFilePath)

  let processedContent = markdownContent

  // 1. 处理 Markdown 图片语法: ![alt](path)
  const markdownImageRegex = /!\[([^\]]*)\]\(([^)]+)\)/g
  processedContent = processedContent.replace(markdownImageRegex, (match, alt, imagePath) => {
    const convertedPath = convertToProtocolUrl(imagePath, base64Path)
    return convertedPath ? `![${alt}](${convertedPath})` : match
  })

  // 2. 处理 HTML img 标签: <img src="path" />
  const htmlImageRegex = /<img\s[^>]*?src=["']([^"']+)["'][^>]*>/gi
  processedContent = processedContent.replace(htmlImageRegex, (match, imagePath) => {
    const convertedPath = convertToProtocolUrl(imagePath, base64Path)
    if (!convertedPath)
      return match
    // 替换 src 属性值
    return match.replace(/src=["'][^"']+["']/, `src="${convertedPath}"`)
  })

  return processedContent
}

/**
 * 将相对路径转换为自定义协议 URL
 * @param imagePath - 图片路径
 * @param base64Path - base64 编码的 markdown 文件路径
 * @returns 转换后的协议 URL，如果不需要转换则返回 null
 */
function convertToProtocolUrl(imagePath: string, base64Path: string): string | null {
  // 只处理相对路径
  // 跳过: HTTP(S) URL, file:// 协议, data: URI, milkup:// 协议, 绝对路径
  if (
    imagePath.startsWith('http://')
    || imagePath.startsWith('https://')
    || imagePath.startsWith('file://')
    || imagePath.startsWith('data:')
    || imagePath.startsWith('milkup://')
    || isAbsolutePath(imagePath)
  ) {
    return null
  }

  // 相对路径转换为自定义协议 URL
  // 格式: milkup:///<base64-encoded-markdown-path>/<relative-image-path>
  return `milkup:///${base64Path}/${imagePath}`
}

/**
 * 反向处理：将 milkup:// 协议 URL 转回相对路径
 * 用于保存文件时恢复原始路径格式
 *
 * @param content - 包含 milkup:// 协议的内容
 * @param markdownFilePath - Markdown 文件的绝对路径
 * @returns 恢复相对路径后的内容
 */
export function reverseProcessImagePaths(content: string, markdownFilePath: string | null): string {
  if (!markdownFilePath) {
    return content
  }

  const base64Path = encodeBase64(markdownFilePath)
  let restoredContent = content

  // 1. 恢复 Markdown 图片语法中的路径
  const markdownProtocolRegex = new RegExp(`!\\[([^\\]]*)\\]\\(milkup:///${base64Path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/([^)]+)\\)`, 'g')
  restoredContent = restoredContent.replace(markdownProtocolRegex, (_, alt, relativePath) => {
    return `![${alt}](${relativePath})`
  })

  // 2. 恢复 HTML img 标签中的路径
  const htmlProtocolRegex = new RegExp(`<img\\s+[^>]*?src="milkup:///${base64Path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/([^"]+)"[^>]*>`, 'gi')
  restoredContent = restoredContent.replace(htmlProtocolRegex, (match, relativePath) => {
    // 替换 src 属性值
    return match.replace(/src="milkup:\/\/\/[^"]+"/, `src="${relativePath}"`)
  })

  return restoredContent
}
