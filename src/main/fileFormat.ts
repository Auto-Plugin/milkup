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
 * 从 milkup:// URL 中提取原始相对路径
 * 旧 URL 格式: base64path/relativePath 或 base64path/./relativePath
 */
function extractRelativePath(urlContent: string): string | null {
  // Case 1: base64 以 = 结尾（有 padding），=/relative 或 ==/relative
  const paddingMatch = urlContent.match(/^[A-Za-z0-9+/]+=+\/(.+)$/);
  if (paddingMatch) return paddingMatch[1];

  // Case 2: 相对路径以 ./ 开头，找 /./ 边界
  const dotSlashIndex = urlContent.indexOf("/./");
  if (dotSlashIndex !== -1) {
    return urlContent.substring(dotSlashIndex + 1);
  }

  // Case 3: 回退 — 取最后一个 / 后面的部分（如果看起来像文件名）
  const lastSlash = urlContent.lastIndexOf("/");
  if (lastSlash > 0) {
    const possibleRelative = urlContent.substring(lastSlash + 1);
    if (/\.\w+$/.test(possibleRelative)) {
      return possibleRelative;
    }
  }

  return null;
}

/**
 * 清理文件中残留的 milkup:// 协议 URL（旧版本可能将其写入文件）
 * 将 milkup:// URL 还原为原始相对路径
 */
export function cleanupProtocolUrls(content: string): string {
  let result = content;

  // Markdown 图片: ![alt](milkup://...relative) → ![alt](relative)
  result = result.replace(/!\[([^\]]*)\]\(milkup:\/\/\/?([^)]+)\)/g, (match, alt, urlContent) => {
    const relative = extractRelativePath(urlContent);
    return relative ? `![${alt}](${relative})` : match;
  });

  // HTML img: <img src="milkup://...relative" />
  result = result.replace(
    /<img(\s[^>]*?)src=(["'])milkup:\/\/\/?([^"']+)\2([^>]*)>/gi,
    (match, before, quote, urlContent, after) => {
      const relative = extractRelativePath(urlContent);
      return relative ? `<img${before}src=${quote}${relative}${quote}${after}>` : match;
    }
  );

  return result;
}
