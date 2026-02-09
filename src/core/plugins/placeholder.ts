/**
 * Milkup Placeholder 插件
 *
 * 在编辑器为空时显示占位符文本
 */

import { Plugin, PluginKey } from "prosemirror-state";

/** 插件 Key */
export const placeholderPluginKey = new PluginKey("milkup-placeholder");

/**
 * 检查文档是否为空
 */
function isEmpty(doc: any): boolean {
  // 文档只有一个子节点
  if (doc.childCount !== 1) return false;

  const firstChild = doc.firstChild;

  // 第一个子节点是段落
  if (firstChild.type.name !== "paragraph") return false;

  // 段落没有内容或只有空白内容
  return firstChild.content.size === 0;
}

/**
 * 创建 placeholder 插件
 */
export function createPlaceholderPlugin(placeholder: string): Plugin {
  return new Plugin({
    key: placeholderPluginKey,

    props: {
      attributes(state) {
        const doc = state.doc;

        // 如果文档为空，添加 empty 类和 data-placeholder 属性
        if (isEmpty(doc)) {
          return {
            "data-placeholder": placeholder,
            class: "milkup-editor milkup-empty",
          };
        }

        return {
          class: "milkup-editor",
        };
      },
    },
  });
}
