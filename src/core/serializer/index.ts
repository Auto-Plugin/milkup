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
      const text = this.serializeInline(node);
      lines.push(indent + text);
      // 代码块段落：只在最后一行后添加空行，避免破坏代码块格式
      if (node.attrs.codeBlockId) {
        const isLastLine = node.attrs.lineIndex === node.attrs.totalLines - 1;
        if (isLastLine && !this.options.compact) lines.push("");
      } else {
        if (!this.options.compact) lines.push("");
      }
    },

    heading: (node, lines, indent) => {
      const level = node.attrs.level as number;
      const hashes = "#".repeat(level);
      // serializeInline 会跳过 syntax_marker，所以这里需要手动添加 #
      const text = this.serializeInline(node);
      lines.push(indent + hashes + " " + text);
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

      // 检查内容是否已经包含围栏符号（来自 syntax_marker）
      if (content.startsWith("```") && content.endsWith("```")) {
        // 已经有围栏符号，直接使用
        for (const line of content.split("\n")) {
          lines.push(indent + line);
        }
      } else {
        // 没有围栏符号，添加它们
        const lang = node.attrs.language || "";
        const fence = this.options.codeFence!;
        lines.push(indent + fence + lang);
        if (content) {
          for (const line of content.split("\n")) {
            lines.push(indent + line);
          }
        }
        lines.push(indent + fence);
      }
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
   */
  private serializeInline(node: Node): string {
    let result = "";

    // 收集连续的同类型 mark 文本，用于正确输出语法
    const segments: Array<{
      text: string;
      marks: Mark[];
      isSyntaxMarker: boolean;
    }> = [];

    node.content.forEach((child) => {
      if (child.isText) {
        const hasSyntaxMarker = child.marks.some((m) => m.type.name === "syntax_marker");
        segments.push({
          text: child.text || "",
          marks: child.marks.filter((m) => m.type.name !== "syntax_marker"),
          isSyntaxMarker: hasSyntaxMarker,
        });
      } else if (child.type.name === "hard_break") {
        segments.push({ text: "  \n", marks: [], isSyntaxMarker: false });
      } else if (child.type.name === "image") {
        const alt = child.attrs.alt || "";
        const src = child.attrs.src || "";
        const title = child.attrs.title || "";
        const titlePart = title ? ` "${title}"` : "";
        segments.push({ text: `![${alt}](${src}${titlePart})`, marks: [], isSyntaxMarker: false });
      }
    });

    // 合并相邻的同类型 mark 段落，跳过 syntax_marker 文本
    let i = 0;
    while (i < segments.length) {
      const seg = segments[i];

      // 跳过 syntax_marker 文本
      if (seg.isSyntaxMarker) {
        i++;
        continue;
      }

      // 找到连续的相同 mark 的文本
      const markNames = seg.marks
        .map((m) => m.type.name)
        .sort()
        .join(",");
      let combinedText = seg.text;
      let j = i + 1;

      while (j < segments.length) {
        const nextSeg = segments[j];
        // 跳过 syntax_marker
        if (nextSeg.isSyntaxMarker) {
          j++;
          continue;
        }
        const nextMarkNames = nextSeg.marks
          .map((m) => m.type.name)
          .sort()
          .join(",");
        if (nextMarkNames === markNames) {
          combinedText += nextSeg.text;
          j++;
        } else {
          break;
        }
      }

      // 应用 mark 包装
      let output = combinedText;
      for (const mark of seg.marks) {
        output = this.wrapWithMark(output, mark);
      }
      result += output;

      i = j;
    }

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
        const href = mark.attrs.href || "";
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
