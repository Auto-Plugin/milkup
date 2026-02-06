/**
 * Milkup 数学块状态同步插件
 *
 * 监听选区变化，更新数学块的编辑状态
 */

import { Plugin, PluginKey } from "prosemirror-state";
import { updateAllMathBlocks } from "../nodeviews/math-block";

export const mathBlockSyncPluginKey = new PluginKey("milkup-math-block-sync");

/**
 * 创建数学块状态同步插件
 */
export function createMathBlockSyncPlugin(): Plugin {
  return new Plugin({
    key: mathBlockSyncPluginKey,

    view(editorView) {
      return {
        update(view, prevState) {
          // 当选区变化时，更新所有数学块的编辑状态
          if (!prevState.selection.eq(view.state.selection)) {
            updateAllMathBlocks(view);
          }
        },
      };
    },
  });
}
