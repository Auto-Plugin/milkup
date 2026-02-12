/**
 * Milkup 源码模式文档转换插件
 *
 * 在源码模式下将块级元素（代码块、图片、分割线）拆分/转换为段落节点
 * 在退出源码模式时将段落节点重新组合为对应的块级元素
 */

import { Plugin, PluginKey, Transaction } from "prosemirror-state";
import { Node as ProseMirrorNode, Schema, Fragment, Slice } from "prosemirror-model";
import { ReplaceStep } from "prosemirror-transform";
import { decorationPluginKey } from "../decorations";
import { parseMarkdown } from "../parser";

/** 插件 Key */
export const sourceViewTransformPluginKey = new PluginKey("milkup-source-view-transform");

/** 代码块标记属性 */
interface CodeBlockMarker {
  codeBlockId: string;
  lineIndex: number;
  totalLines: number;
  language: string;
}

/**
 * 生成唯一的代码块 ID
 */
function generateCodeBlockId(): string {
  return `cb_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * 生成唯一的 HTML 块 ID
 */
function generateHtmlBlockId(): string {
  return `hb_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * 将代码块转换为多个段落节点
 */
function transformCodeBlockToParagraphs(
  codeBlock: ProseMirrorNode,
  schema: Schema
): ProseMirrorNode[] {
  const language = codeBlock.attrs.language || "";
  let content = codeBlock.textContent;
  const codeBlockId = generateCodeBlockId();

  // 移除内容末尾的换行符，避免产生多余的空行
  // 但保留内容中间的空行
  content = content.replace(/\n+$/, "");

  // 构建完整的 Markdown 代码块文本
  const fullMarkdown = `\`\`\`${language}\n${content}\n\`\`\``;
  const lines = fullMarkdown.split("\n");

  // 为每一行创建一个段落节点
  const paragraphs: ProseMirrorNode[] = [];
  lines.forEach((line, index) => {
    // 为空行也创建段落，但内容为空
    const textContent = line.length > 0 ? schema.text(line) : undefined;
    const paragraph = schema.nodes.paragraph.create(
      {
        codeBlockId,
        lineIndex: index,
        totalLines: lines.length,
        language,
      },
      textContent
    );
    paragraphs.push(paragraph);
  });

  return paragraphs;
}

/**
 * 将连续的代码块段落节点重新组合成代码块
 */
function transformParagraphsToCodeBlock(
  paragraphs: Array<{ node: ProseMirrorNode; pos: number }>,
  schema: Schema
): { codeBlock: ProseMirrorNode; language: string } | null {
  if (paragraphs.length === 0) return null;

  // 获取代码块信息
  const firstPara = paragraphs[0].node;
  const language = firstPara.attrs.language || "";

  // 提取所有行的文本
  const lines = paragraphs.map((p) => p.node.textContent);

  // 验证是否是完整的代码块格式
  const fullText = lines.join("\n");
  const fenceMatch = fullText.match(/^```([^\n]*?)\n([\s\S]*?)\n```$/);

  if (!fenceMatch) {
    // 不是完整的代码块格式，返回 null
    return null;
  }

  const [, lang, content] = fenceMatch;

  // 创建代码块节点
  const codeBlock = schema.nodes.code_block.create(
    { language: lang || "" },
    content ? schema.text(content) : null
  );

  return { codeBlock, language: lang || "" };
}

/**
 * 将图片节点转换为段落节点
 */
function transformImageToParagraph(image: ProseMirrorNode, schema: Schema): ProseMirrorNode {
  const alt = image.attrs.alt || "";
  const src = image.attrs.src || "";
  const title = image.attrs.title || "";
  const titlePart = title ? ` "${title}"` : "";
  const markdownText = `![${alt}](${src}${titlePart})`;

  return schema.nodes.paragraph.create(
    { imageAttrs: { src, alt, title } },
    schema.text(markdownText)
  );
}

/**
 * 将图片段落节点转换回图片节点
 */
function transformParagraphToImage(
  paragraph: ProseMirrorNode,
  schema: Schema
): ProseMirrorNode | null {
  const imageAttrs = paragraph.attrs.imageAttrs;
  if (!imageAttrs) return null;

  // 优先从段落文本中解析最新的图片属性（用户可能编辑了源码）
  const text = paragraph.textContent;
  const match = text.match(/^!\[([^\]]*)\]\((.+?)(?:\s+"([^"]*)")?\)$/);

  if (match) {
    return schema.nodes.image.create({
      alt: match[1] || "",
      src: match[2] || "",
      title: match[3] || "",
    });
  }

  // 文本不再是有效的图片语法，不转换回图片
  return null;
}

/**
 * 将分割线节点转换为段落节点
 */
function transformHrToParagraph(_hr: ProseMirrorNode, schema: Schema): ProseMirrorNode {
  return schema.nodes.paragraph.create({ hrSource: true }, schema.text("---"));
}

/**
 * 将分割线段落节点转换回分割线节点
 */
function transformParagraphToHr(
  paragraph: ProseMirrorNode,
  schema: Schema
): ProseMirrorNode | null {
  if (!paragraph.attrs.hrSource) return null;

  // 检查文本是否仍然是有效的分割线语法
  const text = paragraph.textContent.trim();
  if (/^[-*_]{3,}$/.test(text)) {
    return schema.nodes.horizontal_rule.create();
  }

  // 文本不再是有效的分割线语法，不转换回分割线
  return null;
}

/**
 * 生成唯一的表格 ID
 */
function generateTableId(): string {
  return `tb_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * 将表格节点转换为多个段落节点
 */
function transformTableToParagraphs(table: ProseMirrorNode, schema: Schema): ProseMirrorNode[] {
  const tableId = generateTableId();
  const lines: string[] = [];
  const alignments: (string | null)[] = [];

  table.content.forEach((row, _, rowIndex) => {
    const cells: string[] = [];
    row.content.forEach((cell) => {
      cells.push(cell.textContent);
      if (rowIndex === 0) {
        alignments.push(cell.attrs.align || null);
      }
    });

    lines.push("| " + cells.join(" | ") + " |");

    // 在表头行后添加分隔行
    if (rowIndex === 0) {
      const separators = alignments.map((align) => {
        if (align === "center") return ":---:";
        if (align === "right") return "---:";
        if (align === "left") return ":---";
        return "---";
      });
      lines.push("| " + separators.join(" | ") + " |");
    }
  });

  const paragraphs: ProseMirrorNode[] = [];
  lines.forEach((line, index) => {
    const paragraph = schema.nodes.paragraph.create(
      {
        tableId,
        tableRowIndex: index,
        tableTotalRows: lines.length,
      },
      schema.text(line)
    );
    paragraphs.push(paragraph);
  });

  return paragraphs;
}

/**
 * 将连续的表格段落节点重新组合成表格
 */
function transformParagraphsToTable(
  paragraphs: Array<{ node: ProseMirrorNode; pos: number }>,
  schema: Schema
): ProseMirrorNode | null {
  if (paragraphs.length < 2) return null;

  const lines = paragraphs.map((p) => p.node.textContent);
  const tableMarkdown = lines.join("\n");

  // 使用解析器重新解析表格
  const result = parseMarkdown(tableMarkdown);
  let tableNode: ProseMirrorNode | null = null;

  result.doc.forEach((node) => {
    if (node.type.name === "table" && !tableNode) {
      tableNode = node;
    }
  });

  return tableNode;
}

/**
 * 将 HTML 块节点转换为多个段落节点
 */
function transformHtmlBlockToParagraphs(
  htmlBlock: ProseMirrorNode,
  schema: Schema
): ProseMirrorNode[] {
  const htmlBlockId = generateHtmlBlockId();
  let content = htmlBlock.textContent;
  content = content.replace(/\n+$/, "");
  const lines = content.split("\n");

  const paragraphs: ProseMirrorNode[] = [];
  lines.forEach((line, index) => {
    const textContent = line.length > 0 ? schema.text(line) : undefined;
    const paragraph = schema.nodes.paragraph.create(
      {
        htmlBlockId,
        htmlBlockLineIndex: index,
        htmlBlockTotalLines: lines.length,
      },
      textContent
    );
    paragraphs.push(paragraph);
  });

  return paragraphs;
}

/**
 * 将连续的 HTML 块段落节点重新组合成 HTML 块
 */
function transformParagraphsToHtmlBlock(
  paragraphs: Array<{ node: ProseMirrorNode; pos: number }>,
  schema: Schema
): ProseMirrorNode | null {
  if (paragraphs.length === 0) return null;

  const lines = paragraphs.map((p) => p.node.textContent);
  const content = lines.join("\n");

  // 验证内容是否以 HTML 标签开头
  if (!content.match(/^<[a-zA-Z]/)) return null;

  return schema.nodes.html_block.create({}, content ? schema.text(content) : null);
}

/**
 * 生成唯一的数学公式块 ID
 */
function generateMathBlockId(): string {
  return `mb_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * 将数学公式块转换为多个段落节点
 */
function transformMathBlockToParagraphs(
  mathBlock: ProseMirrorNode,
  schema: Schema
): ProseMirrorNode[] {
  let content = mathBlock.textContent;
  const mathBlockId = generateMathBlockId();

  // 移除内容末尾的换行符
  content = content.replace(/\n+$/, "");

  // 构建完整的 Markdown 数学公式块文本
  const fullMarkdown = `$$\n${content}\n$$`;
  const lines = fullMarkdown.split("\n");

  const paragraphs: ProseMirrorNode[] = [];
  lines.forEach((line, index) => {
    const textContent = line.length > 0 ? schema.text(line) : undefined;
    const paragraph = schema.nodes.paragraph.create(
      {
        mathBlockId,
        mathBlockLineIndex: index,
        mathBlockTotalLines: lines.length,
      },
      textContent
    );
    paragraphs.push(paragraph);
  });

  return paragraphs;
}

/**
 * 将连续的数学公式块段落节点重新组合成数学公式块
 */
function transformParagraphsToMathBlock(
  paragraphs: Array<{ node: ProseMirrorNode; pos: number }>,
  schema: Schema
): ProseMirrorNode | null {
  if (paragraphs.length === 0) return null;

  const lines = paragraphs.map((p) => p.node.textContent);
  const fullText = lines.join("\n");
  const mathMatch = fullText.match(/^\$\$\n([\s\S]*?)\n\$\$$/);

  if (!mathMatch) return null;

  const [, content] = mathMatch;
  return schema.nodes.math_block.create(
    { language: "latex" },
    content ? schema.text(content) : null
  );
}

/**
 * 递归处理节点，将块级元素转换为段落（用于进入源码模式）
 */
function processNodeForSourceConversion(
  node: ProseMirrorNode,
  schema: Schema
): ProseMirrorNode | ProseMirrorNode[] {
  if (node.type.name === "code_block") {
    return transformCodeBlockToParagraphs(node, schema);
  } else if (node.type.name === "image") {
    return [transformImageToParagraph(node, schema)];
  } else if (node.type.name === "horizontal_rule") {
    return [transformHrToParagraph(node, schema)];
  } else if (node.type.name === "table") {
    return transformTableToParagraphs(node, schema);
  } else if (node.type.name === "html_block") {
    return transformHtmlBlockToParagraphs(node, schema);
  } else if (node.type.name === "math_block") {
    return transformMathBlockToParagraphs(node, schema);
  }

  // 递归处理子节点
  if (node.content.size > 0) {
    const newChildren: ProseMirrorNode[] = [];
    let changed = false;

    node.content.forEach((child) => {
      const processed = processNodeForSourceConversion(child, schema);
      if (Array.isArray(processed)) {
        newChildren.push(...processed);
        changed = true;
      } else if (processed !== child) {
        newChildren.push(processed);
        changed = true;
      } else {
        newChildren.push(child);
      }
    });

    if (changed) {
      return node.type.create(node.attrs, Fragment.from(newChildren), node.marks);
    }
  }

  return node;
}

/**
 * 将文档中的所有块级元素（代码块、图片、分割线、表格、HTML块）转换为段落
 * 使用整体替换文档内容的方式（单次 ReplaceStep），避免逐个节点操作的 O(N²) 开销
 */
export function convertBlocksToParagraphs(tr: Transaction): Transaction {
  const doc = tr.doc;
  const schema = doc.type.schema;
  const newContent: ProseMirrorNode[] = [];
  let changed = false;

  doc.forEach((node) => {
    const processed = processNodeForSourceConversion(node, schema);
    if (Array.isArray(processed)) {
      newContent.push(...processed);
      changed = true;
    } else {
      newContent.push(processed);
      if (processed !== node) changed = true;
    }
  });

  if (changed && newContent.length > 0) {
    const step = new ReplaceStep(0, doc.content.size, new Slice(Fragment.from(newContent), 0, 0));
    tr.step(step);
  }

  return tr;
}

/**
 * 递归处理节点，转换代码块段落
 */
function processNodeForBlockConversion(
  node: ProseMirrorNode,
  schema: Schema
): ProseMirrorNode | ProseMirrorNode[] {
  // 如果节点有子节点，递归处理
  if (node.content.size > 0) {
    const newChildren: ProseMirrorNode[] = [];
    let codeBlockGroup: ProseMirrorNode[] = [];
    let currentCodeBlockId: string | null = null;
    let tableGroup: ProseMirrorNode[] = [];
    let currentTableId: string | null = null;
    let htmlBlockGroup: ProseMirrorNode[] = [];
    let currentHtmlBlockId: string | null = null;
    let mathBlockGroup: ProseMirrorNode[] = [];
    let currentMathBlockId: string | null = null;

    const flushCodeBlockGroup = () => {
      if (codeBlockGroup.length === 0) return;
      const paragraphs = codeBlockGroup.map((n) => ({ node: n, pos: 0 }));
      const result = transformParagraphsToCodeBlock(paragraphs, schema);
      if (result) {
        newChildren.push(result.codeBlock);
      } else {
        newChildren.push(...codeBlockGroup);
      }
      codeBlockGroup = [];
      currentCodeBlockId = null;
    };

    const flushTableGroup = () => {
      if (tableGroup.length === 0) return;
      const paragraphs = tableGroup.map((n) => ({ node: n, pos: 0 }));
      const result = transformParagraphsToTable(paragraphs, schema);
      if (result) {
        newChildren.push(result);
      } else {
        newChildren.push(...tableGroup);
      }
      tableGroup = [];
      currentTableId = null;
    };

    const flushHtmlBlockGroup = () => {
      if (htmlBlockGroup.length === 0) return;
      const paragraphs = htmlBlockGroup.map((n) => ({ node: n, pos: 0 }));
      const result = transformParagraphsToHtmlBlock(paragraphs, schema);
      if (result) {
        newChildren.push(result);
      } else {
        newChildren.push(...htmlBlockGroup);
      }
      htmlBlockGroup = [];
      currentHtmlBlockId = null;
    };

    const flushMathBlockGroup = () => {
      if (mathBlockGroup.length === 0) return;
      const paragraphs = mathBlockGroup.map((n) => ({ node: n, pos: 0 }));
      const result = transformParagraphsToMathBlock(paragraphs, schema);
      if (result) {
        newChildren.push(result);
      } else {
        newChildren.push(...mathBlockGroup);
      }
      mathBlockGroup = [];
      currentMathBlockId = null;
    };

    node.content.forEach((child) => {
      if (child.type.name === "paragraph") {
        const codeBlockId = child.attrs.codeBlockId;
        const tableId = child.attrs.tableId;
        const htmlBlockId = child.attrs.htmlBlockId;
        const mathBlockId = child.attrs.mathBlockId;

        if (codeBlockId) {
          // 代码块段落
          flushTableGroup();
          flushHtmlBlockGroup();
          flushMathBlockGroup();
          if (currentCodeBlockId && currentCodeBlockId !== codeBlockId) {
            flushCodeBlockGroup();
          }
          currentCodeBlockId = codeBlockId;
          codeBlockGroup.push(child);
          return;
        }

        if (tableId) {
          // 表格段落
          flushCodeBlockGroup();
          flushHtmlBlockGroup();
          flushMathBlockGroup();
          if (currentTableId && currentTableId !== tableId) {
            flushTableGroup();
          }
          currentTableId = tableId;
          tableGroup.push(child);
          return;
        }

        if (htmlBlockId) {
          // HTML 块段落
          flushCodeBlockGroup();
          flushTableGroup();
          flushMathBlockGroup();
          if (currentHtmlBlockId && currentHtmlBlockId !== htmlBlockId) {
            flushHtmlBlockGroup();
          }
          currentHtmlBlockId = htmlBlockId;
          htmlBlockGroup.push(child);
          return;
        }

        if (mathBlockId) {
          // 数学公式块段落
          flushCodeBlockGroup();
          flushTableGroup();
          flushHtmlBlockGroup();
          if (currentMathBlockId && currentMathBlockId !== mathBlockId) {
            flushMathBlockGroup();
          }
          currentMathBlockId = mathBlockId;
          mathBlockGroup.push(child);
          return;
        }

        // 非特殊段落，先刷新之前的组
        flushCodeBlockGroup();
        flushTableGroup();
        flushHtmlBlockGroup();
        flushMathBlockGroup();

        if (child.attrs.imageAttrs) {
          const image = transformParagraphToImage(child, schema);
          newChildren.push(image || child);
        } else if (child.attrs.hrSource) {
          const hr = transformParagraphToHr(child, schema);
          newChildren.push(hr || child);
        } else {
          newChildren.push(child);
        }
      } else {
        flushCodeBlockGroup();
        flushTableGroup();
        flushHtmlBlockGroup();
        flushMathBlockGroup();
        // 递归处理子节点
        const processed = processNodeForBlockConversion(child, schema);
        if (Array.isArray(processed)) {
          newChildren.push(...processed);
        } else {
          newChildren.push(processed);
        }
      }
    });

    // 刷新最后一组
    flushCodeBlockGroup();
    flushTableGroup();
    flushHtmlBlockGroup();
    flushMathBlockGroup();

    // 如果内容有变化，创建新节点
    const newContent = Fragment.from(newChildren);
    if (!newContent.eq(node.content)) {
      return node.type.create(node.attrs, newContent, node.marks);
    }
  }

  return node;
}

/**
 * 将文档中的特殊段落转换回对应的块级元素（代码块、图片、分割线）
 * 使用整体替换文档内容的方式，避免逐个节点操作的位置映射问题
 */
export function convertParagraphsToBlocks(tr: Transaction): Transaction {
  const doc = tr.doc;
  const schema = doc.type.schema;
  const newContent: ProseMirrorNode[] = [];

  // 收集代码块段落组
  let codeBlockGroup: ProseMirrorNode[] = [];
  let currentCodeBlockId: string | null = null;
  // 收集表格段落组
  let tableGroup: ProseMirrorNode[] = [];
  let currentTableId: string | null = null;
  // 收集 HTML 块段落组
  let htmlBlockGroup: ProseMirrorNode[] = [];
  let currentHtmlBlockId: string | null = null;
  // 收集数学公式块段落组
  let mathBlockGroup: ProseMirrorNode[] = [];
  let currentMathBlockId: string | null = null;

  const flushCodeBlockGroup = () => {
    if (codeBlockGroup.length === 0) return;
    const paragraphs = codeBlockGroup.map((node) => ({ node, pos: 0 }));
    const result = transformParagraphsToCodeBlock(paragraphs, schema);
    if (result) {
      newContent.push(result.codeBlock);
    } else {
      // 转换失败，保留原始段落
      newContent.push(...codeBlockGroup);
    }
    codeBlockGroup = [];
    currentCodeBlockId = null;
  };

  const flushTableGroup = () => {
    if (tableGroup.length === 0) return;
    const paragraphs = tableGroup.map((node) => ({ node, pos: 0 }));
    const result = transformParagraphsToTable(paragraphs, schema);
    if (result) {
      newContent.push(result);
    } else {
      newContent.push(...tableGroup);
    }
    tableGroup = [];
    currentTableId = null;
  };

  const flushHtmlBlockGroup = () => {
    if (htmlBlockGroup.length === 0) return;
    const paragraphs = htmlBlockGroup.map((node) => ({ node, pos: 0 }));
    const result = transformParagraphsToHtmlBlock(paragraphs, schema);
    if (result) {
      newContent.push(result);
    } else {
      newContent.push(...htmlBlockGroup);
    }
    htmlBlockGroup = [];
    currentHtmlBlockId = null;
  };

  const flushMathBlockGroup = () => {
    if (mathBlockGroup.length === 0) return;
    const paragraphs = mathBlockGroup.map((node) => ({ node, pos: 0 }));
    const result = transformParagraphsToMathBlock(paragraphs, schema);
    if (result) {
      newContent.push(result);
    } else {
      newContent.push(...mathBlockGroup);
    }
    mathBlockGroup = [];
    currentMathBlockId = null;
  };

  doc.forEach((node) => {
    if (node.type.name === "paragraph") {
      const codeBlockId = node.attrs.codeBlockId;
      const tableId = node.attrs.tableId;
      const htmlBlockId = node.attrs.htmlBlockId;
      const mathBlockId = node.attrs.mathBlockId;

      if (codeBlockId) {
        // 代码块段落
        flushTableGroup();
        flushHtmlBlockGroup();
        flushMathBlockGroup();
        if (currentCodeBlockId && currentCodeBlockId !== codeBlockId) {
          flushCodeBlockGroup();
        }
        currentCodeBlockId = codeBlockId;
        codeBlockGroup.push(node);
        return;
      }

      if (tableId) {
        // 表格段落
        flushCodeBlockGroup();
        flushHtmlBlockGroup();
        flushMathBlockGroup();
        if (currentTableId && currentTableId !== tableId) {
          flushTableGroup();
        }
        currentTableId = tableId;
        tableGroup.push(node);
        return;
      }

      if (htmlBlockId) {
        // HTML 块段落
        flushCodeBlockGroup();
        flushTableGroup();
        flushMathBlockGroup();
        if (currentHtmlBlockId && currentHtmlBlockId !== htmlBlockId) {
          flushHtmlBlockGroup();
        }
        currentHtmlBlockId = htmlBlockId;
        htmlBlockGroup.push(node);
        return;
      }

      if (mathBlockId) {
        // 数学公式块段落
        flushCodeBlockGroup();
        flushTableGroup();
        flushHtmlBlockGroup();
        if (currentMathBlockId && currentMathBlockId !== mathBlockId) {
          flushMathBlockGroup();
        }
        currentMathBlockId = mathBlockId;
        mathBlockGroup.push(node);
        return;
      }

      // 非特殊段落，先刷新之前的组
      flushCodeBlockGroup();
      flushTableGroup();
      flushHtmlBlockGroup();
      flushMathBlockGroup();

      if (node.attrs.imageAttrs) {
        // 图片段落
        const image = transformParagraphToImage(node, schema);
        newContent.push(image || node);
      } else if (node.attrs.hrSource) {
        // 分割线段落
        const hr = transformParagraphToHr(node, schema);
        newContent.push(hr || node);
      } else {
        newContent.push(node);
      }
    } else {
      flushCodeBlockGroup();
      flushTableGroup();
      flushHtmlBlockGroup();
      flushMathBlockGroup();
      // 递归处理子节点
      const processed = processNodeForBlockConversion(node, schema);
      if (Array.isArray(processed)) {
        newContent.push(...processed);
      } else {
        newContent.push(processed);
      }
    }
  });

  // 刷新最后一组
  flushCodeBlockGroup();
  flushTableGroup();
  flushHtmlBlockGroup();
  flushMathBlockGroup();

  if (newContent.length > 0) {
    const step = new ReplaceStep(0, doc.content.size, new Slice(Fragment.from(newContent), 0, 0));
    tr.step(step);
  }

  return tr;
}

/**
 * 创建源码模式文档转换插件
 */
export function createSourceViewTransformPlugin(): Plugin {
  return new Plugin({
    key: sourceViewTransformPluginKey,

    appendTransaction(transactions, oldState, newState) {
      // 检查是否有源码模式切换
      const oldDecorationState = decorationPluginKey.getState(oldState);
      const newDecorationState = decorationPluginKey.getState(newState);

      if (!oldDecorationState || !newDecorationState) return null;

      const oldSourceView = oldDecorationState.sourceView;
      const newSourceView = newDecorationState.sourceView;

      // 源码模式状态发生变化
      if (oldSourceView !== newSourceView) {
        const tr = newState.tr;

        if (newSourceView) {
          // 进入源码模式：将块级元素转换为段落
          convertBlocksToParagraphs(tr);
        } else {
          // 退出源码模式：将段落转换回块级元素
          convertParagraphsToBlocks(tr);
        }

        // 如果有变化，返回 transaction
        return tr.docChanged ? tr : null;
      }

      // 在源码模式下，检查文档中是否有未转换的块级节点
      // （例如通过 setMarkdown 重新加载内容时产生的）
      if (newSourceView) {
        let hasBlocks = false;
        newState.doc.descendants((node) => {
          if (
            node.type.name === "code_block" ||
            node.type.name === "image" ||
            node.type.name === "horizontal_rule" ||
            node.type.name === "table" ||
            node.type.name === "html_block" ||
            node.type.name === "math_block"
          ) {
            hasBlocks = true;
          }
          return !hasBlocks; // 找到一个就停止遍历
        });

        if (hasBlocks) {
          const tr = newState.tr;
          convertBlocksToParagraphs(tr);
          return tr.docChanged ? tr : null;
        }
      }

      return null;
    },
  });
}
