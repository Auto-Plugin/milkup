/**
 * ShortcutActionId → ProseMirror Command 映射
 */

import { Schema } from "prosemirror-model";
import { EditorState, Transaction } from "prosemirror-state";
import { setBlockType, wrapIn, lift } from "prosemirror-commands";
import { undo, redo } from "prosemirror-history";
import { toggleSourceView, decorationPluginKey } from "../decorations";
import {
  createEnhancedToggleMark,
  createSetHeadingCommand,
  createSetParagraphCommand,
} from "../commands/enhanced-commands";
import {
  insertHorizontalRule,
  insertTable,
  insertMathBlock,
  wrapInBulletList,
  wrapInOrderedList,
} from "../commands";
import type { ShortcutActionId } from "./types";

type Command = (state: EditorState, dispatch?: (tr: Transaction) => void) => boolean;

/**
 * 构建 ActionId → Command 映射
 */
export function buildActionCommandMap(schema: Schema): Record<ShortcutActionId, Command> {
  const map = {} as Record<ShortcutActionId, Command>;

  // 内联格式 - 使用增强命令（插入 Markdown 语法文本）
  if (schema.marks.strong) {
    map.toggleStrong = createEnhancedToggleMark(schema.marks.strong);
  }
  if (schema.marks.emphasis) {
    map.toggleEmphasis = createEnhancedToggleMark(schema.marks.emphasis);
  }
  if (schema.marks.code_inline) {
    map.toggleCodeInline = createEnhancedToggleMark(schema.marks.code_inline);
  }
  if (schema.marks.strikethrough) {
    map.toggleStrikethrough = createEnhancedToggleMark(schema.marks.strikethrough);
  }
  if (schema.marks.highlight) {
    map.toggleHighlight = createEnhancedToggleMark(schema.marks.highlight);
  }

  // 块级格式 - 标题使用增强命令（插入 # 语法标记）
  for (let level = 1; level <= 6; level++) {
    map[`setHeading${level}` as ShortcutActionId] = createSetHeadingCommand(level);
  }
  map.setParagraph = createSetParagraphCommand();

  if (schema.nodes.code_block) {
    map.setCodeBlock = setBlockType(schema.nodes.code_block);
  }
  if (schema.nodes.blockquote) {
    map.wrapInBlockquote = wrapIn(schema.nodes.blockquote);
  }
  map.wrapInBulletList = wrapInBulletList;
  map.wrapInOrderedList = wrapInOrderedList;
  map.liftBlock = lift;

  // 插入
  map.insertHorizontalRule = (state: EditorState, dispatch?: (tr: Transaction) => void) => {
    const decoState = decorationPluginKey.getState(state);
    if (decoState?.sourceView) {
      // 源码模式：插入 --- 段落（与 source-view-transform 的 transformHrToParagraph 一致）
      if (dispatch) {
        const para = schema.nodes.paragraph.create({ hrSource: true }, schema.text("---"));
        const tr = state.tr.replaceSelectionWith(para);
        dispatch(tr.scrollIntoView());
      }
      return true;
    }
    return insertHorizontalRule(state, dispatch);
  };
  map.insertTable = insertTable();
  map.insertMathBlock = insertMathBlock();

  // 编辑器操作
  map.toggleSourceView = toggleSourceView;
  map.undo = undo;
  map.redo = redo;

  return map;
}
