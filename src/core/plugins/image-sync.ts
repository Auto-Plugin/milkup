/**
 * Milkup 图片状态同步插件
 *
 * 监听选区变化，更新图片的编辑状态
 */

import { Plugin, PluginKey } from "prosemirror-state";
import { updateAllImages } from "../nodeviews/image";

export const imageSyncPluginKey = new PluginKey("milkup-image-sync");

/**
 * 创建图片状态同步插件
 */
export function createImageSyncPlugin(): Plugin {
  return new Plugin({
    key: imageSyncPluginKey,

    view(editorView) {
      return {
        update(view, prevState) {
          // 当选区变化时，更新所有图片的编辑状态
          if (!prevState.selection.eq(view.state.selection)) {
            updateAllImages(view);
          }
        },
      };
    },
  });
}
