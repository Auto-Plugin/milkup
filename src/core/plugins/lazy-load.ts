/**
 * Milkup 延迟加载插件
 *
 * 对超大文件实现延迟解析和渲染
 * 初始只解析和渲染前 N 行，其余内容延迟加载
 */

import { EditorState, Plugin, PluginKey, Transaction } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { Node as ProseMirrorNode, Schema } from "prosemirror-model";
import { parseMarkdown } from "../parser";

/** 插件 Key */
export const lazyLoadPluginKey = new PluginKey("milkup-lazy-load");

/** 延迟加载配置 */
export interface LazyLoadConfig {
  /** 启用延迟加载的最小行数阈值 */
  threshold: number;
  /** 初始加载的行数 */
  initialLines: number;
  /** 每次加载的行数 */
  chunkSize: number;
}

/** 默认配置 */
const DEFAULT_CONFIG: LazyLoadConfig = {
  threshold: 1000, // 超过 1000 行启用延迟加载
  initialLines: 500, // 初始加载 500 行
  chunkSize: 500, // 每次加载 500 行
};

/** 插件状态 */
interface LazyLoadState {
  enabled: boolean;
  fullContent: string; // 完整的 Markdown 内容
  loadedLines: number; // 已加载的行数
  totalLines: number; // 总行数
  loading: boolean; // 是否正在加载
}

/**
 * 创建延迟加载插件
 */
export function createLazyLoadPlugin(config: Partial<LazyLoadConfig> = {}): Plugin<LazyLoadState> {
  const mergedConfig = { ...DEFAULT_CONFIG, ...config };

  return new Plugin<LazyLoadState>({
    key: lazyLoadPluginKey,

    state: {
      init() {
        return {
          enabled: false,
          fullContent: "",
          loadedLines: 0,
          totalLines: 0,
          loading: false,
        };
      },

      apply(tr, pluginState) {
        const meta = tr.getMeta(lazyLoadPluginKey);
        if (meta) {
          return { ...pluginState, ...meta };
        }
        return pluginState;
      },
    },

    view(editorView) {
      let scrollTimeout: NodeJS.Timeout | null = null;

      // 处理滚动事件 - 接近底部时加载更多内容
      const handleScroll = () => {
        if (scrollTimeout) {
          clearTimeout(scrollTimeout);
        }

        scrollTimeout = setTimeout(() => {
          const pluginState = lazyLoadPluginKey.getState(editorView.state);
          if (!pluginState?.enabled || pluginState.loading) return;
          if (pluginState.loadedLines >= pluginState.totalLines) return;

          const container = editorView.dom.parentElement;
          if (!container) return;

          const scrollTop = container.scrollTop;
          const scrollHeight = container.scrollHeight;
          const clientHeight = container.clientHeight;

          // 距离底部 1000px 时加载更多
          if (scrollHeight - scrollTop - clientHeight < 1000) {
            loadMoreContent(editorView, mergedConfig);
          }
        }, 100);
      };

      // 监听滚动事件
      const container = editorView.dom.parentElement;
      if (container) {
        container.addEventListener("scroll", handleScroll, { passive: true });
      }

      return {
        destroy() {
          if (scrollTimeout) {
            clearTimeout(scrollTimeout);
          }
          if (container) {
            container.removeEventListener("scroll", handleScroll);
          }
        },
      };
    },
  });
}

/**
 * 加载更多内容
 */
function loadMoreContent(view: EditorView, config: LazyLoadConfig): void {
  const pluginState = lazyLoadPluginKey.getState(view.state);
  if (!pluginState?.enabled || pluginState.loading) return;

  // 标记为加载中
  let tr = view.state.tr.setMeta(lazyLoadPluginKey, {
    ...pluginState,
    loading: true,
  });
  view.dispatch(tr);

  // 异步加载更多内容
  setTimeout(() => {
    const currentState = lazyLoadPluginKey.getState(view.state);
    if (!currentState) return;

    const lines = currentState.fullContent.split("\n");
    const nextLines = Math.min(
      currentState.loadedLines + config.chunkSize,
      currentState.totalLines
    );

    // 获取新的内容
    const newContent = lines.slice(0, nextLines).join("\n");

    // 解析新内容
    const { doc } = parseMarkdown(newContent, view.state.schema);

    // 替换文档
    tr = view.state.tr.replaceWith(0, view.state.doc.content.size, doc.content);
    tr = tr.setMeta(lazyLoadPluginKey, {
      ...currentState,
      loadedLines: nextLines,
      loading: false,
    });

    view.dispatch(tr);
  }, 0);
}

/**
 * 初始化延迟加载
 * 在编辑器创建时调用
 */
export function initLazyLoad(
  content: string,
  schema: Schema,
  config: Partial<LazyLoadConfig> = {}
): { state: EditorState; shouldLazyLoad: boolean } {
  const mergedConfig = { ...DEFAULT_CONFIG, ...config };
  const lines = content.split("\n");
  const totalLines = lines.length;

  if (totalLines <= mergedConfig.threshold) {
    // 文件不大，正常加载
    const { doc } = parseMarkdown(content, schema);
    return {
      state: EditorState.create({
        doc,
        schema,
      }),
      shouldLazyLoad: false,
    };
  }

  // 文件很大，延迟加载
  const initialContent = lines.slice(0, mergedConfig.initialLines).join("\n");
  const { doc } = parseMarkdown(initialContent, schema);

  const state = EditorState.create({
    doc,
    schema,
  });

  // 设置延迟加载状态
  const tr = state.tr.setMeta(lazyLoadPluginKey, {
    enabled: true,
    fullContent: content,
    loadedLines: mergedConfig.initialLines,
    totalLines,
    loading: false,
  });

  return {
    state: state.apply(tr),
    shouldLazyLoad: true,
  };
}
