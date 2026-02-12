/**
 * Milkup Markdown 解析器 v2
 *
 * 核心改进：保留语法标记作为文本内容
 * 文档结构示例：对于 "这是**粗体**文本"
 *
 * paragraph
 *   └─ text "这是"
 *   └─ text "**" [syntax_open, strong_syntax]
 *   └─ text "粗体" [strong]
 *   └─ text "**" [syntax_close, strong_syntax]
 *   └─ text "文本"
 *
 * 这样光标可以在语法标记内自由移动
 */

import { Node, Schema, Mark } from "prosemirror-model";
import { milkupSchema } from "../schema";
import type { SyntaxMarker, SyntaxType } from "../types";

/** 解析结果 */
export interface ParseResult {
  doc: Node;
  markers: SyntaxMarker[];
}

/** 行内语法定义 */
interface InlineSyntax {
  type: string;
  pattern: RegExp;
  prefix: string | ((match: RegExpExecArray) => string);
  suffix: string | ((match: RegExpExecArray) => string);
  contentIndex: number;
  getAttrs?: (match: RegExpExecArray) => Record<string, any>;
}

/** 行内语法列表 - 按优先级排序 */
const INLINE_SYNTAXES: InlineSyntax[] = [
  // 粗斜体 ***text*** 或 ___text___ - 必须在 strong 和 emphasis 之前
  {
    type: "strong_emphasis",
    pattern: /(\*\*\*|___)(.+?)\1/g,
    prefix: (m) => m[1],
    suffix: (m) => m[1],
    contentIndex: 2,
  },
  // 粗体 **text** 或 __text__ - 排除 *** 的情况
  {
    type: "strong",
    pattern: /(?<!\*)(\*\*)(?!\*)(.+?)(?<!\*)\1(?!\*)|(?<!_)(__)(?!_)(.+?)(?<!_)\1(?!_)/g,
    prefix: (m) => m[1] || m[3],
    suffix: (m) => m[1] || m[3],
    contentIndex: 2,
  },
  {
    type: "emphasis",
    pattern:
      /(?<![*_\w])(\*)(?![*\s])(.+?)(?<![*\s])\1(?![*])|(?<![*_])(_)(?![_\s])(?=\S)(.+?)(?<=\S)(?<![_\s])\3(?![_\w])/g,
    prefix: (m) => m[1] || m[3],
    suffix: (m) => m[1] || m[3],
    contentIndex: 2,
  },
  {
    type: "code_inline",
    pattern: /`([^`]+)`/g,
    prefix: "`",
    suffix: "`",
    contentIndex: 1,
  },
  {
    type: "strikethrough",
    pattern: /~~(.+?)~~/g,
    prefix: "~~",
    suffix: "~~",
    contentIndex: 1,
  },
  {
    type: "highlight",
    pattern: /==(.+?)==/g,
    prefix: "==",
    suffix: "==",
    contentIndex: 1,
  },
  {
    type: "link",
    pattern: /(?<!!)\[([^\]]+)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g,
    prefix: "[",
    suffix: (m) => `](${m[2]}${m[3] ? ` "${m[3]}"` : ""})`,
    contentIndex: 1,
    getAttrs: (m) => ({ href: m[2], title: m[3] || "" }),
  },
  {
    type: "math_inline",
    pattern: /(?<!\$)\$(?!\$)([^$]+)\$(?!\$)/g, // 排除 $$ 的情况
    prefix: "$",
    suffix: "$",
    contentIndex: 1,
    getAttrs: (m) => ({ content: m[1] }),
  },
];

/** 块级语法模式 */
const BLOCK_PATTERNS = {
  heading: /^(#{1,6})\s+(.*)$/,
  code_block_start: /^```([^\s`]*)(.*)$/, // 允许语言标识后跟任意属性（如 {linenos=1}）
  code_block_end: /^\s*```\s*$/, // 允许前导空格和行尾空格
  blockquote: /^>\s?(.*)$/,
  bullet_list: /^(\s*)([-*+])\s+(.*)$/,
  ordered_list: /^(\s*)(\d+)\.\s+(.*)$/,
  task_item: /^(\s*)[-*+]\s+\[([ xX]?)\]\s+(.*)$/,
  horizontal_rule: /^([-*_]){3,}\s*$/, // 允许行尾有空格
  table_row: /^\|(.+)\|\s*$/,
  table_separator: /^\|[-:\s|]+\|\s*$/,
  math_block_start: /^\$\$\s*$/, // 多行数学块开始
  math_block_end: /^\$\$\s*$/, // 多行数学块结束
  math_block_inline: /^\$\$(.+)\$\$$/, // 单行数学块 $$content$$
  image: /^!\[([^\]]*)\]\((.+?)(?:\s+"([^"]*)")?\)\s*$/, // 图片 ![alt](src "title") - 允许 URL 中有空格
  container_start: /^:::(\w+)(?:\s+(.*))?$/,
  container_end: /^:::\s*$/, // 允许行尾有空格
  html_block_start: /^<([a-zA-Z][a-zA-Z0-9]*)/, // 以 < 开头后跟标签名
};

/**
 * Markdown 解析器类
 */
export class MarkdownParser {
  private schema: Schema;
  private markers: SyntaxMarker[] = [];

  constructor(schema: Schema = milkupSchema) {
    this.schema = schema;
  }

  /**
   * 解析 Markdown 文本
   */
  parse(markdown: string): ParseResult {
    this.markers = [];

    // 统一换行符，移除 \r
    const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
    const blocks = this.parseBlocks(lines);

    const content = blocks.length > 0 ? blocks : [this.schema.node("paragraph")];
    const doc = this.schema.node("doc", null, content);

    return { doc, markers: this.markers };
  }

  /**
   * 解析块级元素
   */
  private parseBlocks(lines: string[]): Node[] {
    const blocks: Node[] = [];
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];

      if (line.trim() === "") {
        i++;
        continue;
      }

      // 代码块（只有闭合的代码块才解析为 code_block 节点）
      const codeMatch = line.match(BLOCK_PATTERNS.code_block_start);
      if (codeMatch) {
        const result = this.parseCodeBlock(lines, i);
        if (result) {
          blocks.push(result.node);
          i = result.endIndex + 1;
          continue;
        }
        // 未闭合的代码块，当作普通段落处理
      }

      // 单行数学块 $$content$$
      const mathInlineMatch = line.match(BLOCK_PATTERNS.math_block_inline);
      if (mathInlineMatch) {
        const content = mathInlineMatch[1];
        const textNode = content ? this.schema.text(content) : null;
        blocks.push(this.schema.node("math_block", {}, textNode ? [textNode] : []));
        i++;
        continue;
      }

      // 多行数学块
      if (BLOCK_PATTERNS.math_block_start.test(line)) {
        const result = this.parseMathBlock(lines, i);
        blocks.push(result.node);
        i = result.endIndex + 1;
        continue;
      }

      // 容器
      const containerMatch = line.match(BLOCK_PATTERNS.container_start);
      if (containerMatch) {
        const result = this.parseContainer(lines, i);
        blocks.push(result.node);
        i = result.endIndex + 1;
        continue;
      }

      // 标题
      const headingMatch = line.match(BLOCK_PATTERNS.heading);
      if (headingMatch) {
        blocks.push(this.parseHeading(headingMatch));
        i++;
        continue;
      }

      // 图片
      const imageMatch = line.match(BLOCK_PATTERNS.image);
      if (imageMatch) {
        blocks.push(this.parseImage(imageMatch));
        i++;
        continue;
      }

      // 分隔线
      if (BLOCK_PATTERNS.horizontal_rule.test(line)) {
        blocks.push(this.schema.node("horizontal_rule"));
        i++;
        continue;
      }

      // 引用
      if (BLOCK_PATTERNS.blockquote.test(line)) {
        const result = this.parseBlockquote(lines, i);
        blocks.push(result.node);
        i = result.endIndex + 1;
        continue;
      }

      // 任务列表
      if (BLOCK_PATTERNS.task_item.test(line)) {
        const result = this.parseTaskList(lines, i);
        blocks.push(result.node);
        i = result.endIndex + 1;
        continue;
      }

      // 无序列表
      if (BLOCK_PATTERNS.bullet_list.test(line)) {
        const result = this.parseBulletList(lines, i);
        blocks.push(result.node);
        i = result.endIndex + 1;
        continue;
      }

      // 有序列表
      if (BLOCK_PATTERNS.ordered_list.test(line)) {
        const result = this.parseOrderedList(lines, i);
        blocks.push(result.node);
        i = result.endIndex + 1;
        continue;
      }

      // 表格
      if (BLOCK_PATTERNS.table_row.test(line)) {
        const result = this.parseTable(lines, i);
        if (result) {
          blocks.push(result.node);
          i = result.endIndex + 1;
          continue;
        }
      }

      // HTML 块
      const htmlMatch = line.match(BLOCK_PATTERNS.html_block_start);
      if (htmlMatch) {
        const result = this.parseHtmlBlock(lines, i);
        blocks.push(result.node);
        i = result.endIndex + 1;
        continue;
      }

      // 段落
      blocks.push(this.parseParagraph(line));
      i++;
    }

    return blocks;
  }

  /**
   * 解析标题 - 保留 # 标记
   */
  private parseHeading(match: RegExpMatchArray): Node {
    const hashes = match[1];
    const content = match[2];
    const level = hashes.length;

    const nodes: Node[] = [];

    // 添加 # 标记作为文本（带 syntax mark），空格单独作为普通文本
    const syntaxMark = this.schema.marks.syntax_marker?.create({ syntaxType: "heading" });
    if (syntaxMark) {
      nodes.push(this.schema.text(hashes, [syntaxMark]));
      nodes.push(this.schema.text(" "));
    }

    // 添加内容
    const inlineNodes = this.parseInlineWithSyntax(content);
    nodes.push(...inlineNodes);

    return this.schema.node("heading", { level }, nodes);
  }

  /**
   * 解析图片 - ![alt](src "title")
   */
  private parseImage(match: RegExpMatchArray): Node {
    const alt = match[1] || "";
    const src = match[2] || "";
    const title = match[3] || "";

    return this.schema.node("image", { src, alt, title });
  }

  /**
   * 解析段落
   */
  private parseParagraph(line: string): Node {
    const nodes = this.parseInlineWithSyntax(line);
    return this.schema.node("paragraph", null, nodes.length > 0 ? nodes : undefined);
  }

  /**
   * 转义正则：匹配 \ 后跟特殊字符
   */
  private static ESCAPE_RE = /\\([\\`*_{}[\]()#+\-.!|~=$>])/g;

  /**
   * 解析行内内容 - 保留语法标记，支持嵌套语法
   */
  private parseInlineWithSyntax(text: string, inheritedMarks: Mark[] = []): Node[] {
    if (!text) return [];

    // 转义预处理：检测 \X 转义序列
    const escapePositions: Array<{ index: number; char: string }> = [];
    const escapeRe = new RegExp(MarkdownParser.ESCAPE_RE.source, "g");
    let escMatch: RegExpExecArray | null;
    while ((escMatch = escapeRe.exec(text)) !== null) {
      escapePositions.push({ index: escMatch.index, char: escMatch[1] });
    }

    if (escapePositions.length > 0) {
      return this.parseInlineWithEscapes(text, inheritedMarks, escapePositions);
    }

    // 收集所有匹配
    interface MatchInfo {
      syntax: InlineSyntax;
      match: RegExpExecArray;
      start: number;
      end: number;
      prefix: string;
      suffix: string;
      content: string;
      attrs?: Record<string, any>;
    }

    const matches: MatchInfo[] = [];

    for (const syntax of INLINE_SYNTAXES) {
      const re = new RegExp(syntax.pattern.source, "g");
      let match: RegExpExecArray | null;

      while ((match = re.exec(text)) !== null) {
        const prefix = typeof syntax.prefix === "function" ? syntax.prefix(match) : syntax.prefix;
        const suffix = typeof syntax.suffix === "function" ? syntax.suffix(match) : syntax.suffix;
        // 支持多捕获组的情况（如 strong 的正则有两种模式）
        const content = match[syntax.contentIndex] || match[syntax.contentIndex + 2] || "";

        // 跳过无效匹配
        if (!prefix || !content) continue;

        matches.push({
          syntax,
          match,
          start: match.index,
          end: match.index + match[0].length,
          prefix,
          suffix,
          content,
          attrs: syntax.getAttrs?.(match),
        });
      }
    }

    // 按位置排序，优先选择更长的匹配（外层语法）
    matches.sort((a, b) => {
      if (a.start !== b.start) return a.start - b.start;
      return b.end - a.end; // 相同起点时，更长的优先
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

    // 构建节点
    const nodes: Node[] = [];
    let pos = 0;

    for (const m of filtered) {
      // 前面的纯文本
      if (m.start > pos) {
        const plainText = text.slice(pos, m.start);
        if (inheritedMarks.length > 0) {
          nodes.push(this.schema.text(plainText, inheritedMarks));
        } else {
          nodes.push(this.schema.text(plainText));
        }
      }

      // 语法标记和内容
      const syntaxMark = this.schema.marks.syntax_marker?.create({
        syntaxType: m.syntax.type,
      });

      // 处理 strong_emphasis 特殊类型
      let contentMarks: Mark[] = [];
      if (m.syntax.type === "strong_emphasis") {
        const strongMark = this.schema.marks.strong?.create();
        const emphasisMark = this.schema.marks.emphasis?.create();
        if (strongMark) contentMarks.push(strongMark);
        if (emphasisMark) contentMarks.push(emphasisMark);
      } else {
        const contentMark = this.schema.marks[m.syntax.type]?.create(m.attrs);
        if (contentMark) contentMarks.push(contentMark);
      }

      // 合并继承的 marks
      const allContentMarks = [...inheritedMarks, ...contentMarks];

      // 前缀（带 syntax_marker）
      if (syntaxMark) {
        const prefixMarks = [...inheritedMarks, syntaxMark, ...contentMarks];
        nodes.push(this.schema.text(m.prefix, prefixMarks));
      }

      // 递归解析内容（可能包含嵌套语法）
      const innerNodes = this.parseInlineWithSyntax(m.content, allContentMarks);
      if (innerNodes.length > 0) {
        nodes.push(...innerNodes);
      } else if (m.content) {
        // 如果没有嵌套语法，直接添加内容
        nodes.push(this.schema.text(m.content, allContentMarks));
      }

      // 后缀（带 syntax_marker）
      if (syntaxMark) {
        const suffixMarks = [...inheritedMarks, syntaxMark, ...contentMarks];
        nodes.push(this.schema.text(m.suffix, suffixMarks));
      }

      pos = m.end;
    }

    // 剩余文本
    if (pos < text.length) {
      const remainingText = text.slice(pos);
      if (inheritedMarks.length > 0) {
        nodes.push(this.schema.text(remainingText, inheritedMarks));
      } else {
        nodes.push(this.schema.text(remainingText));
      }
    }

    return nodes;
  }

  /**
   * 处理包含转义序列的行内文本
   * 将文本按转义位置分割，非转义片段递归解析，转义部分生成特殊节点
   */
  private parseInlineWithEscapes(
    text: string,
    inheritedMarks: Mark[],
    escapePositions: Array<{ index: number; char: string }>
  ): Node[] {
    const nodes: Node[] = [];
    let pos = 0;

    for (const esc of escapePositions) {
      // 转义之前的普通文本片段 → 递归正常解析
      if (esc.index > pos) {
        const segment = text.slice(pos, esc.index);
        nodes.push(...this.parseInlineWithSyntax(segment, inheritedMarks));
      }

      // `\` 字符 → 带 syntax_marker(escape) 的文本节点
      const syntaxMark = this.schema.marks.syntax_marker?.create({ syntaxType: "escape" });
      if (syntaxMark) {
        const backslashMarks = [...inheritedMarks, syntaxMark];
        nodes.push(this.schema.text("\\", backslashMarks));
      }

      // 被转义的字符 → 普通文本节点（只带 inheritedMarks）
      if (inheritedMarks.length > 0) {
        nodes.push(this.schema.text(esc.char, inheritedMarks));
      } else {
        nodes.push(this.schema.text(esc.char));
      }

      pos = esc.index + 2; // 跳过 \X（2个字符）
    }

    // 剩余文本 → 递归正常解析
    if (pos < text.length) {
      const remaining = text.slice(pos);
      nodes.push(...this.parseInlineWithSyntax(remaining, inheritedMarks));
    }

    return nodes;
  }

  /**
   * 解析代码块
   * 支持嵌套代码围栏：内部带语言标识的 ``` 开启嵌套层，对应的 ``` 关闭嵌套层
   * 如果代码块未闭合（没有找到结束的 ```），返回 null，由调用方当作普通段落处理
   */
  private parseCodeBlock(
    lines: string[],
    startIndex: number
  ): { node: Node; endIndex: number } | null {
    const startLine = lines[startIndex];
    const langMatch = startLine.match(BLOCK_PATTERNS.code_block_start);
    const language = langMatch ? langMatch[1] || "" : "";

    let endIndex = startIndex + 1;
    const contentLines: string[] = [];
    let nestedLevel = 0;

    while (endIndex < lines.length) {
      const line = lines[endIndex];
      const isEnd = BLOCK_PATTERNS.code_block_end.test(line);
      const isStart = !isEnd && BLOCK_PATTERNS.code_block_start.test(line);

      if (isStart) {
        // 内部出现带语言标识的围栏开启，进入嵌套层
        nestedLevel++;
      } else if (isEnd) {
        if (nestedLevel > 0) {
          // 关闭一层嵌套
          nestedLevel--;
        } else {
          // 当前代码块的真正结束
          break;
        }
      }

      contentLines.push(line);
      endIndex++;
    }

    // 如果没有找到结束标记，不创建代码块节点
    if (endIndex >= lines.length) {
      return null;
    }

    // 代码块节点只包含纯文本内容，不包含语法标记
    const content = contentLines.join("\n");
    const textNode = content ? this.schema.text(content) : null;

    return {
      node: this.schema.node("code_block", { language }, textNode ? [textNode] : []),
      endIndex,
    };
  }

  /**
   * 解析数学块
   */
  private parseMathBlock(lines: string[], startIndex: number): { node: Node; endIndex: number } {
    let endIndex = startIndex + 1;
    const contentLines: string[] = [];

    while (endIndex < lines.length) {
      if (BLOCK_PATTERNS.math_block_end.test(lines[endIndex])) {
        break;
      }
      contentLines.push(lines[endIndex]);
      endIndex++;
    }

    const content = contentLines.join("\n");
    const textNode = content ? this.schema.text(content) : null;

    return {
      node: this.schema.node("math_block", {}, textNode ? [textNode] : []),
      endIndex,
    };
  }

  /**
   * 解析容器
   */
  private parseContainer(lines: string[], startIndex: number): { node: Node; endIndex: number } {
    const startLine = lines[startIndex];
    const match = startLine.match(BLOCK_PATTERNS.container_start)!;
    const type = match[1];
    const title = match[2] || "";

    let endIndex = startIndex + 1;
    const contentLines: string[] = [];

    while (endIndex < lines.length) {
      if (BLOCK_PATTERNS.container_end.test(lines[endIndex])) {
        break;
      }
      contentLines.push(lines[endIndex]);
      endIndex++;
    }

    const innerBlocks = this.parseBlocks(contentLines);

    return {
      node: this.schema.node("container", { type, title }, innerBlocks),
      endIndex,
    };
  }

  /**
   * 解析 HTML 块
   * 支持自闭合标签和嵌套标签
   */
  private parseHtmlBlock(lines: string[], startIndex: number): { node: Node; endIndex: number } {
    const startLine = lines[startIndex];
    const tagMatch = startLine.match(BLOCK_PATTERNS.html_block_start);
    const tagName = tagMatch ? tagMatch[1] : "";

    // HTML 自闭合标签列表
    const voidElements = new Set([
      "area",
      "base",
      "br",
      "col",
      "embed",
      "hr",
      "img",
      "input",
      "link",
      "meta",
      "param",
      "source",
      "track",
      "wbr",
    ]);

    // 检查是否是自闭合标签（void element 或以 /> 结尾）
    if (voidElements.has(tagName.toLowerCase()) || startLine.trimEnd().endsWith("/>")) {
      const textNode = startLine ? this.schema.text(startLine) : null;
      return {
        node: this.schema.node("html_block", {}, textNode ? [textNode] : []),
        endIndex: startIndex,
      };
    }

    const closePattern = new RegExp(`</${tagName}\\s*>`, "i");

    // 检查闭合标签是否在起始行（如 <span>text</span>）
    if (closePattern.test(startLine)) {
      const textNode = startLine ? this.schema.text(startLine) : null;
      return {
        node: this.schema.node("html_block", {}, textNode ? [textNode] : []),
        endIndex: startIndex,
      };
    }

    // 多行 HTML 块：收集直到找到匹配的闭合标签
    const contentLines: string[] = [startLine];
    let endIndex = startIndex + 1;
    let nestLevel = 1; // 已经有一个开始标签

    const openPattern = new RegExp(`<${tagName}[\\s>/]`, "i");

    while (endIndex < lines.length) {
      const line = lines[endIndex];
      contentLines.push(line);

      // 检查同名标签的嵌套（简单计数）
      if (openPattern.test(line) && endIndex !== startIndex) {
        nestLevel++;
      }
      if (closePattern.test(line)) {
        nestLevel--;
        if (nestLevel <= 0) {
          break;
        }
      }

      endIndex++;
    }

    const content = contentLines.join("\n");
    const textNode = content ? this.schema.text(content) : null;

    return {
      node: this.schema.node("html_block", {}, textNode ? [textNode] : []),
      endIndex,
    };
  }

  /**
   * 解析引用块
   */
  private parseBlockquote(lines: string[], startIndex: number): { node: Node; endIndex: number } {
    let endIndex = startIndex;
    const contentLines: string[] = [];

    while (endIndex < lines.length) {
      const line = lines[endIndex];
      // 空行也可以是引用的一部分（如果下一行还是引用）
      if (line.trim() === "") {
        // 检查下一行是否还是引用
        if (endIndex + 1 < lines.length && BLOCK_PATTERNS.blockquote.test(lines[endIndex + 1])) {
          contentLines.push("");
          endIndex++;
          continue;
        }
        break;
      }
      const match = line.match(BLOCK_PATTERNS.blockquote);
      if (!match) break;
      // 保留原始内容（不包含 >）
      contentLines.push(match[1]);
      endIndex++;
    }

    const innerBlocks = this.parseBlocks(contentLines);

    // 为每个块级元素添加 > 前缀
    const processedBlocks = innerBlocks.map((block) => {
      if (block.type.name === "paragraph") {
        const syntaxMark = this.schema.marks.syntax_marker?.create({
          syntaxType: "blockquote",
        });

        const nodes: Node[] = [];

        // 添加 > 符号（带 syntax_marker）
        if (syntaxMark) {
          nodes.push(this.schema.text("> ", [syntaxMark]));
        }

        // 添加原有内容
        block.forEach((child) => {
          nodes.push(child);
        });

        return this.schema.node("paragraph", null, nodes);
      }
      return block;
    });

    return {
      node: this.schema.node(
        "blockquote",
        null,
        processedBlocks.length > 0 ? processedBlocks : [this.schema.node("paragraph")]
      ),
      endIndex: endIndex - 1,
    };
  }

  /**
   * 解析无序列表
   * 支持列表项中的多行内容（如代码块）
   */
  private parseBulletList(lines: string[], startIndex: number): { node: Node; endIndex: number } {
    const items: Node[] = [];
    let endIndex = startIndex;
    let baseIndent = -1;

    while (endIndex < lines.length) {
      const line = lines[endIndex];

      // 空行可能是列表项之间的分隔，检查下一行
      if (line.trim() === "") {
        // 检查下一行是否还是列表项
        if (endIndex + 1 < lines.length) {
          const nextLine = lines[endIndex + 1];
          const nextMatch = nextLine.match(BLOCK_PATTERNS.bullet_list);
          if (nextMatch && (baseIndent === -1 || nextMatch[1].length === baseIndent)) {
            endIndex++;
            continue;
          }
        }
        break;
      }

      const match = line.match(BLOCK_PATTERNS.bullet_list);
      if (!match) {
        // 检查是否是缩进的内容（属于当前列表项）
        if (baseIndent !== -1 && line.match(/^\s+/) && items.length > 0) {
          // 这是列表项的续行，需要回溯处理
          break;
        }
        break;
      }

      const indent = match[1].length;
      // 记录基础缩进
      if (baseIndent === -1) {
        baseIndent = indent;
      }

      // 如果缩进大于基础缩进，说明是子列表，跳过（由父列表项处理）
      if (indent > baseIndent) {
        break;
      }

      // 如果缩进小于基础缩进，说明列表结束
      if (indent < baseIndent) {
        break;
      }

      // 收集这个列表项的所有内容行
      const itemLines: string[] = [match[3]];
      const itemIndent = indent + 2; // 列表标记后的缩进
      let itemEndIndex = endIndex + 1;

      // 收集后续缩进的行（包括代码块等）
      // 检查第一行是否是代码块开始
      let inCodeBlock = match[3].trim().startsWith("```");
      while (itemEndIndex < lines.length) {
        const nextLine = lines[itemEndIndex];

        // 跟踪代码块状态（必须在列表项检测之前，避免代码块内容被误判为新列表项）
        if (nextLine.trim().startsWith("```")) {
          inCodeBlock = !inCodeBlock;
        }

        // 空行可能是列表项内容的一部分
        if (nextLine.trim() === "") {
          // 检查空行后面是否还有缩进内容
          if (!inCodeBlock && itemEndIndex + 1 < lines.length) {
            const afterEmpty = lines[itemEndIndex + 1];
            // 如果后面是新的列表项或没有缩进，则结束
            if (BLOCK_PATTERNS.bullet_list.test(afterEmpty) || !afterEmpty.match(/^\s{2,}/)) {
              break;
            }
          }
          itemLines.push("");
          itemEndIndex++;
          continue;
        }

        // 检查是否是新的列表项（代码块内部不检查）
        if (!inCodeBlock && BLOCK_PATTERNS.bullet_list.test(nextLine)) {
          break;
        }

        // 检查是否有足够的缩进
        const lineIndent = nextLine.match(/^(\s*)/)?.[1].length || 0;
        // 在代码块内部，接受缩进较少的行
        if (lineIndent >= itemIndent || inCodeBlock || nextLine.trim().startsWith("```")) {
          // 移除缩进
          const trimmedLine = nextLine.slice(Math.min(lineIndent, itemIndent));
          itemLines.push(trimmedLine);
          itemEndIndex++;
        } else {
          break;
        }
      }

      // 解析列表项内容
      const itemContent = this.parseBlocks(itemLines);
      items.push(
        this.schema.node(
          "list_item",
          null,
          itemContent.length > 0 ? itemContent : [this.schema.node("paragraph")]
        )
      );
      endIndex = itemEndIndex;
    }

    return {
      node: this.schema.node(
        "bullet_list",
        null,
        items.length > 0
          ? items
          : [this.schema.node("list_item", null, [this.schema.node("paragraph")])]
      ),
      endIndex: endIndex - 1,
    };
  }

  /**
   * 解析有序列表
   * 支持列表项中的多行内容（如代码块）
   */
  private parseOrderedList(lines: string[], startIndex: number): { node: Node; endIndex: number } {
    const items: Node[] = [];
    let endIndex = startIndex;
    let start = 1;
    let baseIndent = -1;

    while (endIndex < lines.length) {
      const line = lines[endIndex];

      // 空行可能是列表项之间的分隔
      if (line.trim() === "") {
        if (endIndex + 1 < lines.length) {
          const nextLine = lines[endIndex + 1];
          const nextMatch = nextLine.match(BLOCK_PATTERNS.ordered_list);
          if (nextMatch && (baseIndent === -1 || nextMatch[1].length === baseIndent)) {
            endIndex++;
            continue;
          }
        }
        break;
      }

      const match = line.match(BLOCK_PATTERNS.ordered_list);
      if (!match) {
        if (baseIndent !== -1 && line.match(/^\s+/) && items.length > 0) {
          break;
        }
        break;
      }

      const indent = match[1].length;
      if (baseIndent === -1) {
        baseIndent = indent;
        start = parseInt(match[2], 10);
      }

      if (indent > baseIndent) {
        break;
      }

      if (indent < baseIndent) {
        break;
      }

      // 收集这个列表项的所有内容行
      const itemLines: string[] = [match[3]];
      const itemIndent = indent + match[2].length + 2; // 数字 + ". " 的长度
      let itemEndIndex = endIndex + 1;

      // 检查第一行是否是代码块开始
      let inCodeBlock = match[3].trim().startsWith("```");
      while (itemEndIndex < lines.length) {
        const nextLine = lines[itemEndIndex];

        // 跟踪代码块状态（必须在列表项检测之前，避免代码块内容被误判为新列表项）
        if (nextLine.trim().startsWith("```")) {
          inCodeBlock = !inCodeBlock;
        }

        if (nextLine.trim() === "") {
          if (!inCodeBlock && itemEndIndex + 1 < lines.length) {
            const afterEmpty = lines[itemEndIndex + 1];
            if (BLOCK_PATTERNS.ordered_list.test(afterEmpty) || !afterEmpty.match(/^\s{2,}/)) {
              break;
            }
          }
          itemLines.push("");
          itemEndIndex++;
          continue;
        }

        if (!inCodeBlock && BLOCK_PATTERNS.ordered_list.test(nextLine)) {
          break;
        }

        const lineIndent = nextLine.match(/^(\s*)/)?.[1].length || 0;
        // 在代码块内部，接受缩进较少的行
        if (lineIndent >= itemIndent || inCodeBlock || nextLine.trim().startsWith("```")) {
          const trimmedLine = nextLine.slice(Math.min(lineIndent, itemIndent));
          itemLines.push(trimmedLine);
          itemEndIndex++;
        } else {
          break;
        }
      }

      const itemContent = this.parseBlocks(itemLines);
      items.push(
        this.schema.node(
          "list_item",
          null,
          itemContent.length > 0 ? itemContent : [this.schema.node("paragraph")]
        )
      );
      endIndex = itemEndIndex;
    }

    return {
      node: this.schema.node(
        "ordered_list",
        { start },
        items.length > 0
          ? items
          : [this.schema.node("list_item", null, [this.schema.node("paragraph")])]
      ),
      endIndex: endIndex - 1,
    };
  }

  /**
   * 解析任务列表
   */
  private parseTaskList(lines: string[], startIndex: number): { node: Node; endIndex: number } {
    const items: Node[] = [];
    let endIndex = startIndex;

    while (endIndex < lines.length) {
      const line = lines[endIndex];

      // 空行结束列表
      if (line.trim() === "") {
        break;
      }

      const match = line.match(BLOCK_PATTERNS.task_item);
      if (!match) break;

      const checked = match[2].toLowerCase() === "x";
      const content = match[3];
      const para = this.parseParagraph(content);
      items.push(this.schema.node("task_item", { checked }, [para]));
      endIndex++;
    }

    return {
      node: this.schema.node(
        "task_list",
        null,
        items.length > 0
          ? items
          : [this.schema.node("task_item", { checked: false }, [this.schema.node("paragraph")])]
      ),
      endIndex: endIndex - 1,
    };
  }

  /**
   * 解析表格
   */
  private parseTable(lines: string[], startIndex: number): { node: Node; endIndex: number } | null {
    // 查找分隔行，允许跳过一个空行
    let sepIndex = startIndex + 1;
    if (sepIndex < lines.length && lines[sepIndex].trim() === "") sepIndex++;
    if (sepIndex >= lines.length) return null;
    if (!BLOCK_PATTERNS.table_separator.test(lines[sepIndex])) return null;

    const rows: Node[] = [];
    let endIndex = startIndex;

    // 从分隔行解析列对齐信息
    const separatorLine = lines[sepIndex].trimEnd();
    const alignments = separatorLine
      .slice(1, -1)
      .split("|")
      .map((col) => {
        const trimmed = col.trim();
        const left = trimmed.startsWith(":");
        const right = trimmed.endsWith(":");
        if (left && right) return "center";
        if (right) return "right";
        if (left) return "left";
        return null;
      });

    // 表头
    const headerCells = this.parseTableRow(lines[startIndex], true, alignments);
    rows.push(this.schema.node("table_row", null, headerCells));
    endIndex = sepIndex + 1;

    // 数据行（跳过行间空行）
    while (endIndex < lines.length) {
      if (lines[endIndex].trim() === "") {
        endIndex++;
        continue;
      }
      if (!BLOCK_PATTERNS.table_row.test(lines[endIndex])) break;
      const cells = this.parseTableRow(lines[endIndex], false, alignments);
      rows.push(this.schema.node("table_row", null, cells));
      endIndex++;
    }

    return {
      node: this.schema.node("table", null, rows),
      endIndex: endIndex - 1,
    };
  }

  /**
   * 解析表格行
   */
  private parseTableRow(
    line: string,
    isHeader: boolean,
    alignments: (string | null)[] = []
  ): Node[] {
    const cells: Node[] = [];
    const content = line.trimEnd().slice(1, -1);
    const cellContents = content.split("|");

    for (let i = 0; i < cellContents.length; i++) {
      const trimmed = cellContents[i].trim();
      const inlineContent = this.parseInlineWithSyntax(trimmed);
      const nodeType = isHeader ? "table_header" : "table_cell";
      const align = alignments[i] || null;
      cells.push(
        this.schema.node(
          nodeType,
          align ? { align } : null,
          inlineContent.length > 0 ? inlineContent : undefined
        )
      );
    }

    return cells;
  }
}

/** 默认解析器实例 */
export const defaultParser = new MarkdownParser();

/**
 * 解析 Markdown 文本
 */
export function parseMarkdown(markdown: string): ParseResult {
  return defaultParser.parse(markdown);
}
