function dirname(filePath: string): string {
  const sep = filePath.includes("\\") ? "\\" : "/";
  const lastIndex = filePath.lastIndexOf(sep);
  return lastIndex === -1 ? "." : filePath.substring(0, lastIndex);
}

function joinPath(dir: string, relative: string): string {
  const sep = dir.includes("\\") ? "\\" : "/";
  let rel = relative;
  while (rel.startsWith("./") || rel.startsWith(".\\")) {
    rel = rel.substring(2);
  }
  while (rel.startsWith("/") || rel.startsWith("\\")) {
    rel = rel.substring(1);
  }
  return (dir + sep + rel).replace(/\\/g, "/");
}

function isAbsoluteLocalPath(src: string): boolean {
  if (!src) return false;

  const platform = (window as any).electronAPI?.platform;
  if (platform === "win32") {
    return /^[a-z]:[\\/]/i.test(src) || /^\\\\[^\\]/.test(src);
  }

  return src.startsWith("/");
}

function toFileUrl(src: string): string {
  const normalized = src.replace(/\\/g, "/");

  if (/^\/\/[^/]/.test(normalized)) {
    return `file:${normalized}`;
  }

  if (/^[a-z]:\//i.test(normalized)) {
    return `file:///${normalized}`;
  }

  return `file://${normalized}`;
}

export function resolveImageSrc(src: string): string {
  if (!src) return src;

  if (
    src.startsWith("http://") ||
    src.startsWith("https://") ||
    src.startsWith("file://") ||
    src.startsWith("data:") ||
    src.startsWith("milkup://")
  ) {
    return src;
  }

  if (isAbsoluteLocalPath(src)) {
    return toFileUrl(src);
  }

  const currentFilePath = (window as any).__currentFilePath;
  if (!currentFilePath) return src;

  const absolutePath = joinPath(dirname(currentFilePath), src);
  return "file:///" + absolutePath;
}
