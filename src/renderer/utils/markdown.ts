export function normalizeMarkdownForDirtyCheck(content: string): string {
  return content.replace(/(?:\r?\n(?:[ \t]*\r?\n)*)[ \t]*$/u, "");
}
