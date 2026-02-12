/**
 * Milkup Markdown 序列化器
 *
 * 将 ProseMirror 文档序列化为 Markdown 文本
 */

import { Node, Mark, Fragment } from "prosemirror-model";

/** 序列化选项 */
export interface SerializeOptions {
  /** 是否使用紧凑模式（减少空行） */
  compact?: boolean;
  /** 列表缩进字符数 */
  listIndent?: number;
  /** 代码块围栏字符 */
  codeFence?: string;
}

const defaultOptions: SerializeOptions = {
  compact: false,
  listIndent: 2,
  codeFence: "```",
};

/**
 * Markdown 序列化器类
 */
export class MarkdownSerializer {
  private options: SerializeOptions;

  constructor(options: SerializeOptions = {}) {
    this.options = { ...defaultOptions, ...options };
  }

  /**
   * 序列化文档
   */
  serialize(doc: Node): string {
    const lines: string[] = [];
    this.serializeFragment(doc.content, lines, "");
    return lines.join("\n");
  }

  /**
   * 序列化 Fragment
   */
  private serializeFragment(fragment: Fragment, lines: string[], indent: string): void {
    fragment.forEach((node, _, index) => {
      this.serializeNode(node, lines, indent, index);
    });
  }

  /**
   * 序列化节点
   */
  private serializeNode(node: Node, lines: string[], indent: string, index: number): void {
    const handler = this.nodeHandlers[node.type.name];
    if (handler) {
      handler.call(this, node, lines, indent, index);
    } else {
      // 默认处理：递归处理子节点
      this.serializeFragment(node.content, lines, indent);
    }
  }

  /**
   * 节点处理器映射
   */
  private nodeHandlers: Record<
    string,
    (node: Node, lines: string[], indent: string, index: number) => void
  > = {
    paragraph: (node, lines, indent) => {
      // 对于代码块段落，直接输出文本内容（包含围栏符号）
      if (node.attrs.codeBlockId) {
        const text = node.textContent;
        lines.push(indent + text);
        const isLastLine = node.attrs.lineIndex === node.attrs.totalLines - 1;
        if (isLastLine && !this.options.compact) lines.push("");
      } else if (node.attrs.tableId) {
        // 对于表格段落，直接输出文本内容（包含表格语法）
        const text = node.textContent;
        lines.push(indent + text);
        const isLastLine = node.attrs.tableRowIndex === node.attrs.tableTotalRows - 1;
        if (isLastLine && !this.options.compact) lines.push("");
      } else if (node.attrs.htmlBlockId) {
        // 对于 HTML 块段落，直接输出文本内容
        const text = node.textContent;
        lines.push(indent + text);
        const isLastLine = node.attrs.htmlBlockLineIndex === node.attrs.htmlBlockTotalLines - 1;
        if (isLastLine && !this.options.compact) lines.push("");
      } else if (node.attrs.mathBlockId) {
        // 对于数学公式块段落，直接输出文本内容（包含 $$ 符号）
        const text = node.textContent;
        lines.push(indent + text);
        const isLastLine = node.attrs.mathBlockLineIndex === node.attrs.mathBlockTotalLines - 1;
        if (isLastLine && !this.options.compact) lines.push("");
      } else {
        const text = this.serializeInline(node);
        lines.push(indent + text);
        // 空段落（用于保留原始空行）不追加分隔空行
        if (!this.options.compact && text.length > 0) lines.push("");
      }
    },

    heading: (node, lines, indent) => {
      // serializeInline 现在直接输出所有文本（包括 ### 语法标记），无需手动添加
      const text = this.serializeInline(node);
      lines.push(indent + text);
      if (!this.options.compact) lines.push("");
    },

    blockquote: (node, lines, indent) => {
      const innerLines: string[] = [];
      this.serializeFragment(node.content, innerLines, "");
      for (const line of innerLines) {
        // 检查行是否已经以 > 开头（来自 syntax_marker）
        if (line.startsWith("> ")) {
          // 已经有 > 前缀，直接使用
          lines.push(indent + line);
        } else if (line === "") {
          lines.push(indent + ">");
        } else {
          lines.push(indent + "> " + line);
        }
      }
      if (!this.options.compact) lines.push("");
    },

    code_block: (node, lines, indent) => {
      const content = node.textContent;
      const lang = node.attrs.language || "";
      const fence = this.options.codeFence!;

      // 总是输出标准的多行格式
      lines.push(indent + fence + lang);
      if (content) {
        for (const line of content.split("\n")) {
          lines.push(indent + line);
        }
      }
      lines.push(indent + fence);
      if (!this.options.compact) lines.push("");
    },

    horizontal_rule: (node, lines, indent) => {
      lines.push(indent + "---");
      if (!this.options.compact) lines.push("");
    },

    bullet_list: (node, lines, indent) => {
      node.content.forEach((item) => {
        this.serializeListItem(item, lines, indent, "-");
      });
      if (!this.options.compact) lines.push("");
    },

    ordered_list: (node, lines, indent) => {
      const start = (node.attrs.start as number) || 1;
      node.content.forEach((item, _, i) => {
        this.serializeListItem(item, lines, indent, `${start + i}.`);
      });
      if (!this.options.compact) lines.push("");
    },

    task_list: (node, lines, indent) => {
      node.content.forEach((item) => {
        const checked = item.attrs.checked ? "x" : " ";
        this.serializeListItem(item, lines, indent, `- [${checked}]`);
      });
      if (!this.options.compact) lines.push("");
    },

    table: (node, lines, indent) => {
      const rows: string[][] = [];
      let headerRow: string[] = [];

      node.content.forEach((row, _, rowIndex) => {
        const cells: string[] = [];
        row.content.forEach((cell) => {
          cells.push(this.serializeInline(cell));
        });
        if (rowIndex === 0) {
          headerRow = cells;
        }
        rows.push(cells);
      });

      if (headerRow.length > 0) {
        // 表头
        lines.push(indent + "| " + headerRow.join(" | ") + " |");
        // 分隔行
        lines.push(indent + "| " + headerRow.map(() => "---").join(" | ") + " |");
        // 数据行
        for (let i = 1; i < rows.length; i++) {
          lines.push(indent + "| " + rows[i].join(" | ") + " |");
        }
      }
      if (!this.options.compact) lines.push("");
    },

    math_block: (node, lines, indent) => {
      lines.push(indent + "$$");
      const content = node.textContent || "";
      if (content) {
        for (const line of content.split("\n")) {
          lines.push(indent + line);
        }
      }
      lines.push(indent + "$$");
      if (!this.options.compact) lines.push("");
    },

    html_block: (node, lines, indent) => {
      const content = node.textContent || "";
      for (const line of content.split("\n")) {
        lines.push(indent + line);
      }
      if (!this.options.compact) lines.push("");
    },

    container: (node, lines, indent) => {
      const type = node.attrs.type || "note";
      const title = node.attrs.title || "";
      lines.push(indent + ":::" + type + (title ? " " + title : ""));
      this.serializeFragment(node.content, lines, indent);
      lines.push(indent + ":::");
      if (!this.options.compact) lines.push("");
    },

    image: (node, lines, indent) => {
      const alt = node.attrs.alt || "";
      const src = node.attrs.src || "";
      const title = node.attrs.title || "";
      const titlePart = title ? ` "${title}"` : "";
      lines.push(indent + `![${alt}](${src}${titlePart})`);
      if (!this.options.compact) lines.push("");
    },

    hard_break: () => {
      // 硬换行在行内处理
    },
  };

  /**
   * 序列化列表项
   */
  private serializeListItem(item: Node, lines: string[], indent: string, marker: string): void {
    const innerLines: string[] = [];
    this.serializeFragment(item.content, innerLines, "");

    for (let i = 0; i < innerLines.length; i++) {
      const line = innerLines[i];
      if (i === 0) {
        lines.push(indent + marker + " " + line);
      } else if (line !== "") {
        lines.push(indent + " ".repeat(this.options.listIndent!) + line);
      }
    }
  }

  /**
   * 序列化行内内容
   * 直接输出所有文本节点（包括语法标记），保留用户原始输入
   */
  private serializeInline(node: Node): string {
    let result = "";

    node.content.forEach((child) => {
      if (child.isText) {
        result += child.text || "";
      } else if (child.type.name === "hard_break") {
        result += "  \n";
      } else if (child.type.name === "image") {
        const alt = child.attrs.alt || "";
        const src = child.attrs.src || "";
        const title = child.attrs.title || "";
        const titlePart = title ? ` "${title}"` : "";
        result += `![${alt}](${src}${titlePart})`;
      }
    });

    return result;
  }

  /**
   * 序列化带 Mark 的文本（已废弃，保留兼容）
   */
  private serializeTextWithMarks(node: Node): string {
    // 跳过 syntax_marker 文本
    if (node.marks.some((m) => m.type.name === "syntax_marker")) {
      return "";
    }

    let text = node.text || "";

    // 按 Mark 类型包装文本
    for (const mark of node.marks) {
      if (mark.type.name !== "syntax_marker") {
        text = this.wrapWithMark(text, mark);
      }
    }

    return text;
  }

  /**
   * 用 Mark 包装文本
   */
  private wrapWithMark(text: string, mark: Mark): string {
    switch (mark.type.name) {
      case "strong":
        return `**${text}**`;
      case "emphasis":
        return `*${text}*`;
      case "code_inline":
        return `\`${text}\``;
      case "strikethrough":
        return `~~${text}~~`;
      case "highlight":
        return `==${text}==`;
      case "link": {
        const rawHref = mark.attrs.href || "";
        // 重新转义 URL 中的括号，避免 ) 提前终止链接语法
        const href = rawHref.replace(/([()])/g, "\\$1");
        const title = mark.attrs.title || "";
        const titlePart = title ? ` "${title}"` : "";
        return `[${text}](${href}${titlePart})`;
      }
      case "math_inline":
        return `$${text}$`;
      case "footnote_ref":
        return `[^${mark.attrs.id}]`;
      default:
        return text;
    }
  }
}

/** 默认序列化器实例 */
export const defaultSerializer = new MarkdownSerializer();

/**
 * 序列化文档为 Markdown
 */
export function serializeMarkdown(doc: Node, options?: SerializeOptions): string {
  const serializer = options ? new MarkdownSerializer(options) : defaultSerializer;
  return serializer.serialize(doc);
}
