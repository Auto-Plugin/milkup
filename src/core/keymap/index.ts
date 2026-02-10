/**
 * Milkup 快捷键插件
 *
 * 定义编辑器快捷键
 */

import { keymap } from "prosemirror-keymap";
import { Plugin, TextSelection } from "prosemirror-state";
import { Schema } from "prosemirror-model";
import {
  toggleMark,
  setBlockType,
  wrapIn,
  lift,
  joinUp,
  joinDown,
  selectParentNode,
} from "prosemirror-commands";
import { undo, redo } from "prosemirror-history";
import { splitListItem, liftListItem, sinkListItem } from "prosemirror-schema-list";
import { milkupSchema } from "../schema";
import { toggleSourceView, decorationPluginKey } from "../decorations";

/** 快捷键配置 */
export interface KeymapConfig {
  /** 是否启用基础快捷键 */
  basic?: boolean;
  /** 是否启用 Markdown 快捷键 */
  markdown?: boolean;
  /** 是否启用列表快捷键 */
  list?: boolean;
  /** 自定义快捷键 */
  custom?: Record<string, (state: any, dispatch?: any) => boolean>;
}

const defaultConfig: KeymapConfig = {
  basic: true,
  markdown: true,
  list: true,
};

/**
 * 创建基础快捷键
 */
function createBasicKeymap(schema: Schema): Record<string, any> {
  return {
    "Mod-z": undo,
    "Mod-y": redo,
    "Mod-Shift-z": redo,
    "Alt-ArrowUp": joinUp,
    "Alt-ArrowDown": joinDown,
    Escape: selectParentNode,
  };
}

/**
 * 创建 Markdown 快捷键
 */
function createMarkdownKeymap(schema: Schema): Record<string, any> {
  const keys: Record<string, any> = {};

  // 粗体 Ctrl+B
  if (schema.marks.strong) {
    keys["Mod-b"] = toggleMark(schema.marks.strong);
  }

  // 斜体 Ctrl+I
  if (schema.marks.emphasis) {
    keys["Mod-i"] = toggleMark(schema.marks.emphasis);
  }

  // 行内代码 Ctrl+`
  if (schema.marks.code_inline) {
    keys["Mod-`"] = toggleMark(schema.marks.code_inline);
  }

  // 删除线 Ctrl+Shift+S
  if (schema.marks.strikethrough) {
    keys["Mod-Shift-s"] = toggleMark(schema.marks.strikethrough);
  }

  // 高亮 Ctrl+Shift+H
  if (schema.marks.highlight) {
    keys["Mod-Shift-h"] = toggleMark(schema.marks.highlight);
  }

  // 标题 Ctrl+1~6
  if (schema.nodes.heading) {
    for (let level = 1; level <= 6; level++) {
      keys[`Mod-${level}`] = setBlockType(schema.nodes.heading, { level });
    }
  }

  // 段落 Ctrl+0
  if (schema.nodes.paragraph) {
    keys["Mod-0"] = setBlockType(schema.nodes.paragraph);
  }

  // 代码块 Ctrl+Shift+C
  if (schema.nodes.code_block) {
    keys["Mod-Shift-c"] = setBlockType(schema.nodes.code_block);
  }

  // 引用 Ctrl+Shift+Q
  if (schema.nodes.blockquote) {
    keys["Mod-Shift-q"] = wrapIn(schema.nodes.blockquote);
  }

  // 源码视图切换 Ctrl+/
  keys["Mod-/"] = toggleSourceView;

  return keys;
}

/**
 * 创建块级元素 Enter 键处理
 * - 当输入 ``` 或 ```lang 后按回车，创建代码块
 * - 当输入 --- 或 *** 或 ___ 后按回车，创建分割线
 */
function createBlockEnterKeymap(schema: Schema): Record<string, any> {
  return {
    Enter: (state: any, dispatch: any) => {
      const { $from, empty } = state.selection;

      // 只处理光标选区
      if (!empty) {
        return false;
      }

      const parent = $from.parent;

      // 只处理段落
      if (parent.type.name !== "paragraph") {
        return false;
      }

      const text = parent.textContent;
      const depth = $from.depth;
      const paragraphStart = $from.before(depth);
      const paragraphEnd = $from.after(depth);

      // 分割线：--- 或 *** 或 ___（3个或更多相同字符）
      if (schema.nodes.horizontal_rule && /^([-*_])\1{2,}$/.test(text)) {
        // 源码视图模式下不自动创建分割线
        const decorationState = decorationPluginKey.getState(state);
        if (decorationState?.sourceView) {
          return false;
        }

        const hr = schema.nodes.horizontal_rule.create();
        const paragraph = schema.nodes.paragraph.create();
        const tr = state.tr.replaceWith(paragraphStart, paragraphEnd, [hr, paragraph]);
        tr.setSelection(TextSelection.create(tr.doc, paragraphStart + hr.nodeSize + 1));

        if (dispatch) {
          dispatch(tr);
        }
        return true;
      }

      // 代码块：``` 或 ```lang
      if (schema.nodes.code_block) {
        // 源码视图模式下不自动创建代码块
        const decorationState = decorationPluginKey.getState(state);
        if (decorationState?.sourceView) {
          return false;
        }

        const codeBlockMatch = text.match(/^```(\w*)$/);
        if (!codeBlockMatch) {
          return false;
        }

        const language = codeBlockMatch[1] || "";
        const codeBlock = schema.nodes.code_block.create({ language });
        const tr = state.tr.replaceWith(paragraphStart, paragraphEnd, codeBlock);
        tr.setSelection(TextSelection.create(tr.doc, paragraphStart + 1));

        if (dispatch) {
          dispatch(tr);
        }
        return true;
      }

      return false;
    },
  };
}

/**
 * 创建列表快捷键
 */
function createListKeymap(schema: Schema): Record<string, any> {
  const keys: Record<string, any> = {};

  // 创建统一的 Enter 处理器，同时支持 list_item 和 task_item
  const listItemSplit = schema.nodes.list_item ? splitListItem(schema.nodes.list_item) : null;
  const taskItemSplit = schema.nodes.task_item ? splitListItem(schema.nodes.task_item) : null;

  if (listItemSplit || taskItemSplit) {
    keys["Enter"] = (state: any, dispatch: any) => {
      const { $from, empty } = state.selection;

      // 只处理光标选区
      if (!empty) {
        return false;
      }

      const parent = $from.parent;

      // 检查是否在源码模式下的代码块段落中
      const decorationState = decorationPluginKey.getState(state);
      if (
        decorationState?.sourceView &&
        parent.type.name === "paragraph" &&
        parent.attrs.codeBlockId
      ) {
        const text = parent.textContent;
        const isClosingFence = text.trim() === "```";
        const lineIndex = parent.attrs.lineIndex;
        const totalLines = parent.attrs.totalLines;
        const isLastLine = lineIndex === totalLines - 1;
        const depth = $from.depth;

        // 如果在结束围栏位置按回车
        if (isClosingFence && isLastLine) {
          // 检查是否在列表中
          let inList = false;
          for (let d = depth; d > 0; d--) {
            const node = $from.node(d);
            if (node.type.name === "list_item" || node.type.name === "task_item") {
              inList = true;
              break;
            }
          }

          if (inList) {
            // 在列表中，尝试分割列表项
            if (taskItemSplit && taskItemSplit(state, dispatch)) {
              return true;
            }
            if (listItemSplit && listItemSplit(state, dispatch)) {
              return true;
            }
            return false;
          } else {
            // 不在列表中，创建新段落
            if (dispatch) {
              const paragraphEnd = $from.after(depth);
              const newParagraph = schema.nodes.paragraph.create();
              const tr = state.tr.insert(paragraphEnd, newParagraph);
              tr.setSelection(TextSelection.create(tr.doc, paragraphEnd + 1));
              dispatch(tr);
            }
            return true;
          }
        }

        // 在代码块内容中按回车，分割当前段落
        if (dispatch) {
          const codeBlockId = parent.attrs.codeBlockId;
          const tr = state.tr.split($from.pos);

          // split 后两个段落都继承了原始属性（相同的 lineIndex）
          // 需要更新：第二个段落 lineIndex+1，后续段落 lineIndex+1，所有段落 totalLines+1
          let foundSplit = false;
          tr.doc.descendants((node: any, pos: number) => {
            if (node.type.name === "paragraph" && node.attrs.codeBlockId === codeBlockId) {
              if (node.attrs.lineIndex === lineIndex && !foundSplit) {
                // 第一个（原始段落的前半部分）
                foundSplit = true;
                tr.setNodeMarkup(pos, null, {
                  ...node.attrs,
                  totalLines: totalLines + 1,
                });
              } else if (node.attrs.lineIndex === lineIndex && foundSplit) {
                // 第二个（分割出的新段落）
                tr.setNodeMarkup(pos, null, {
                  ...node.attrs,
                  lineIndex: lineIndex + 1,
                  totalLines: totalLines + 1,
                });
              } else if (node.attrs.lineIndex > lineIndex) {
                tr.setNodeMarkup(pos, null, {
                  ...node.attrs,
                  lineIndex: node.attrs.lineIndex + 1,
                  totalLines: totalLines + 1,
                });
              } else {
                tr.setNodeMarkup(pos, null, {
                  ...node.attrs,
                  totalLines: totalLines + 1,
                });
              }
            }
          });

          dispatch(tr);
        }
        return true;
      }

      // 先尝试分割任务列表项
      if (taskItemSplit && taskItemSplit(state, dispatch)) {
        return true;
      }
      // 再尝试分割普通列表项
      if (listItemSplit && listItemSplit(state, dispatch)) {
        return true;
      }
      return false;
    };
  }

  // Backspace 处理：确保可以正常删除所有字符
  keys["Backspace"] = (state: any, dispatch: any) => {
    const { $from, $to, empty } = state.selection;

    // 只处理光标选区
    if (!empty) {
      return false;
    }

    // 如果光标在段落开头，使用默认行为（可能会合并段落或列表项）
    if ($from.parentOffset === 0) {
      return false;
    }

    // 直接删除光标前面的一个字符
    if (dispatch) {
      const tr = state.tr.delete($from.pos - 1, $from.pos);
      dispatch(tr);
    }
    return true;
  };

  // Tab 和 Shift-Tab 操作
  if (schema.nodes.list_item) {
    keys["Tab"] = sinkListItem(schema.nodes.list_item);
    keys["Shift-Tab"] = liftListItem(schema.nodes.list_item);
  }

  // 取消列表
  keys["Mod-Shift-l"] = lift;

  return keys;
}

/**
 * 创建快捷键插件
 */
export function createKeymapPlugin(
  schema: Schema = milkupSchema,
  config: KeymapConfig = {}
): Plugin[] {
  const mergedConfig = { ...defaultConfig, ...config };
  const plugins: Plugin[] = [];

  // 块级元素 Enter 键处理（优先级最高）
  plugins.push(keymap(createBlockEnterKeymap(schema)));

  if (mergedConfig.basic) {
    plugins.push(keymap(createBasicKeymap(schema)));
  }

  if (mergedConfig.markdown) {
    plugins.push(keymap(createMarkdownKeymap(schema)));
  }

  if (mergedConfig.list) {
    plugins.push(keymap(createListKeymap(schema)));
  }

  if (mergedConfig.custom) {
    plugins.push(keymap(mergedConfig.custom));
  }

  return plugins;
}

export { createBasicKeymap, createMarkdownKeymap, createListKeymap, createBlockEnterKeymap };
