/**
 * Milkup Schema 定义
 *
 * 核心设计思路：
 * 1. 每个节点/标记都存储其 Markdown 源码标记信息
 * 2. 通过 Decoration 系统控制源码标记的显示/隐藏
 * 3. 光标实际在源码中移动，但显示为渲染后的格式
 */

import { Schema, NodeSpec, MarkSpec, DOMOutputSpec } from "prosemirror-model";

// ============ 节点定义 ============

const doc: NodeSpec = {
  content: "block+",
};

const paragraph: NodeSpec = {
  attrs: {
    // 代码块相关属性（仅在源码模式下使用）
    codeBlockId: { default: null },
    lineIndex: { default: null },
    totalLines: { default: null },
    language: { default: null },
    // 图片相关属性（仅在源码模式下使用）
    imageAttrs: { default: null },
    // 分割线相关属性（仅在源码模式下使用）
    hrSource: { default: null },
    // 表格相关属性（仅在源码模式下使用）
    tableId: { default: null },
    tableRowIndex: { default: null },
    tableTotalRows: { default: null },
  },
  content: "inline*",
  group: "block",
  parseDOM: [{ tag: "p" }],
  toDOM(node): DOMOutputSpec {
    const attrs: Record<string, any> = {};
    // 如果是代码块段落，添加数据属性
    if (node.attrs.codeBlockId) {
      attrs["data-code-block-id"] = node.attrs.codeBlockId;
      attrs["data-line-index"] = node.attrs.lineIndex;
      attrs["data-total-lines"] = node.attrs.totalLines;
      attrs["data-language"] = node.attrs.language;
    }
    // 如果是图片段落，添加数据属性
    if (node.attrs.imageAttrs) {
      attrs["data-image-source"] = "true";
    }
    // 如果是分割线段落，添加数据属性
    if (node.attrs.hrSource) {
      attrs["data-hr-source"] = "true";
    }
    // 如果是表格段落，添加数据属性
    if (node.attrs.tableId) {
      attrs["data-table-id"] = node.attrs.tableId;
      attrs["data-table-row-index"] = node.attrs.tableRowIndex;
      attrs["data-table-total-rows"] = node.attrs.tableTotalRows;
    }
    return ["p", attrs, 0];
  },
};

const heading: NodeSpec = {
  attrs: {
    level: { default: 1 },
  },
  content: "inline*",
  group: "block",
  defining: true,
  parseDOM: [
    { tag: "h1", attrs: { level: 1 } },
    { tag: "h2", attrs: { level: 2 } },
    { tag: "h3", attrs: { level: 3 } },
    { tag: "h4", attrs: { level: 4 } },
    { tag: "h5", attrs: { level: 5 } },
    { tag: "h6", attrs: { level: 6 } },
  ],
  toDOM(node): DOMOutputSpec {
    return [`h${node.attrs.level}`, 0];
  },
};

const blockquote: NodeSpec = {
  content: "block+",
  group: "block",
  defining: true,
  parseDOM: [{ tag: "blockquote" }],
  toDOM(): DOMOutputSpec {
    return ["blockquote", 0];
  },
};

const code_block: NodeSpec = {
  attrs: {
    language: { default: "" },
  },
  content: "text*",
  marks: "",
  group: "block",
  code: true,
  defining: true,
  parseDOM: [
    {
      tag: "pre",
      preserveWhitespace: "full" as const,
      getAttrs(node) {
        const el = node as HTMLElement;
        const code = el.querySelector("code");
        const className = code?.className || "";
        const match = className.match(/language-(\w+)/);
        return { language: match ? match[1] : "" };
      },
    },
  ],
  toDOM(node): DOMOutputSpec {
    return [
      "pre",
      ["code", { class: node.attrs.language ? `language-${node.attrs.language}` : "" }, 0],
    ];
  },
};

const horizontal_rule: NodeSpec = {
  group: "block",
  parseDOM: [{ tag: "hr" }],
  toDOM(): DOMOutputSpec {
    return ["hr"];
  },
};

const bullet_list: NodeSpec = {
  content: "list_item+",
  group: "block",
  parseDOM: [{ tag: "ul" }],
  toDOM(): DOMOutputSpec {
    return ["ul", 0];
  },
};

const ordered_list: NodeSpec = {
  attrs: {
    start: { default: 1 },
  },
  content: "list_item+",
  group: "block",
  parseDOM: [
    {
      tag: "ol",
      getAttrs(node) {
        const el = node as HTMLElement;
        return { start: el.hasAttribute("start") ? Number(el.getAttribute("start")) : 1 };
      },
    },
  ],
  toDOM(node): DOMOutputSpec {
    return node.attrs.start === 1 ? ["ol", 0] : ["ol", { start: node.attrs.start }, 0];
  },
};

const list_item: NodeSpec = {
  content: "block+",
  parseDOM: [{ tag: "li" }],
  toDOM(): DOMOutputSpec {
    return ["li", 0];
  },
  defining: true,
};

const task_list: NodeSpec = {
  content: "task_item+",
  group: "block",
  parseDOM: [{ tag: "ul.task-list" }],
  toDOM(): DOMOutputSpec {
    return ["ul", { class: "task-list" }, 0];
  },
};

const task_item: NodeSpec = {
  attrs: {
    checked: { default: false },
  },
  content: "block+",
  parseDOM: [
    {
      tag: "li.task-item",
      getAttrs(node) {
        const el = node as HTMLElement;
        const checkbox = el.querySelector('input[type="checkbox"]');
        return { checked: checkbox ? (checkbox as HTMLInputElement).checked : false };
      },
    },
  ],
  toDOM(node): DOMOutputSpec {
    return [
      "li",
      { class: "task-item" },
      ["input", { type: "checkbox", checked: node.attrs.checked ? "checked" : null }],
      ["span", 0],
    ];
  },
  defining: true,
};

const table: NodeSpec = {
  content: "table_row+",
  group: "block",
  tableRole: "table",
  isolating: true,
  parseDOM: [{ tag: "table" }],
  toDOM(): DOMOutputSpec {
    return ["table", ["tbody", 0]];
  },
};

const table_row: NodeSpec = {
  content: "(table_cell | table_header)+",
  tableRole: "row",
  parseDOM: [{ tag: "tr" }],
  toDOM(): DOMOutputSpec {
    return ["tr", 0];
  },
};

const table_cell: NodeSpec = {
  content: "inline*",
  attrs: {
    colspan: { default: 1 },
    rowspan: { default: 1 },
    align: { default: null },
  },
  tableRole: "cell",
  isolating: true,
  parseDOM: [
    {
      tag: "td",
      getAttrs(node) {
        const el = node as HTMLElement;
        return {
          colspan: Number(el.getAttribute("colspan")) || 1,
          rowspan: Number(el.getAttribute("rowspan")) || 1,
          align: el.style.textAlign || null,
        };
      },
    },
  ],
  toDOM(node): DOMOutputSpec {
    const attrs: Record<string, any> = {};
    if (node.attrs.colspan !== 1) attrs.colspan = node.attrs.colspan;
    if (node.attrs.rowspan !== 1) attrs.rowspan = node.attrs.rowspan;
    if (node.attrs.align) attrs.style = `text-align: ${node.attrs.align}`;
    return ["td", attrs, 0];
  },
};

const table_header: NodeSpec = {
  content: "inline*",
  attrs: {
    colspan: { default: 1 },
    rowspan: { default: 1 },
    align: { default: null },
  },
  tableRole: "header_cell",
  isolating: true,
  parseDOM: [
    {
      tag: "th",
      getAttrs(node) {
        const el = node as HTMLElement;
        return {
          colspan: Number(el.getAttribute("colspan")) || 1,
          rowspan: Number(el.getAttribute("rowspan")) || 1,
          align: el.style.textAlign || null,
        };
      },
    },
  ],
  toDOM(node): DOMOutputSpec {
    const attrs: Record<string, any> = {};
    if (node.attrs.colspan !== 1) attrs.colspan = node.attrs.colspan;
    if (node.attrs.rowspan !== 1) attrs.rowspan = node.attrs.rowspan;
    if (node.attrs.align) attrs.style = `text-align: ${node.attrs.align}`;
    return ["th", attrs, 0];
  },
};

const math_block: NodeSpec = {
  attrs: {
    language: { default: "latex" },
  },
  content: "text*",
  marks: "",
  group: "block",
  code: true,
  defining: true,
  parseDOM: [
    {
      tag: "div.math-block",
      preserveWhitespace: "full" as const,
    },
  ],
  toDOM(): DOMOutputSpec {
    return ["div", { class: "math-block" }, ["pre", 0]];
  },
};

const container: NodeSpec = {
  attrs: {
    type: { default: "note" },
    title: { default: "" },
  },
  content: "block+",
  group: "block",
  defining: true,
  parseDOM: [
    {
      tag: "div.container",
      getAttrs(node) {
        const el = node as HTMLElement;
        return {
          type: el.getAttribute("data-type") || "note",
          title: el.getAttribute("data-title") || "",
        };
      },
    },
  ],
  toDOM(node): DOMOutputSpec {
    return [
      "div",
      {
        class: `container container-${node.attrs.type}`,
        "data-type": node.attrs.type,
        "data-title": node.attrs.title,
      },
      0,
    ];
  },
};

const image: NodeSpec = {
  attrs: {
    src: { default: "" },
    alt: { default: "" },
    title: { default: "" },
  },
  group: "block",
  draggable: true,
  parseDOM: [
    {
      tag: "img[src]",
      getAttrs(node) {
        const el = node as HTMLElement;
        return {
          src: el.getAttribute("src") || "",
          alt: el.getAttribute("alt") || "",
          title: el.getAttribute("title") || "",
        };
      },
    },
  ],
  toDOM(node): DOMOutputSpec {
    return ["img", { src: node.attrs.src, alt: node.attrs.alt, title: node.attrs.title }];
  },
};

const text: NodeSpec = {
  group: "inline",
};

const hard_break: NodeSpec = {
  inline: true,
  group: "inline",
  selectable: false,
  parseDOM: [{ tag: "br" }],
  toDOM(): DOMOutputSpec {
    return ["br"];
  },
};

// ============ 标记定义 ============

const strong: MarkSpec = {
  inclusive: false, // 新输入的文本不自动继承此 mark
  parseDOM: [
    { tag: "strong" },
    { tag: "b", getAttrs: (node) => (node as HTMLElement).style.fontWeight !== "normal" && null },
    {
      style: "font-weight",
      getAttrs: (value) => /^(bold(er)?|[5-9]\d{2,})$/.test(value as string) && null,
    },
  ],
  toDOM(): DOMOutputSpec {
    return ["strong", 0];
  },
};

const emphasis: MarkSpec = {
  inclusive: false, // 新输入的文本不自动继承此 mark
  parseDOM: [
    { tag: "em" },
    { tag: "i", getAttrs: (node) => (node as HTMLElement).style.fontStyle !== "normal" && null },
    { style: "font-style=italic" },
  ],
  toDOM(): DOMOutputSpec {
    return ["em", 0];
  },
};

const code_inline: MarkSpec = {
  inclusive: false, // 新输入的文本不自动继承此 mark
  parseDOM: [{ tag: "code" }],
  toDOM(): DOMOutputSpec {
    return ["code", 0];
  },
};

const strikethrough: MarkSpec = {
  inclusive: false, // 新输入的文本不自动继承此 mark
  parseDOM: [
    { tag: "s" },
    { tag: "del" },
    { tag: "strike" },
    {
      style: "text-decoration",
      getAttrs: (value) => (value as string).includes("line-through") && null,
    },
  ],
  toDOM(): DOMOutputSpec {
    return ["del", 0];
  },
};

const link: MarkSpec = {
  attrs: {
    href: { default: "" },
    title: { default: "" },
  },
  inclusive: false,
  parseDOM: [
    {
      tag: "a[href]",
      getAttrs(node) {
        const el = node as HTMLElement;
        return {
          href: el.getAttribute("href") || "",
          title: el.getAttribute("title") || "",
        };
      },
    },
  ],
  toDOM(mark): DOMOutputSpec {
    return ["a", { href: mark.attrs.href, title: mark.attrs.title || null }, 0];
  },
};

const highlight: MarkSpec = {
  inclusive: false, // 新输入的文本不自动继承此 mark
  parseDOM: [
    { tag: "mark" },
    { style: "background-color", getAttrs: (value) => (value as string) !== "transparent" && null },
  ],
  toDOM(): DOMOutputSpec {
    return ["mark", 0];
  },
};

const math_inline: MarkSpec = {
  attrs: {
    content: { default: "" },
  },
  parseDOM: [
    {
      tag: "span.math-inline",
      getAttrs(node) {
        const el = node as HTMLElement;
        return { content: el.getAttribute("data-content") || "" };
      },
    },
  ],
  toDOM(mark): DOMOutputSpec {
    return ["span", { class: "math-inline", "data-content": mark.attrs.content }, 0];
  },
};

const footnote_ref: MarkSpec = {
  attrs: {
    id: { default: "" },
  },
  parseDOM: [
    {
      tag: "sup.footnote-ref",
      getAttrs(node) {
        const el = node as HTMLElement;
        return { id: el.getAttribute("data-id") || "" };
      },
    },
  ],
  toDOM(mark): DOMOutputSpec {
    return ["sup", { class: "footnote-ref", "data-id": mark.attrs.id }, 0];
  },
};

/**
 * 语法标记 Mark
 * 用于标记 Markdown 语法符号（如 **, *, ~~, ` 等）
 * 这些文本是真实存在于文档中的，可以被光标选中
 */
const syntax_marker: MarkSpec = {
  attrs: {
    syntaxType: { default: "" }, // 语法类型：strong, emphasis, code_inline 等
  },
  excludes: "", // 可以与其他 mark 共存
  inclusive: false, // 新输入的文本不继承此 mark，防止无法逃出语法区域
  parseDOM: [
    {
      tag: "span.milkup-syntax",
      getAttrs(node) {
        const el = node as HTMLElement;
        return { syntaxType: el.getAttribute("data-syntax-type") || "" };
      },
    },
  ],
  toDOM(mark): DOMOutputSpec {
    return [
      "span",
      {
        class: "milkup-syntax",
        "data-syntax-type": mark.attrs.syntaxType,
      },
      0,
    ];
  },
};

// ============ Schema 导出 ============

export const milkupSchema = new Schema({
  nodes: {
    doc,
    paragraph,
    heading,
    blockquote,
    code_block,
    horizontal_rule,
    bullet_list,
    ordered_list,
    list_item,
    task_list,
    task_item,
    table,
    table_row,
    table_cell,
    table_header,
    math_block,
    container,
    image,
    text,
    hard_break,
  },
  marks: {
    // 语法标记 mark 放在最前面，优先级最高
    syntax_marker,
    strong,
    emphasis,
    code_inline,
    strikethrough,
    link,
    highlight,
    math_inline,
    footnote_ref,
  },
});

export type MilkupSchema = typeof milkupSchema;
