/**
 * Milkup 语法检测插件
 *
 * 监听文档变化，检测并应用 Markdown 语法的 marks
 * 支持嵌套语法检测，如 ==**text**== 或 ***text***
 */

import { Plugin, PluginKey, Transaction } from "prosemirror-state";
import { Node, Mark, Schema } from "prosemirror-model";
import { decorationPluginKey } from "../decorations";

/** 插件 Key */
export const syntaxDetectorPluginKey = new PluginKey("milkup-syntax-detector");

/** 行内语法定义 */
interface InlineSyntax {
  type: string;
  pattern: RegExp;
  prefix: string | ((match: RegExpExecArray) => string);
  suffix: string | ((match: RegExpExecArray) => string);
  contentIndex: number;
  getAttrs?: (match: RegExpExecArray) => Record<string, any>;
  // 对于 strong_emphasis，需要应用多个 marks
  multiMarks?: string[];
}

/** 行内语法列表 - 按优先级排序 */
const INLINE_SYNTAXES: InlineSyntax[] = [
  // 粗斜体 ***text*** 或 ___text___
  {
    type: "strong_emphasis",
    pattern: /(\*\*\*|___)(.+?)\1/g,
    prefix: (m) => m[1],
    suffix: (m) => m[1],
    contentIndex: 2,
    multiMarks: ["strong", "emphasis"],
  },
  // 粗体 **text** 或 __text__
  {
    type: "strong",
    pattern: /(?<!\*)(\*\*)(?!\*)(.+?)(?<!\*)\1(?!\*)|(?<!_)(__)(?!_)(.+?)(?<!_)\1(?!_)/g,
    prefix: (m) => m[1] || m[3],
    suffix: (m) => m[1] || m[3],
    contentIndex: 2,
    getAttrs: (m) => ({}),
  },
  // 斜体 *text* 或 _text_
  // 注意：下划线在单词中间时不应该被视为斜体标记
  {
    type: "emphasis",
    pattern:
      /(?<![*_\w])(\*)(?![*\s])(.+?)(?<![*\s])\1(?![*])|(?<![*_])(_)(?![_\s])(?=\S)(.+?)(?<=\S)(?<![_\s])\3(?![_\w])/g,
    prefix: (m) => m[1] || m[3],
    suffix: (m) => m[1] || m[3],
    contentIndex: 2,
  },
  // 行内代码 `code`
  {
    type: "code_inline",
    pattern: /`([^`]+)`/g,
    prefix: "`",
    suffix: "`",
    contentIndex: 1,
  },
  // 删除线 ~~text~~
  {
    type: "strikethrough",
    pattern: /~~(.+?)~~/g,
    prefix: "~~",
    suffix: "~~",
    contentIndex: 1,
  },
  // 高亮 ==text==
  {
    type: "highlight",
    pattern: /==(.+?)==/g,
    prefix: "==",
    suffix: "==",
    contentIndex: 1,
  },
  // 链接 [text](url)
  {
    type: "link",
    pattern: /(?<!!)\[([^\]]+)\]\(([^)\s]*)(?:\s+"([^"]*)")?\)/g,
    prefix: "[",
    suffix: (m) => `](${m[2] || ""}${m[3] ? ` "${m[3]}"` : ""})`,
    contentIndex: 1,
    getAttrs: (m) => ({ href: m[2] || "", title: m[3] || "" }),
  },
  // 行内数学 $content$
  {
    type: "math_inline",
    pattern: /(?<!\$)\$(?!\$)([^$]+)\$(?!\$)/g,
    prefix: "$",
    suffix: "$",
    contentIndex: 1,
    getAttrs: (m) => ({ content: m[1] }),
  },
];

/** 转义正则 */
const ESCAPE_RE = /\\([\\`*_{}[\]()#+\-.!|~=$>])/g;

/** 匹配信息 */
interface MatchInfo {
  syntax: InlineSyntax;
  match: RegExpExecArray;
  start: number;
  end: number;
  prefix: string;
  suffix: string;
  content: string;
  contentStart: number;
  contentEnd: number;
  attrs?: Record<string, any>;
}

/**
 * 检测文本中的所有语法匹配
 */
function detectSyntaxMatches(text: string): MatchInfo[] {
  const matches: MatchInfo[] = [];

  // 收集所有转义范围
  const escapeRanges: Array<{ start: number; end: number }> = [];
  const escRe = new RegExp(ESCAPE_RE.source, "g");
  let escMatch: RegExpExecArray | null;
  while ((escMatch = escRe.exec(text)) !== null) {
    escapeRanges.push({ start: escMatch.index, end: escMatch.index + escMatch[0].length });
  }

  for (const syntax of INLINE_SYNTAXES) {
    const re = new RegExp(syntax.pattern.source, syntax.pattern.flags);
    let match: RegExpExecArray | null;

    while ((match = re.exec(text)) !== null) {
      const prefix = typeof syntax.prefix === "function" ? syntax.prefix(match) : syntax.prefix;
      const suffix = typeof syntax.suffix === "function" ? syntax.suffix(match) : syntax.suffix;
      const content = match[syntax.contentIndex] || match[syntax.contentIndex + 2] || "";

      const start = match.index;
      const end = start + match[0].length;
      const contentStart = start + prefix.length;
      const contentEnd = end - suffix.length;

      // 跳过与转义范围重叠的匹配
      const overlapsEscape = escapeRanges.some((esc) => esc.start < end && esc.end > start);
      if (overlapsEscape) continue;

      matches.push({
        syntax,
        match,
        start,
        end,
        prefix,
        suffix,
        content,
        contentStart,
        contentEnd,
        attrs: syntax.getAttrs?.(match),
      });
    }
  }

  // 按位置排序，相同起点时更长的优先
  matches.sort((a, b) => {
    if (a.start !== b.start) return a.start - b.start;
    return b.end - a.end;
  });

  // 过滤完全重叠的匹配（保留外层）
  const filtered: MatchInfo[] = [];
  let lastEnd = 0;
  for (const m of matches) {
    if (m.start >= lastEnd) {
      filtered.push(m);
      lastEnd = m.end;
    }
  }

  return filtered;
}

/**
 * 检测文本片段中的转义序列，生成区域标记
 */
function detectEscapeRegions(
  text: string,
  baseOffset: number,
  inheritedTypes: string[]
): Array<{
  from: number;
  to: number;
  markTypes: string[];
  isSyntax: boolean;
  isEscape?: boolean;
  attrs?: Record<string, any>;
}> {
  const results: Array<{
    from: number;
    to: number;
    markTypes: string[];
    isSyntax: boolean;
    isEscape?: boolean;
    attrs?: Record<string, any>;
  }> = [];

  const escRe = new RegExp(ESCAPE_RE.source, "g");
  let escMatch: RegExpExecArray | null;
  let pos = 0;
  let hasAnyEscape = false;

  while ((escMatch = escRe.exec(text)) !== null) {
    hasAnyEscape = true;

    // 转义之前的普通文本
    if (escMatch.index > pos) {
      results.push({
        from: baseOffset + pos,
        to: baseOffset + escMatch.index,
        markTypes: inheritedTypes,
        isSyntax: false,
      });
    }

    // `\` 字符 → escape 类型的 syntax_marker
    results.push({
      from: baseOffset + escMatch.index,
      to: baseOffset + escMatch.index + 1,
      markTypes: inheritedTypes,
      isSyntax: true,
      isEscape: true,
    });

    // 被转义的字符 → 普通文本（只带 inheritedTypes）
    results.push({
      from: baseOffset + escMatch.index + 1,
      to: baseOffset + escMatch.index + 2,
      markTypes: inheritedTypes,
      isSyntax: false,
    });

    pos = escMatch.index + 2;
  }

  // 没有转义序列，返回空数组
  if (!hasAnyEscape) return results;

  // 剩余文本
  if (pos < text.length) {
    results.push({
      from: baseOffset + pos,
      to: baseOffset + text.length,
      markTypes: inheritedTypes,
      isSyntax: false,
    });
  }

  return results;
}

/**
 * 递归检测嵌套语法
 */
function detectNestedSyntax(
  text: string,
  baseOffset: number,
  inheritedTypes: string[]
): Array<{
  from: number;
  to: number;
  markTypes: string[];
  isSyntax: boolean;
  isEscape?: boolean;
  attrs?: Record<string, any>;
}> {
  const results: Array<{
    from: number;
    to: number;
    markTypes: string[];
    isSyntax: boolean;
    isEscape?: boolean;
    attrs?: Record<string, any>;
  }> = [];

  const matches = detectSyntaxMatches(text);

  // 检查文本中是否有转义序列
  const hasEscapes = ESCAPE_RE.test(text);
  // 重置 lastIndex
  ESCAPE_RE.lastIndex = 0;

  if (matches.length === 0) {
    // 没有语法匹配，检查是否有转义序列
    if (text.length > 0 && hasEscapes) {
      const escRegions = detectEscapeRegions(text, baseOffset, inheritedTypes);
      if (escRegions.length > 0) {
        results.push(...escRegions);
        return results;
      }
    }
    if (text.length > 0 && inheritedTypes.length > 0) {
      results.push({
        from: baseOffset,
        to: baseOffset + text.length,
        markTypes: inheritedTypes,
        isSyntax: false,
      });
    }
    return results;
  }

  let pos = 0;
  for (const m of matches) {
    // 前面的纯文本（可能包含转义）
    if (m.start > pos) {
      const plainText = text.slice(pos, m.start);
      const escRegions = detectEscapeRegions(plainText, baseOffset + pos, inheritedTypes);
      if (escRegions.length > 0) {
        results.push(...escRegions);
      } else if (plainText.length > 0 && inheritedTypes.length > 0) {
        results.push({
          from: baseOffset + pos,
          to: baseOffset + m.start,
          markTypes: inheritedTypes,
          isSyntax: false,
        });
      }
    }

    // 当前语法的 mark 类型
    const currentTypes = m.syntax.multiMarks || [m.syntax.type];
    const allTypes = [...inheritedTypes, ...currentTypes];

    // 前缀（语法标记）
    results.push({
      from: baseOffset + m.start,
      to: baseOffset + m.contentStart,
      markTypes: allTypes,
      isSyntax: true,
      attrs: m.attrs,
    });

    // 递归处理内容
    const innerResults = detectNestedSyntax(m.content, baseOffset + m.contentStart, allTypes);
    if (innerResults.length > 0) {
      results.push(...innerResults);
    } else if (m.content.length > 0) {
      // 没有嵌套语法，直接添加内容
      results.push({
        from: baseOffset + m.contentStart,
        to: baseOffset + m.contentEnd,
        markTypes: allTypes,
        isSyntax: false,
        attrs: m.attrs,
      });
    }

    // 后缀（语法标记）
    results.push({
      from: baseOffset + m.contentEnd,
      to: baseOffset + m.end,
      markTypes: allTypes,
      isSyntax: true,
      attrs: m.attrs,
    });

    pos = m.end;
  }

  // 剩余文本（可能包含转义）
  if (pos < text.length) {
    const remainingText = text.slice(pos);
    const escRegions = detectEscapeRegions(remainingText, baseOffset + pos, inheritedTypes);
    if (escRegions.length > 0) {
      results.push(...escRegions);
    } else if (remainingText.length > 0 && inheritedTypes.length > 0) {
      results.push({
        from: baseOffset + pos,
        to: baseOffset + text.length,
        markTypes: inheritedTypes,
        isSyntax: false,
      });
    }
  }

  return results;
}

/**
 * 检查节点是否已经有正确的 marks
 * 改进版：更精确地比较当前 marks 和期望的 marks
 */
function hasCorrectMarks(
  node: Node,
  basePos: number,
  regions: ReturnType<typeof detectNestedSyntax>
): boolean {
  if (regions.length === 0) {
    // 如果没有期望的区域，检查是否有任何语义 marks
    let hasAnySemanticMarks = false;
    node.forEach((child) => {
      if (child.isText) {
        const semanticMarks = child.marks.filter(
          (m) =>
            m.type.name !== "syntax_marker" &&
            [
              "strong",
              "emphasis",
              "code_inline",
              "strikethrough",
              "highlight",
              "link",
              "math_inline",
            ].includes(m.type.name)
        );
        if (semanticMarks.length > 0) {
          hasAnySemanticMarks = true;
        }
      }
    });
    return !hasAnySemanticMarks;
  }

  // 构建期望的 marks 映射：position -> expected mark types
  const expectedMarks = new Map<number, Set<string>>();
  for (const region of regions) {
    for (let pos = region.from; pos < region.to; pos++) {
      if (!expectedMarks.has(pos)) {
        expectedMarks.set(pos, new Set());
      }
      for (const markType of region.markTypes) {
        if (markType !== "strong_emphasis") {
          expectedMarks.get(pos)!.add(markType);
        }
      }
      // 添加 syntax_marker
      if (region.isSyntax) {
        expectedMarks.get(pos)!.add("syntax_marker");
      }
    }
  }

  // 检查实际的 marks 是否与期望一致
  let offset = 0;
  let allMatch = true;

  node.forEach((child) => {
    if (child.isText && allMatch) {
      const childStart = basePos + offset;
      const childEnd = childStart + child.nodeSize;

      for (let pos = childStart; pos < childEnd; pos++) {
        const expected = expectedMarks.get(pos) || new Set();
        const actual = new Set(
          child.marks
            .filter((m) =>
              [
                "strong",
                "emphasis",
                "code_inline",
                "strikethrough",
                "highlight",
                "link",
                "math_inline",
                "syntax_marker",
              ].includes(m.type.name)
            )
            .map((m) => m.type.name)
        );

        // 比较期望和实际的 marks
        if (expected.size !== actual.size) {
          allMatch = false;
          break;
        }

        for (const markType of expected) {
          if (!actual.has(markType)) {
            allMatch = false;
            break;
          }
        }

        if (!allMatch) break;
      }
    }
    offset += child.nodeSize;
  });

  return allMatch;
}

/**
 * 创建语法检测插件
 */
export function createSyntaxDetectorPlugin(): Plugin {
  return new Plugin({
    key: syntaxDetectorPluginKey,

    appendTransaction(transactions, oldState, newState) {
      // 只在文档变化时处理
      const docChanged = transactions.some((tr) => tr.docChanged);
      if (!docChanged) return null;

      // 跳过语法插件自身产生的 transaction，避免循环
      if (transactions.some((tr) => tr.getMeta("syntax-plugin-internal"))) return null;

      const schema = newState.schema;
      let tr = newState.tr;
      tr = tr.setMeta("syntax-plugin-internal", true);
      let hasChanges = false;

      // 遍历所有文本块（跳过代码块/数学块等，其内容不参与语法解析）
      newState.doc.descendants((node, pos) => {
        if (node.isTextblock && !node.type.spec.code) {
          // 跳过源码视图中由代码块拆分出的段落，不做任何语法检测
          if (node.attrs.codeBlockId) return true;

          const textContent = node.textContent;
          const basePos = pos + 1;

          // 检测所有语法区域
          const regions = detectNestedSyntax(textContent, basePos, []);

          if (regions.length === 0) return true;

          // 检查是否需要更新
          if (hasCorrectMarks(node, basePos, regions)) return true;

          // 应用 marks
          for (const region of regions) {
            // 移除该区域的所有语义 marks 和 syntax_marker（重新应用）
            const markTypesToRemove = [
              "strong",
              "emphasis",
              "code_inline",
              "strikethrough",
              "highlight",
              "link",
              "math_inline",
              "syntax_marker", // 也移除 syntax_marker，避免旧标记残留
            ];
            for (const markTypeName of markTypesToRemove) {
              const markType = schema.marks[markTypeName];
              if (markType) {
                tr = tr.removeMark(region.from, region.to, markType);
              }
            }

            // 添加新的 marks
            for (const markTypeName of region.markTypes) {
              if (markTypeName === "strong_emphasis") continue; // 跳过复合类型

              const markType = schema.marks[markTypeName];
              if (markType) {
                const mark = markType.create(region.attrs);
                tr = tr.addMark(region.from, region.to, mark);
              }
            }

            // 添加 syntax_marker
            if (region.isSyntax) {
              const syntaxMarkerType = schema.marks.syntax_marker;
              if (syntaxMarkerType) {
                // escape 类型使用 "escape" 作为 syntaxType
                const syntaxType = (region as any).isEscape
                  ? "escape"
                  : region.markTypes[region.markTypes.length - 1] || "unknown";
                const syntaxMark = syntaxMarkerType.create({ syntaxType });
                tr = tr.addMark(region.from, region.to, syntaxMark);
              }
            }

            hasChanges = true;
          }
        }
        return true;
      });

      // 检测图片语法并转换为图片节点（源码模式下跳过，避免与 source-view-transform 插件循环）
      const decoState = decorationPluginKey.getState(newState);
      const isSourceView = decoState?.sourceView ?? false;
      if (!isSourceView) {
        const imagePattern = /!\[([^\]]*)\]\((.+?)(?:\s+"([^"]*)")?\)/g;
        const imagesToReplace: Array<{
          from: number;
          to: number;
          alt: string;
          src: string;
          title: string;
        }> = [];

        newState.doc.descendants((node, pos) => {
          if (node.isTextblock && !node.type.spec.code) {
            const textContent = node.textContent;
            const basePos = pos + 1;

            let match;
            while ((match = imagePattern.exec(textContent)) !== null) {
              const from = basePos + match.index;
              const to = from + match[0].length;
              const alt = match[1] || "";
              const src = match[2] || "";
              const title = match[3] || "";

              // 检查这个位置是否已经是图片节点
              const $from = tr.doc.resolve(from);
              if ($from.parent.type.name !== "image") {
                imagesToReplace.push({ from, to, alt, src, title });
              }
            }
          }
          return true;
        });

        // 从后往前替换，避免位置偏移
        const imageNodeType = schema.nodes.image;
        if (imageNodeType && imagesToReplace.length > 0) {
          imagesToReplace.sort((a, b) => b.from - a.from);
          for (const img of imagesToReplace) {
            const imageNode = imageNodeType.create({
              src: img.src,
              alt: img.alt,
              title: img.title,
            });
            tr = tr.replaceWith(img.from, img.to, imageNode);
            hasChanges = true;
          }
        }
      } // end if (!isSourceView)

      return hasChanges ? tr : null;
    },
  });
}
