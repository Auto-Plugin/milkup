import * as fs from "node:fs";
import path from "node:path";
import { cleanupProtocolUrls, detectFileTraits, normalizeMarkdown } from "./fileFormat";

function stripWrappingQuotes(inputPath: string): string {
  if (
    (inputPath.startsWith('"') && inputPath.endsWith('"')) ||
    (inputPath.startsWith("'") && inputPath.endsWith("'"))
  ) {
    return inputPath.slice(1, -1);
  }

  return inputPath;
}

function trimTrailingSeparators(inputPath: string): string {
  let normalizedPath = inputPath;

  while (
    normalizedPath.length > 1 &&
    /[\\/]/.test(normalizedPath.at(-1) || "") &&
    path.dirname(normalizedPath) !== normalizedPath
  ) {
    normalizedPath = normalizedPath.slice(0, -1);
  }

  return normalizedPath;
}

export function normalizeMarkdownFilePath(inputPath: string): string {
  return trimTrailingSeparators(stripWrappingQuotes(inputPath.trim()));
}

export function isMarkdownFilePath(inputPath: string): boolean {
  const normalizedPath = normalizeMarkdownFilePath(inputPath);
  return /\.(?:md|markdown)$/i.test(path.basename(normalizedPath));
}

export function readMarkdownFile(filePath: string) {
  const normalizedPath = normalizeMarkdownFilePath(filePath);

  if (!normalizedPath || !isMarkdownFilePath(normalizedPath)) {
    return null;
  }

  if (!fs.existsSync(normalizedPath)) {
    return null;
  }

  let stats: fs.Stats;
  try {
    stats = fs.statSync(normalizedPath);
  } catch {
    return null;
  }

  if (!stats.isFile()) {
    return null;
  }

  const raw = fs.readFileSync(normalizedPath, "utf-8");
  const fileTraits = detectFileTraits(raw);
  const content = cleanupProtocolUrls(normalizeMarkdown(raw), normalizedPath);

  return {
    filePath: normalizedPath,
    content,
    fileTraits,
  };
}
