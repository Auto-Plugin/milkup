/**
 * 修复未闭合的代码块
 */
export function fixUnclosedCodeBlock(markdown: string): string {
  const count = (markdown.match(/```/g) || []).length;
  if (count % 2 !== 0) {
    console.warn("[Milkdown] 检测到未闭合的代码块，已自动补全。");
    return `${markdown}\n\`\`\``;
  }
  return markdown;
}

/**
 * 规范化 Markdown 文本
 * 处理 BOM 和换行符，编辑器内部统一使用 LF
 */
export function normalizeMarkdown(text: string): string {
  return (
    text
      // 移除 BOM
      .replace(/^\uFEFF/, "")
      // 替换 CRLF → LF
      .replace(/\r\n/g, "\n")
  );
}
