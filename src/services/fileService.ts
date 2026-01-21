import type { Tab } from '@/types/tab'
import { processImagePaths } from '@/plugins/imagePathPlugin'

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

    // 2. 处理图片路径
    const processedContent = processImages
      ? await processImagePaths(result.content, result.filePath)
      : result.content

    // 3. 检查只读状态
    const readOnly = checkReadOnly
      ? await window.electronAPI.getIsReadOnly(result.filePath)
      : false

    return {
      filePath: result.filePath,
      content: result.content,
      processedContent,
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
export async function createTabDataFromFile(
  filePath: string,
  content: string,
  options: { processImages?: boolean } = {},
): Promise<Omit<Tab, 'id'>> {
  const { processImages = true } = options

  // 处理图片路径
  const processedContent = processImages
    ? await processImagePaths(content, filePath)
    : content

  // 检查只读状态
  const readOnly = await window.electronAPI?.getIsReadOnly(filePath) || false

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
