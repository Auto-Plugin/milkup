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
  | "switchNextTab"
  | "switchTabByNumber"
  | "undo"
  | "redo";

/** 快捷键分类 */
export type ShortcutCategory = "inline" | "block" | "insert" | "editor" | "app";

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
  /** 只录制修饰键，实际按键由功能自身决定 */
  modifierOnly?: boolean;
  /** 使用精确修饰键，不将 Ctrl/Meta 归一化为 Mod */
  exactModifier?: boolean;
  /** 该快捷键会与数字键组合使用 */
  withNumberKeys?: boolean;
}

/** 用户自定义快捷键映射（仅存储与默认值不同的部分；null 表示显式清除绑定） */
export type ShortcutKeyMap = Partial<Record<ShortcutActionId, string | null>>;
