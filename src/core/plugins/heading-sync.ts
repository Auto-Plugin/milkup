/**
 * Milkup 标题同步插件
 *
 * 监听标题节点的变化，根据 # 的数量自动更新标题级别
 * 当用户删除或添加 # 时，自动调整标题级别
 */

import { Plugin, PluginKey, Transaction } from "prosemirror-state";
import { Node } from "prosemirror-model";

/** 插件 Key */
export const headingSyncPluginKey = new PluginKey("milkup-heading-sync");

/**
 * 检查标题节点并返回需要更新的信息
 */
function checkHeadingLevel(
  node: Node,
  pos: number
): { pos: number; currentLevel: number; newLevel: number } | null {
  if (node.type.name !== "heading") return null;

  const currentLevel = node.attrs.level as number;

  // 查找标题内容中的 # 数量
  let hashCount = 0;
  let foundSyntaxMarker = false;

  node.forEach((child) => {
    if (child.isText) {
      const syntaxMark = child.marks.find((m) => m.type.name === "syntax_marker");
      if (syntaxMark && syntaxMark.attrs.syntaxType === "heading") {
        foundSyntaxMarker = true;
        // 计算 # 的数量
        const text = child.text || "";
        const match = text.match(/^(#{1,6})\s*$/);
        if (match) {
          hashCount = match[1].length;
        }
      }
    }
  });

  // 如果没有找到语法标记，或者 # 数量为 0，将标题转换为段落
  if (!foundSyntaxMarker || hashCount === 0) {
    return { pos, currentLevel, newLevel: 0 }; // 0 表示转换为段落
  }

  // 如果 # 数量与当前级别不同，需要更新
  if (hashCount !== currentLevel && hashCount >= 1 && hashCount <= 6) {
    return { pos, currentLevel, newLevel: hashCount };
  }

  return null;
}

/**
 * 创建标题同步插件
 */
export function createHeadingSyncPlugin(): Plugin {
  return new Plugin({
    key: headingSyncPluginKey,

    appendTransaction(transactions, oldState, newState) {
      // 只在文档变化时处理
      const docChanged = transactions.some((tr) => tr.docChanged);
      if (!docChanged) return null;

      const updates: Array<{ pos: number; currentLevel: number; newLevel: number }> = [];

      // 遍历所有标题节点
      newState.doc.descendants((node, pos) => {
        if (node.type.name === "heading") {
          const update = checkHeadingLevel(node, pos);
          if (update) {
            updates.push(update);
          }
        }
        return true;
      });

      if (updates.length === 0) return null;

      let tr = newState.tr;

      for (const update of updates) {
        if (update.newLevel === 0) {
          // 转换为段落：移除语法标记的 marks，将节点类型改为 paragraph
          const node = newState.doc.nodeAt(update.pos);
          if (node) {
            // 收集节点内容（移除 syntax_marker）
            const content: Node[] = [];
            node.forEach((child) => {
              if (child.isText) {
                const syntaxMark = child.marks.find((m) => m.type.name === "syntax_marker");
                if (!syntaxMark || syntaxMark.attrs.syntaxType !== "heading") {
                  content.push(child);
                }
              } else {
                content.push(child);
              }
            });

            // 创建新的段落节点
            const paragraph = newState.schema.nodes.paragraph.create(
              null,
              content.length > 0 ? content : undefined
            );

            tr = tr.replaceWith(update.pos, update.pos + node.nodeSize, paragraph);
          }
        } else {
          // 更新标题级别
          tr = tr.setNodeMarkup(update.pos, undefined, {
            ...newState.doc.nodeAt(update.pos)?.attrs,
            level: update.newLevel,
          });

          // 同时更新语法标记的文本
          const node = newState.doc.nodeAt(update.pos);
          if (node) {
            let offset = update.pos + 1;
            node.forEach((child) => {
              if (child.isText) {
                const syntaxMark = child.marks.find((m) => m.type.name === "syntax_marker");
                if (syntaxMark && syntaxMark.attrs.syntaxType === "heading") {
                  const oldText = child.text || "";
                  const newText = "#".repeat(update.newLevel) + " ";
                  if (oldText !== newText) {
                    // 这里不需要更新文本，因为用户已经手动修改了
                  }
                }
              }
              offset += child.nodeSize;
            });
          }
        }
      }

      return tr.docChanged ? tr : null;
    },
  });
}
