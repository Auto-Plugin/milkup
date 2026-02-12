/**
 * Milkup HTML 块状态同步插件
 *
 * 监听选区变化，更新 HTML 块的编辑状态
 */

import { Plugin, PluginKey } from "prosemirror-state";
import { updateAllHtmlBlocks } from "../nodeviews/html-block";

export const htmlBlockSyncPluginKey = new PluginKey("milkup-html-block-sync");

/**
 * 创建 HTML 块状态同步插件
 */
export function createHtmlBlockSyncPlugin(): Plugin {
  return new Plugin({
    key: htmlBlockSyncPluginKey,

    view(editorView) {
      return {
        update(view, prevState) {
          if (!prevState.selection.eq(view.state.selection)) {
            updateAllHtmlBlocks(view);
          }
        },
      };
    },
  });
}
