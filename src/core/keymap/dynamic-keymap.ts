/**
 * 动态 Keymap 插件
 *
 * 使用 ProseMirror 的 keydownHandler 处理按键事件，
 * 支持动态更新快捷键绑定。通过缓存机制避免重复构建。
 */

import { Plugin } from "prosemirror-state";
import { Schema } from "prosemirror-model";
import { keydownHandler } from "prosemirror-keymap";
import { buildActionCommandMap } from "./action-commands";
import { DEFAULT_SHORTCUTS } from "./shortcut-registry";
import type { ShortcutKeyMap } from "./types";

/**
 * 创建动态 Keymap 插件
 *
 * @param schema - ProseMirror Schema
 * @param getCustomKeyMap - 获取用户自定义快捷键映射的回调
 */
export function createDynamicKeymapPlugin(
  schema: Schema,
  getCustomKeyMap: () => ShortcutKeyMap
): Plugin {
  const commandMap = buildActionCommandMap(schema);

  // 缓存：配置未变化时复用 handler
  let lastConfigStr = "";
  let cachedHandler: ((view: any, event: KeyboardEvent) => boolean) | null = null;

  function getHandler() {
    const customMap = getCustomKeyMap();
    const configStr = JSON.stringify(customMap);

    if (configStr !== lastConfigStr || !cachedHandler) {
      lastConfigStr = configStr;

      // 构建 ProseMirror 格式的 key → command 绑定
      const bindings: Record<string, any> = {};
      for (const shortcut of DEFAULT_SHORTCUTS) {
        const boundKey = customMap[shortcut.id] || shortcut.defaultKey;
        const command = commandMap[shortcut.id];
        if (command) {
          bindings[boundKey] = command;
        }
      }

      // 使用 ProseMirror 的 keydownHandler，确保与原生 keymap 完全一致的按键匹配
      cachedHandler = keydownHandler(bindings);
    }

    return cachedHandler!;
  }

  return new Plugin({
    props: {
      handleKeyDown(view, event) {
        return getHandler()(view, event);
      },
    },
  });
}
