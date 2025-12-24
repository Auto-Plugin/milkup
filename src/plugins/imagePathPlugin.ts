import { resolveImagePath } from '@/renderer/services'

// 用于存储当前 Markdown 文件路径的全局变量
let currentMarkdownFilePath: string | null = null

// 设置当前 Markdown 文件路径
export function setCurrentMarkdownFilePath(filePath: string | null) {
  currentMarkdownFilePath = filePath
}

// 用于在 DOM 中直接处理图片路径的函数
export async function processImagePaths(markdownContent: string, markdownFilePath: string | null): Promise<string> {
  if (!markdownFilePath) {
    return markdownContent
  }

  // 匹配 Markdown 中的图片语法: ![alt](path)
  const imageRegex = /!\[([^\]]*)\]\(([^)]+)\)/g

  let processedContent = markdownContent
  const matches = Array.from(markdownContent.matchAll(imageRegex))

  for (const match of matches) {
    const [fullMatch, alt, imagePath] = match

    // 只处理相对路径
    if (!imagePath.startsWith('http') && !imagePath.startsWith('file://') && !imagePath.startsWith('data:')) {
      try {
        const resolvedPath = await resolveImagePath(markdownFilePath, imagePath)

        if (resolvedPath !== imagePath) {
          const newImageMarkdown = `![${alt}](${resolvedPath})`
          processedContent = processedContent.replace(fullMatch, newImageMarkdown)
        }
      } catch (error) {
        console.error('解析图片路径失败:', error)
      }
    }
  }

  return processedContent
}
