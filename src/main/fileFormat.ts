/**
 * 文件格式检测与还原工具
 * 在主进程中使用，确保渲染层不需要关心文件原始格式
 */

export interface FileTraits {
  hasBOM: boolean;
  lineEnding: "crlf" | "lf";
  hasTrailingNewline: boolean;
}

/**
 * 从原始文件内容检测格式特征
 */
export function detectFileTraits(raw: string): FileTraits {
  return {
    hasBOM: raw.startsWith("\uFEFF"),
    lineEnding: raw.includes("\r\n") ? "crlf" : "lf",
    hasTrailingNewline: raw.endsWith("\n"),
  };
}

/**
 * 根据 FileTraits 还原文件原始格式（写入前调用）
 */
export function restoreFileTraits(content: string, traits?: FileTraits): string {
  if (!traits) return content;

  let result = content;

  // 还原换行符（编辑器内部统一用 LF，需要还原为 CRLF）
  if (traits.lineEnding === "crlf") {
    result = result.replace(/\n/g, "\r\n");
  }

  // 还原末尾换行
  if (traits.hasTrailingNewline) {
    const eol = traits.lineEnding === "crlf" ? "\r\n" : "\n";
    if (!result.endsWith(eol)) {
      result += eol;
    }
  } else {
    // 原文件无末尾换行，移除可能被编辑器添加的
    while (result.endsWith("\r\n")) result = result.slice(0, -2);
    while (result.endsWith("\n")) result = result.slice(0, -1);
  }

  // 还原 BOM
  if (traits.hasBOM) {
    result = `\uFEFF${result}`;
  }

  return result;
}

/**
 * 归一化 Markdown 文本（读取后调用）
 * 移除 BOM，CRLF → LF，编辑器内部统一使用 LF
 */
export function normalizeMarkdown(text: string): string {
  return text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
}

/**
 * Node.js 环境的 base64 编码（与渲染进程 btoa+encodeURIComponent 结果一致）
 */
function encodeBase64(str: string): string {
  return Buffer.from(
    encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, (_, p1) =>
      String.fromCharCode(Number.parseInt(p1, 16))
    ),
    "binary"
  ).toString("base64");
}

/**
 * 检查是否为绝对路径
 */
function isAbsolutePath(filePath: string): boolean {
  return /^(?:[a-z]:[\\/]|\\\\|\/)/i.test(filePath);
}

/**
 * 将相对路径转换为自定义协议 URL
 */
function convertToProtocolUrl(imagePath: string, base64Path: string): string | null {
  if (
    imagePath.startsWith("http://") ||
    imagePath.startsWith("https://") ||
    imagePath.startsWith("file://") ||
    imagePath.startsWith("data:") ||
    imagePath.startsWith("milkup://") ||
    isAbsolutePath(imagePath)
  ) {
    return null;
  }
  return `milkup:///${base64Path}/${imagePath}`;
}

/**
 * 处理 Markdown 中的图片路径（主进程版本）
 * 将相对路径转换为 milkup:// 协议 URL
 */
export function processImagePaths(
  markdownContent: string,
  markdownFilePath: string | null
): string {
  if (!markdownFilePath) {
    return markdownContent;
  }

  const base64Path = encodeBase64(markdownFilePath);
  let processedContent = markdownContent;

  // 1. 处理 Markdown 图片语法: ![alt](path)
  const markdownImageRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
  processedContent = processedContent.replace(markdownImageRegex, (match, alt, imagePath) => {
    const convertedPath = convertToProtocolUrl(imagePath, base64Path);
    return convertedPath ? `![${alt}](${convertedPath})` : match;
  });

  // 2. 处理 HTML img 标签: <img src="path" />
  const htmlImageRegex = /<img\s([^>]*?)src=(["'])([^"']+)\2([^>]*)>/gi;
  processedContent = processedContent.replace(
    htmlImageRegex,
    (match, before, quote, imagePath, after) => {
      const convertedPath = convertToProtocolUrl(imagePath, base64Path);
      if (!convertedPath) return match;
      return `<img ${before}src=${quote}${convertedPath}${quote}${after}>`;
    }
  );

  return processedContent;
}
