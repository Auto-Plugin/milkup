const INVALID_FILE_NAME_CHARS = new Set(["<", ">", ":", '"', "/", "\\", "|", "?", "*"]);
const RESERVED_WINDOWS_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const MAX_TITLE_FILE_NAME_LENGTH = 80;
const FALLBACK_CONTENT_LENGTH = 15;

function takeChars(value: string, maxLength: number): string {
  return Array.from(value).slice(0, maxLength).join("");
}

function sanitizeFileNameBase(value: string): string {
  const sanitized = value
    .split("")
    .map((char) => (INVALID_FILE_NAME_CHARS.has(char) || char.charCodeAt(0) < 32 ? " " : char))
    .join("")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, "");

  if (!sanitized || RESERVED_WINDOWS_NAMES.test(sanitized)) return "Untitled";
  return sanitized;
}

function extractFirstHeading(content: string): string | null {
  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/);
    const title = match?.[1]?.trim();
    if (title) return title;
  }
  return null;
}

function ensureMarkdownExtension(fileNameBase: string): string {
  return /\.(md|markdown)$/i.test(fileNameBase) ? fileNameBase : `${fileNameBase}.md`;
}

export function createDefaultMarkdownFileName(content: string): string {
  const firstHeading = extractFirstHeading(content);
  const source =
    firstHeading ?? takeChars(content.replace(/\s+/g, " ").trim(), FALLBACK_CONTENT_LENGTH);
  const limited = firstHeading ? takeChars(source, MAX_TITLE_FILE_NAME_LENGTH) : source;
  return ensureMarkdownExtension(sanitizeFileNameBase(limited));
}
