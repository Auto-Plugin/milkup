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
 * 查找文档中所有的代码块段落组
 */
function findCodeBlockParagraphGroups(
  doc: ProseMirrorNode
): Map<string, Array<{ node: ProseMirrorNode; pos: number }>> {
  const groups = new Map<string, Array<{ node: ProseMirrorNode; pos: number }>>();

  doc.descendants((node, pos, parent) => {
    // 只处理顶层段落节点
    if (node.type.name === "paragraph" && parent?.type.name === "doc") {
      const codeBlockId = node.attrs.codeBlockId;
      if (codeBlockId) {
        if (!groups.has(codeBlockId)) {
          groups.set(codeBlockId, []);
        }
        groups.get(codeBlockId)!.push({ node, pos });
      }
    }
    return true;
  });

  return groups;
}

/**
 * 将文档中的所有块级元素（代码块、图片、分割线）转换为段落
 * 使用整体替换文档内容的方式，避免逐个节点操作的位置映射问题
 */
function convertBlocksToParagraphs(tr: Transaction): Transaction {
  const doc = tr.doc;
  const schema = doc.type.schema;
  const newContent: ProseMirrorNode[] = [];

  doc.forEach((node) => {
    if (node.type.name === "code_block") {
      newContent.push(...transformCodeBlockToParagraphs(node, schema));
    } else if (node.type.name === "image") {
      newContent.push(transformImageToParagraph(node, schema));
    } else if (node.type.name === "horizontal_rule") {
      newContent.push(transformHrToParagraph(node, schema));
    } else {
      newContent.push(node);
    }
  });

  if (newContent.length > 0) {
    const step = new ReplaceStep(0, doc.content.size, new Slice(Fragment.from(newContent), 0, 0));
    tr.step(step);
  }

  return tr;
}

/**
 * 将文档中的特殊段落转换回对应的块级元素（代码块、图片、分割线）
 * 使用整体替换文档内容的方式，避免逐个节点操作的位置映射问题
 */
function convertParagraphsToBlocks(tr: Transaction): Transaction {
  const doc = tr.doc;
  const schema = doc.type.schema;
  const newContent: ProseMirrorNode[] = [];

  // 收集代码块段落组
  let codeBlockGroup: ProseMirrorNode[] = [];
  let currentCodeBlockId: string | null = null;

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

  doc.forEach((node) => {
    if (node.type.name === "paragraph") {
      const codeBlockId = node.attrs.codeBlockId;

      if (codeBlockId) {
        // 代码块段落
        if (currentCodeBlockId && currentCodeBlockId !== codeBlockId) {
          flushCodeBlockGroup();
        }
        currentCodeBlockId = codeBlockId;
        codeBlockGroup.push(node);
        return;
      }

      // 非代码块段落，先刷新之前的代码块组
      flushCodeBlockGroup();

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
      newContent.push(node);
    }
  });

  // 刷新最后一组代码块
  flushCodeBlockGroup();

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
        newState.doc.descendants((node, pos, parent) => {
          if (
            parent?.type.name === "doc" &&
            (node.type.name === "code_block" ||
              node.type.name === "image" ||
              node.type.name === "horizontal_rule")
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
