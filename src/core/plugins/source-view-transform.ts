/**
 * Milkup 源码模式文档转换插件
 *
 * 在源码模式下将代码块拆分成多个段落节点
 * 在退出源码模式时将段落节点重新组合成代码块
 */

import { Plugin, PluginKey, Transaction } from "prosemirror-state";
import { Node as ProseMirrorNode, Schema } from "prosemirror-model";
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
 * 将文档中的所有代码块转换为段落
 */
function convertCodeBlocksToParagraphs(tr: Transaction): Transaction {
  const doc = tr.doc;
  const schema = doc.type.schema;
  const codeBlocks: Array<{ node: ProseMirrorNode; pos: number }> = [];

  // 收集所有代码块节点
  doc.descendants((node, pos, parent) => {
    if (node.type.name === "code_block" && parent?.type.name === "doc") {
      codeBlocks.push({ node, pos });
    }
    return true;
  });

  // 从后往前处理，避免位置偏移问题
  for (let i = codeBlocks.length - 1; i >= 0; i--) {
    const { node, pos } = codeBlocks[i];
    const paragraphs = transformCodeBlockToParagraphs(node, schema);

    // 删除代码块节点
    tr.delete(pos, pos + node.nodeSize);

    // 插入段落节点
    if (paragraphs.length > 0) {
      tr.insert(pos, paragraphs);
    }
  }

  return tr;
}

/**
 * 将文档中的代码块段落转换回代码块
 */
function convertParagraphsToCodeBlocks(tr: Transaction): Transaction {
  const doc = tr.doc;
  const schema = doc.type.schema;
  const groups = findCodeBlockParagraphGroups(doc);

  // 按位置从后往前处理，避免位置偏移问题
  const sortedGroups = Array.from(groups.entries())
    .map(([id, paragraphs]) => ({
      id,
      paragraphs: paragraphs.sort((a, b) => a.pos - b.pos),
    }))
    .sort((a, b) => b.paragraphs[0].pos - a.paragraphs[0].pos);

  for (const group of sortedGroups) {
    const { paragraphs } = group;
    if (paragraphs.length === 0) continue;

    const result = transformParagraphsToCodeBlock(paragraphs, schema);
    if (!result) continue;

    const { codeBlock } = result;
    const firstPos = paragraphs[0].pos;
    const lastPara = paragraphs[paragraphs.length - 1];
    const lastPos = lastPara.pos + lastPara.node.nodeSize;

    // 删除所有段落节点
    tr.delete(firstPos, lastPos);

    // 插入代码块节点
    tr.insert(firstPos, codeBlock);
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

      // 如果源码模式状态没有变化，不做任何处理
      if (oldSourceView === newSourceView) return null;

      const tr = newState.tr;

      if (newSourceView) {
        // 进入源码模式：将代码块转换为段落
        convertCodeBlocksToParagraphs(tr);
      } else {
        // 退出源码模式：将段落转换回代码块
        convertParagraphsToCodeBlocks(tr);
      }

      // 如果有变化，返回 transaction
      return tr.docChanged ? tr : null;
    },
  });
}
