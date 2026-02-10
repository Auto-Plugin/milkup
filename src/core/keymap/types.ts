/**
 * 快捷键系统类型定义
 */

/** 快捷键动作 ID */
export type ShortcutActionId =
  | "toggleStrong"
  | "toggleEmphasis"
  | "toggleCodeInline"
  | "toggleStrikethrough"
  | "toggleHighlight"
  | "setHeading1"
  | "setHeading2"
  | "setHeading3"
  | "setHeading4"
  | "setHeading5"
  | "setHeading6"
  | "setParagraph"
  | "setCodeBlock"
  | "wrapInBlockquote"
  | "wrapInBulletList"
  | "wrapInOrderedList"
  | "liftBlock"
  | "insertHorizontalRule"
  | "insertTable"
  | "insertMathBlock"
  | "toggleSourceView"
  | "undo"
  | "redo";

/** 快捷键分类 */
export type ShortcutCategory = "inline" | "block" | "insert" | "editor";

/** 快捷键定义 */
export interface ShortcutDefinition {
  id: ShortcutActionId;
  /** 中文显示名 */
  label: string;
  /** 分类 */
  category: ShortcutCategory;
  /** 当前绑定键（ProseMirror 格式） */
  key: string;
  /** 默认键 */
  defaultKey: string;
}

/** 用户自定义快捷键映射（仅存储与默认值不同的部分） */
export type ShortcutKeyMap = Partial<Record<ShortcutActionId, string>>;
