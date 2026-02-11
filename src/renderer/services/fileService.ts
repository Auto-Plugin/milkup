import type { Tab } from "@/types/tab";

/**
 * 文件服务 - 统一管理文件读取和Tab创建逻辑
 * 主进程负责文件格式处理（BOM/CRLF/图片路径），渲染层只做简单的内容传递
 */

export interface FileContent {
  filePath: string;
  content: string;
  readOnly?: boolean;
  fileTraits?: FileTraitsDTO;
}

export interface OpenFileOptions {
  filePath: string;
  checkReadOnly?: boolean;
}

/**
 * 读取文件并处理内容
 * 主进程已完成归一化（BOM/CRLF）和图片路径处理
 */
export async function readAndProcessFile(options: OpenFileOptions): Promise<FileContent | null> {
  const { filePath, checkReadOnly = true } = options;

  try {
    // 1. 读取文件（主进程已归一化、处理图片路径并返回 fileTraits）
    const result = await window.electronAPI.readFileByPath(filePath);
    if (!result) {
      console.error("无法读取文件:", filePath);
      return null;
    }

    // 2. 获取且检查文件只读状态
    const readOnly = checkReadOnly ? await window.electronAPI.getIsReadOnly(filePath) : false;

    return {
      filePath: result.filePath,
      content: result.content,
      readOnly,
      fileTraits: result.fileTraits,
    };
  } catch (error) {
    console.error("读取和处理文件失败:", filePath, error);
    return null;
  }
}

/**
 * 从文件路径读取并创建Tab数据结构
 * 不包含添加到tabs列表的逻辑，仅创建Tab对象
 */
export function createTabDataFromFile(
  filePath: string,
  content: string,
  options: { fileTraits?: FileTraitsDTO } = {}
): Omit<Tab, "id"> {
  const { fileTraits } = options;

  const readOnly = false; // 默认值，调用处需要单独获取

  // 从路径中提取文件名
  const fileName = filePath.split(/[\\/]/).at(-1) || "Untitled";

  return {
    name: fileName,
    filePath,
    content,
    originalContent: content,
    isModified: false,
    scrollRatio: 0,
    readOnly,
    fileTraits,
  };
}

/**
 * 批量读取文件（用于启动时或拖拽多个文件）
 */
export async function readMultipleFiles(filePaths: string[]): Promise<FileContent[]> {
  const results = await Promise.allSettled(
    filePaths.map((fp) => readAndProcessFile({ filePath: fp }))
  );

  return results
    .filter((r): r is PromiseFulfilledResult<FileContent | null> => r.status === "fulfilled")
    .map((r) => r.value)
    .filter((r): r is FileContent => r !== null);
}
