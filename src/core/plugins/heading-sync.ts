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
 * 使用完整文本内容检测 # 数量（而非仅检查 syntax_marker 文本），
 * 以支持用户新增 # 字符（新增的 # 因 inclusive:false 不带 syntax_marker）
 */
function checkHeadingLevel(
  node: Node,
  pos: number
): { pos: number; currentLevel: number; newLevel: number } | null {
  if (node.type.name !== "heading") return null;

  const currentLevel = node.attrs.level as number;
  const textContent = node.textContent;

  // 从完整文本内容检测行首 # 数量（需要后跟空格或为行尾）
  const match = textContent.match(/^(#{1,6})(\s|$)/);

  if (!match) {
    // 没有有效的标题语法，转换为段落
    return { pos, currentLevel, newLevel: 0 };
  }

  const hashCount = match[1].length;

  if (hashCount !== currentLevel) {
    return { pos, currentLevel, newLevel: hashCount };
  }

  // 级别正确，检查 # 字符上的 syntax_marker 是否完整
  let needsMarkFix = false;
  let offset = 0;
  node.forEach((child) => {
    if (needsMarkFix || offset >= hashCount) return;
    if (child.isText) {
      const childTextLen = child.text?.length || 0;
      if (offset < hashCount) {
        const hasCorrectMark = child.marks.some(
          (m) => m.type.name === "syntax_marker" && m.attrs.syntaxType === "heading"
        );
        if (!hasCorrectMark) {
          needsMarkFix = true;
        }
      }
      offset += childTextLen;
    } else {
      offset += child.nodeSize;
    }
  });

  if (needsMarkFix) {
    // 级别不变，但需要修复 syntax_marker 标记
    return { pos, currentLevel, newLevel: currentLevel };
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

      // 跳过语法插件产生的 transaction
      if (transactions.some((tr) => tr.getMeta("syntax-plugin-internal"))) return null;

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
            // 收集节点内容（移除 syntax_marker 和紧跟其后的空格）
            const content: Node[] = [];
            let skipNextSpace = false;
            node.forEach((child) => {
              if (child.isText) {
                const syntaxMark = child.marks.find((m) => m.type.name === "syntax_marker");
                if (syntaxMark && syntaxMark.attrs.syntaxType === "heading") {
                  skipNextSpace = true;
                  return; // 跳过语法标记
                }
                if (skipNextSpace) {
                  skipNextSpace = false;
                  // 如果这个文本节点是空格，跳过它
                  if (child.text === " ") {
                    return;
                  }
                  // 如果以空格开头，去掉开头的空格
                  if (child.text && child.text.startsWith(" ")) {
                    const trimmed = child.text.slice(1);
                    if (trimmed) {
                      content.push(newState.schema.text(trimmed, child.marks));
                    }
                    return;
                  }
                }
                content.push(child);
              } else {
                skipNextSpace = false;
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
          // 更新标题级别（仅在级别变化时）
          if (update.newLevel !== update.currentLevel) {
            tr = tr.setNodeMarkup(update.pos, undefined, {
              ...newState.doc.nodeAt(update.pos)?.attrs,
              level: update.newLevel,
            });
          }

          // 更新 # 上的 syntax_marker 标记（级别变化或标记缺失时都需要）
          const syntaxMarkerType = newState.schema.marks.syntax_marker;
          if (syntaxMarkerType) {
            const hashStart = update.pos + 1;
            const clearEnd = hashStart + Math.max(update.currentLevel, update.newLevel);
            // 清除旧范围的 syntax_marker
            tr = tr.removeMark(hashStart, clearEnd, syntaxMarkerType);
            // 添加新的 syntax_marker 到正确范围
            const syntaxMark = syntaxMarkerType.create({ syntaxType: "heading" });
            tr = tr.addMark(hashStart, hashStart + update.newLevel, syntaxMark);
          }
        }
      }

      return tr.docChanged ? tr : null;
    },
  });
}
