/**
 * 快捷键配置 Hook
 */

import { computed } from "vue";
import { useConfig } from "./useConfig";
import { DEFAULT_SHORTCUTS, CATEGORY_LABELS } from "@/core";
import type { ShortcutActionId, ShortcutDefinition } from "@/core";

const MODIFIER_KEYS = new Set(["Mod", "Ctrl", "Meta", "Shift", "Alt"]);
const NUMBER_SHORTCUT_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];

export function useShortcutConfig() {
  const { config } = useConfig();

  function getResolvedKey(id: ShortcutActionId, defaultKey: string): string {
    const customKey = config.value.shortcuts?.[id];
    return customKey === undefined ? defaultKey : (customKey ?? "");
  }

  /** 合并默认值和用户自定义值后的完整快捷键列表 */
  const shortcuts = computed<ShortcutDefinition[]>(() => {
    return DEFAULT_SHORTCUTS.map((def) => ({
      ...def,
      key: getResolvedKey(def.id, def.defaultKey),
    }));
  });

  /** 冲突检测：同一快捷键绑定了多个动作 */
  const conflicts = computed<Map<string, ShortcutActionId[]>>(() => {
    const keyToActions = new Map<string, ShortcutActionId[]>();
    for (const s of shortcuts.value) {
      if (!s.key) continue;
      for (const conflictKey of getShortcutConflictKeys(s)) {
        const existing = keyToActions.get(conflictKey);
        if (existing) {
          existing.push(s.id);
        } else {
          keyToActions.set(conflictKey, [s.id]);
        }
      }
    }
    // 只保留有冲突的
    const result = new Map<string, ShortcutActionId[]>();
    for (const [key, ids] of keyToActions) {
      if (ids.length > 1) {
        result.set(key, ids);
      }
    }
    return result;
  });

  /** 检查某个动作是否有冲突 */
  function hasConflict(id: ShortcutActionId): boolean {
    const s = shortcuts.value.find((s) => s.id === id);
    if (!s) return false;
    return getShortcutConflictKeys(s).some((key) => {
      const conflicting = conflicts.value.get(key);
      return !!conflicting && conflicting.length > 1;
    });
  }

  /** 获取与某个动作冲突的其他动作名称 */
  function getConflictLabels(id: ShortcutActionId): string[] {
    const s = shortcuts.value.find((s) => s.id === id);
    if (!s) return [];
    const conflictingIds = new Set<ShortcutActionId>();
    for (const key of getShortcutConflictKeys(s)) {
      const conflicting = conflicts.value.get(key);
      if (!conflicting) continue;
      for (const cid of conflicting) {
        if (cid !== id) conflictingIds.add(cid);
      }
    }
    return Array.from(conflictingIds)
      .filter((cid) => cid !== id)
      .map((cid) => {
        const def = DEFAULT_SHORTCUTS.find((d) => d.id === cid);
        return def?.label || cid;
      });
  }

  /** 更新单个快捷键 */
  function updateShortcut(id: ShortcutActionId, newKey: string | null) {
    const current = { ...config.value.shortcuts };
    const def = DEFAULT_SHORTCUTS.find((d) => d.id === id);
    // 如果和默认值相同，删除自定义项
    if (def && newKey === def.defaultKey) {
      delete current[id];
    } else {
      current[id] = newKey;
    }
    config.value = { ...config.value, shortcuts: current };
  }

  /** 清除单个快捷键绑定 */
  function clearShortcut(id: ShortcutActionId) {
    updateShortcut(id, null);
  }

  /** 重置单个快捷键 */
  function resetShortcut(id: ShortcutActionId) {
    const current = { ...config.value.shortcuts };
    delete current[id];
    config.value = { ...config.value, shortcuts: current };
  }

  /** 重置所有快捷键 */
  function resetAll() {
    config.value = { ...config.value, shortcuts: {} };
  }

  return {
    shortcuts,
    conflicts,
    hasConflict,
    getConflictLabels,
    updateShortcut,
    clearShortcut,
    resetShortcut,
    resetAll,
    CATEGORY_LABELS,
  };
}

function getShortcutConflictKeys(shortcut: ShortcutDefinition): string[] {
  if (!shortcut.key) return [];
  if (shortcut.modifierOnly && shortcut.withNumberKeys) {
    return NUMBER_SHORTCUT_KEYS.flatMap((key) =>
      expandEquivalentShortcutKeys(`${shortcut.key}-${key}`)
    );
  }
  return expandEquivalentShortcutKeys(shortcut.key);
}

function expandEquivalentShortcutKeys(key: string): string[] {
  const keys = new Set([key]);
  if (key.includes("Mod")) {
    keys.add(key.replace("Mod", "Ctrl"));
    keys.add(key.replace("Mod", "Meta"));
  }
  if (key.includes("Ctrl")) {
    keys.add(key.replace("Ctrl", "Mod"));
  }
  if (key.includes("Meta")) {
    keys.add(key.replace("Meta", "Mod"));
  }
  return Array.from(keys);
}

/**
 * 将 ProseMirror 格式的快捷键转为显示格式
 * 例如：Mod-b → Ctrl+B (Windows) / Cmd+B (Mac)
 */
export function formatKeyForDisplay(key: string): string {
  if (!key) return "未绑定";
  const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;
  return key
    .split("-")
    .map((part) => {
      if (part === "Mod") return isMac ? "Cmd" : "Ctrl";
      if (part === "Ctrl") return "Ctrl";
      if (part === "Meta") return isMac ? "Cmd" : "Meta";
      if (part === "Shift") return "Shift";
      if (part === "Alt") return isMac ? "Option" : "Alt";
      if (part === "minus") return "-";
      if (part === "/") return "/";
      if (part === "`") return "`";
      if (part.length === 1) return part.toUpperCase();
      return part;
    })
    .join("+");
}

export function formatShortcutForDisplay(shortcut: ShortcutDefinition): string {
  const base = formatKeyForDisplay(shortcut.key);
  if (!shortcut.key || !shortcut.withNumberKeys) return base;
  return `${base}+数字`;
}

function eventModifiersToParts(event: KeyboardEvent): string[] {
  const parts: string[] = [];
  if (event.ctrlKey || event.metaKey) parts.push("Mod");
  if (event.shiftKey) parts.push("Shift");
  if (event.altKey) parts.push("Alt");
  return parts;
}

function eventExactModifiersToParts(event: KeyboardEvent): string[] {
  const parts: string[] = [];
  if (event.ctrlKey) parts.push("Ctrl");
  if (event.metaKey) parts.push("Meta");
  if (event.shiftKey) parts.push("Shift");
  if (event.altKey) parts.push("Alt");
  return parts;
}

function normalizeKeyboardEventKey(key: string): string {
  if (key === "-") return "minus";
  if (key === "/" || key === "`") return key;
  if (key.length === 1) return key.toLowerCase();
  return key;
}

export function keyEventToShortcutKey(
  event: KeyboardEvent,
  shortcut?: Pick<ShortcutDefinition, "modifierOnly" | "exactModifier">
): string | null {
  if (shortcut?.exactModifier) return keyEventToExactShortcutKey(event, shortcut);
  if (!shortcut?.modifierOnly) return keyEventToProseMirrorKey(event);

  const parts = eventModifiersToParts(event);
  if (event.key === "Control" || event.key === "Meta") {
    if (!parts.includes("Mod")) parts.unshift("Mod");
  } else if (event.key === "Shift") {
    if (!parts.includes("Shift")) parts.push("Shift");
  } else if (event.key === "Alt") {
    if (!parts.includes("Alt")) parts.push("Alt");
  }

  return parts.length ? parts.join("-") : null;
}

function keyEventToExactShortcutKey(
  event: KeyboardEvent,
  shortcut?: Pick<ShortcutDefinition, "modifierOnly">
): string | null {
  const parts = eventExactModifiersToParts(event);
  if (event.key === "Control") {
    if (!parts.includes("Ctrl")) parts.unshift("Ctrl");
  } else if (event.key === "Meta") {
    if (!parts.includes("Meta")) parts.unshift("Meta");
  } else if (event.key === "Shift") {
    if (!parts.includes("Shift")) parts.push("Shift");
  } else if (event.key === "Alt") {
    if (!parts.includes("Alt")) parts.push("Alt");
  }

  if (shortcut?.modifierOnly) return parts.length ? parts.join("-") : null;
  if (["Control", "Meta", "Shift", "Alt"].includes(event.key)) return null;
  if (!parts.length) return null;

  parts.push(normalizeKeyboardEventKey(event.key));
  return parts.join("-");
}

export function eventMatchesShortcutKey(
  event: KeyboardEvent,
  shortcutKey: string,
  options: { ignoreMainKey?: boolean } = {}
): boolean {
  if (!shortcutKey) return false;

  const parts = shortcutKey.split("-");
  const keyParts = parts.filter((part) => !MODIFIER_KEYS.has(part));
  const expectedMainKey = keyParts.at(-1);
  const expectedModifiers = parts.filter((part) => MODIFIER_KEYS.has(part));
  if (!eventMatchesModifiers(event, expectedModifiers)) return false;

  if (options.ignoreMainKey) return true;
  if (!expectedMainKey) return false;

  return normalizeKeyboardEventKey(event.key) === expectedMainKey;
}

function eventMatchesModifiers(event: KeyboardEvent, expectedModifiers: string[]): boolean {
  const expectsMod = expectedModifiers.includes("Mod");
  const expectsCtrl = expectedModifiers.includes("Ctrl");
  const expectsMeta = expectedModifiers.includes("Meta");
  const expectsShift = expectedModifiers.includes("Shift");
  const expectsAlt = expectedModifiers.includes("Alt");

  if (expectsMod) {
    if (!event.ctrlKey && !event.metaKey) return false;
  } else {
    if (event.ctrlKey !== expectsCtrl) return false;
    if (event.metaKey !== expectsMeta) return false;
  }

  return event.shiftKey === expectsShift && event.altKey === expectsAlt;
}

/**
 * 将 KeyboardEvent 转为 ProseMirror 格式字符串（用于录制快捷键）
 */
export function keyEventToProseMirrorKey(event: KeyboardEvent): string | null {
  const parts = eventModifiersToParts(event);

  let key = event.key;

  // 忽略单独的修饰键
  if (["Control", "Meta", "Shift", "Alt"].includes(key)) {
    return null;
  }

  // 标准化按键名
  key = normalizeKeyboardEventKey(key);

  parts.push(key);

  // 至少需要一个修饰键
  if (!event.ctrlKey && !event.metaKey && !event.altKey) {
    return null;
  }

  return parts.join("-");
}
