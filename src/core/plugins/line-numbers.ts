/**
 * Milkup 行号插件
 *
 * 在源码模式下显示行号
 */

import { Plugin, PluginKey } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import { decorationPluginKey } from "../decorations";

/** 插件 Key */
export const lineNumbersPluginKey = new PluginKey("milkup-line-numbers");

/**
 * 创建行号装饰
 * 为顶层块级节点添加行号类
 * 代码块需要特殊处理，计算其行数
 */
function createLineNumberDecorations(doc: any, sourceView: boolean): DecorationSet {
  if (!sourceView) {
    return DecorationSet.empty;
  }

  const decorations: Decoration[] = [];

  doc.descendants((node: any, pos: number, parent: any) => {
    if (node.isBlock) {
      const isListContainer = ["bullet_list", "ordered_list", "task_list"].includes(node.type.name);
      const isListItem = ["list_item", "task_item"].includes(node.type.name);
      const parentIsListItem = parent && ["list_item", "task_item"].includes(parent.type.name);
      const parentIsDoc = parent && parent.type.name === "doc";
      const parentIsBlockquote = parent && parent.type.name === "blockquote";
      const parentIsContainer = parent && parent.type.name === "container";

      // 跳过列表容器本身
      if (isListContainer) {
        return true;
      }

      // 列表项内部的段落：每个段落独立参与行号计算
      if (parentIsListItem && node.type.name === "paragraph") {
        decorations.push(
          Decoration.node(pos, pos + node.nodeSize, {
            class: "milkup-with-line-number milkup-list-line-number",
          })
        );
        return false;
      }

      // 跳过列表项本身（行号由其内部段落承担）
      if (isListItem) {
        return true;
      }

      // 跳过列表项内部的其他块级节点
      if (parentIsListItem) {
        return true;
      }

      // doc 直接子节点、blockquote/container 直接子节点
      if (parentIsDoc || parentIsBlockquote || parentIsContainer) {
        if (node.type.name === "code_block") {
          // 代码块：计算行数（包括开始和结束的 ```）
          const language = node.attrs.language || "";
          const content = node.textContent || "";
          const fullMarkdown = `\`\`\`${language}\n${content}\n\`\`\``;
          const lineCount = fullMarkdown.split("\n").length;

          // 为代码块添加装饰，包含行数信息
          decorations.push(
            Decoration.node(pos, pos + node.nodeSize, {
              class: "milkup-code-block-with-lines",
              "data-line-count": lineCount.toString(),
            })
          );
        } else {
          // 其他块级节点：添加普通行号类
          decorations.push(
            Decoration.node(pos, pos + node.nodeSize, {
              class: "milkup-with-line-number",
            })
          );
        }
      }
    }
    return true;
  });

  return DecorationSet.create(doc, decorations);
}

/**
 * 创建行号插件
 */
export function createLineNumbersPlugin(): Plugin {
  return new Plugin({
    key: lineNumbersPluginKey,

    state: {
      init(_, state) {
        const decorationState = decorationPluginKey.getState(state);
        const sourceView = decorationState?.sourceView ?? false;
        return createLineNumberDecorations(state.doc, sourceView);
      },

      apply(tr, oldDecorations, oldState, newState) {
        // 检查源码模式状态
        const decorationState = decorationPluginKey.getState(newState);
        const sourceView = decorationState?.sourceView ?? false;

        // 如果文档没有变化且源码模式状态没有变化，保持原有装饰
        const oldDecorationState = decorationPluginKey.getState(oldState);
        const oldSourceView = oldDecorationState?.sourceView ?? false;

        if (!tr.docChanged && sourceView === oldSourceView) {
          return oldDecorations.map(tr.mapping, tr.doc);
        }

        // 重新创建装饰
        return createLineNumberDecorations(newState.doc, sourceView);
      },
    },

    props: {
      decorations(state) {
        return lineNumbersPluginKey.getState(state);
      },
    },
  });
}
