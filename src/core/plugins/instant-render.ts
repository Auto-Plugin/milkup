/**
 * Milkup 即时渲染插件
 *
 * 核心插件，实现 Typora 风格的即时渲染效果
 * - 语法标记是真实的文本内容
 * - 光标可以在语法标记内自由移动
 * - 根据光标位置动态显示/隐藏语法标记
 */

import { Plugin, PluginKey, EditorState, Transaction } from "prosemirror-state";
import { Node } from "prosemirror-model";
import {
  createDecorationPlugin,
  findSyntaxMarkerRegions,
  type SyntaxMarkerRegion,
} from "../decorations";

/** 即时渲染插件状态 */
export interface InstantRenderState {
  enabled: boolean;
  activeRegions: SyntaxMarkerRegion[];
  lastCursorPos: number;
}

/** 即时渲染插件 Key */
export const instantRenderPluginKey = new PluginKey<InstantRenderState>("milkup-instant-render");

/** 插件配置 */
export interface InstantRenderConfig {
  enabled?: boolean;
  delay?: number;
}

const defaultConfig: InstantRenderConfig = {
  enabled: true,
  delay: 0,
};

/**
 * 创建即时渲染插件
 */
export function createInstantRenderPlugin(config: InstantRenderConfig = {}): Plugin[] {
  const mergedConfig = { ...defaultConfig, ...config };

  const decorationPlugin = createDecorationPlugin(false);

  const controlPlugin = new Plugin<InstantRenderState>({
    key: instantRenderPluginKey,

    state: {
      init() {
        return {
          enabled: mergedConfig.enabled!,
          activeRegions: [],
          lastCursorPos: 0,
        };
      },

      apply(tr, state, _oldEditorState, newEditorState) {
        const meta = tr.getMeta(instantRenderPluginKey);

        if (meta?.enabled !== undefined) {
          return {
            ...state,
            enabled: meta.enabled,
          };
        }

        const cursorPos = newEditorState.selection.head;
        if (cursorPos !== state.lastCursorPos || tr.docChanged) {
          const regions = findSyntaxMarkerRegions(newEditorState.doc);
          const activeRegions = regions.filter((r) => cursorPos >= r.from && cursorPos <= r.to);

          return {
            ...state,
            activeRegions,
            lastCursorPos: cursorPos,
          };
        }

        return state;
      },
    },
  });

  return [decorationPlugin, controlPlugin];
}

/**
 * 启用即时渲染
 */
export function enableInstantRender(
  state: EditorState,
  dispatch?: (tr: Transaction) => void
): boolean {
  if (dispatch) {
    const tr = state.tr.setMeta(instantRenderPluginKey, { enabled: true });
    dispatch(tr);
  }
  return true;
}

/**
 * 禁用即时渲染
 */
export function disableInstantRender(
  state: EditorState,
  dispatch?: (tr: Transaction) => void
): boolean {
  if (dispatch) {
    const tr = state.tr.setMeta(instantRenderPluginKey, { enabled: false });
    dispatch(tr);
  }
  return true;
}

/**
 * 切换即时渲染
 */
export function toggleInstantRender(
  state: EditorState,
  dispatch?: (tr: Transaction) => void
): boolean {
  const pluginState = instantRenderPluginKey.getState(state);
  if (!pluginState) return false;

  if (dispatch) {
    const tr = state.tr.setMeta(instantRenderPluginKey, { enabled: !pluginState.enabled });
    dispatch(tr);
  }
  return true;
}

/**
 * 获取当前即时渲染状态
 */
export function getInstantRenderState(state: EditorState): InstantRenderState | undefined {
  return instantRenderPluginKey.getState(state);
}

/**
 * 获取当前活跃的语法区域
 */
export function getActiveRegionsFromState(state: EditorState): SyntaxMarkerRegion[] {
  const pluginState = instantRenderPluginKey.getState(state);
  return pluginState?.activeRegions ?? [];
}
