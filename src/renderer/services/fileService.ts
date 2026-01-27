import type { Tab } from '@/types/tab'
import { processImagePaths } from '@/plugins/imagePathPlugin'
import { ensureTrailingNewline, fixUnclosedCodeBlock, normalizeMarkdown } from '@/renderer/utils/text'

/**
 * 文件服务 - 统一管理文件读取和Tab创建逻辑
 * 整合了原本分散在 useFile、useTab、main/index 中的重复代码
 */

export interface FileContent {
  filePath: string
  content: string
  processedContent?: string
  readOnly?: boolean
}

export interface OpenFileOptions {
  filePath: string
  processImages?: boolean
  checkReadOnly?: boolean
}

/**
 * 读取文件并处理内容
 * 整合了 readFileByPath + processImagePaths + readOnly检查
 */
export async function readAndProcessFile(options: OpenFileOptions): Promise<FileContent | null> {
  const { filePath, processImages = true, checkReadOnly = true } = options

  try {
    // 1. 读取文件
    const result = await window.electronAPI.readFileByPath(filePath)
    if (!result) {
      console.error('无法读取文件:', filePath)
      return null
    }

    // 2. 规范化文本 (修复 BOM, CRLF, 未闭合代码块, 确保结尾换行)
    const rawContent = result.content
    const repairedContent = repairMarkdown(rawContent)

    // 注意：不再自动保存修复后的内容，避免修改源文件
    // 修复将在用户主动保存时应用
    if (repairedContent !== rawContent) {
      console.log('[fileService] 检测到文本格式问题，将在用户保存时修复')
    }

    // 3. 处理图片路径用于渲染 (基于修复后的内容)
    // processedContent 仅用于 Milkdown 渲染，不用于编辑
    const processedContent = processImages
      ? processImagePaths(repairedContent, result.filePath)
      : repairedContent

    // 获取且检查文件只读状态
    const readOnly = checkReadOnly
      ? await window.electronAPI.getIsReadOnly(filePath)
      : false

    return {
      filePath: result.filePath,
      content: repairedContent, // 原始内容（用于编辑）
      processedContent, // 处理后的内容（用于渲染）
      readOnly,
    }
  } catch (error) {
    console.error('读取和处理文件失败:', filePath, error)
    return null
  }
}

/**
 * 从文件路径读取并创建Tab数据结构
 * 不包含添加到tabs列表的逻辑，仅创建Tab对象
 */
export function createTabDataFromFile(
  filePath: string,
  content: string,
  options: { processImages?: boolean } = {},
): Omit<Tab, 'id'> {
  const { processImages = true } = options

  // 处理图片路径（现在是同步操作）
  const processedContent = processImages
    ? processImagePaths(content, filePath)
    : content

  // 检查只读状态（保持异步，但在调用处处理）
  // 注意：这里我们不能直接 await，需要在调用处处理
  const readOnly = false // 默认值，调用处需要单独获取

  // 从路径中提取文件名
  const fileName = filePath.split(/[\\/]/).at(-1) || 'Untitled'

  return {
    name: fileName,
    filePath,
    content: processedContent,
    originalContent: content,
    isModified: false,
    scrollRatio: 0,
    readOnly,
  }
}

/**
 * 批量读取文件（用于启动时或拖拽多个文件）
 */
export async function readMultipleFiles(filePaths: string[]): Promise<FileContent[]> {
  const results = await Promise.allSettled(
    filePaths.map(fp => readAndProcessFile({ filePath: fp })),
  )

  return results
    .filter((r): r is PromiseFulfilledResult<FileContent | null> => r.status === 'fulfilled')
    .map(r => r.value)
    .filter((r): r is FileContent => r !== null)
}

/**
 * 修复 Markdown 内容
 * 组合了多项修复操作
 */
export function repairMarkdown(content: string): string {
  return ensureTrailingNewline(normalizeMarkdown(fixUnclosedCodeBlock(content)))
}
