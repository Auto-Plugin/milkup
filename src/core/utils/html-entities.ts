import { decode as decodeHtml } from "he";

export const HTML_ENTITY_SYNTAX_TYPE = "html_entity";

const COMMON_ENTITIES: Record<string, string> = {
  lt: "<",
  gt: ">",
  amp: "&",
  quot: '"',
  apos: "'",
  nbsp: "\u00a0",
};

const HTML_ENTITY_PATTERN =
  /&(?:#[0-9]{1,7};?|#[xX][0-9a-fA-F]{1,6};?|[A-Za-z][A-Za-z0-9]{1,31};|(?:lt|gt|amp|quot|apos|nbsp)(?![A-Za-z0-9]))/g;

export interface HtmlEntityMatch {
  from: number;
  to: number;
  source: string;
  decoded: string;
}

export function decodeHtmlEntity(entity: string): string | null {
  const commonMatch = entity.match(/^&([a-z]+);?$/);
  if (commonMatch && COMMON_ENTITIES[commonMatch[1]]) {
    return COMMON_ENTITIES[commonMatch[1]];
  }

  const decimalMatch = entity.match(/^&#([0-9]{1,7});?$/);
  if (decimalMatch) {
    return decodeCodePoint(Number.parseInt(decimalMatch[1], 10));
  }

  const hexMatch = entity.match(/^&#[xX]([0-9a-fA-F]{1,6});?$/);
  if (hexMatch) {
    return decodeCodePoint(Number.parseInt(hexMatch[1], 16));
  }

  if (!entity.endsWith(";")) return null;

  try {
    const decoded = decodeHtml(entity, { strict: true });
    return decoded === entity ? null : decoded;
  } catch {
    return null;
  }
}

export function findHtmlEntityMatches(text: string): HtmlEntityMatch[] {
  const matches: HtmlEntityMatch[] = [];
  const entityRe = new RegExp(HTML_ENTITY_PATTERN.source, "g");
  let match: RegExpExecArray | null;

  while ((match = entityRe.exec(text)) !== null) {
    const source = match[0];
    const decoded = decodeHtmlEntity(source);
    if (!decoded) continue;

    matches.push({
      from: match.index,
      to: match.index + source.length,
      source,
      decoded,
    });
  }

  return matches;
}

function decodeCodePoint(codePoint: number): string | null {
  if (!Number.isFinite(codePoint) || codePoint <= 0 || codePoint > 0x10ffff) return null;
  if (codePoint >= 0xd800 && codePoint <= 0xdfff) return null;

  try {
    return String.fromCodePoint(codePoint);
  } catch {
    return null;
  }
}
