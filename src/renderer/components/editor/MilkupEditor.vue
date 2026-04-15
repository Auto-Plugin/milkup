<script setup lang="ts">
/**
 * Milkup 编辑器 Vue 组件
 * 基于自研 ProseMirror 内核的即时渲染 Markdown 编辑器
 * 每个 tab 拥有独立的编辑器实例（v-for + v-show 模式）
 */
import type { Tab } from "@/types/tab";
import { ref, onMounted, onUnmounted, watch, nextTick } from "vue";
import {
  MilkupEditor,
  createMilkupEditor,
  type MilkupConfig,
  getImagePasteMethod,
  saveImageLocally,
  setGlobalMermaidDefaultMode,
} from "@/core";
import { undo, redo } from "prosemirror-history";
import { uploadImage } from "@/renderer/services/api";
import { AIService } from "@/renderer/services/ai";
import { useAIConfig } from "@/renderer/hooks/useAIConfig";
import { useConfig } from "@/renderer/hooks/useConfig";
import emitter from "@/renderer/events";
import "@/core/styles/milkup.css";
import { normalizeMarkdownForDirtyCheck } from "@/renderer/utils/markdown";

interface Props {
  tab: Tab;
  isActive: boolean;
}

const props = defineProps<Props>();

const { config: aiConfig, isEnabled: aiEnabled } = useAIConfig();
const { config: appConfig, watchConf } = useConfig();

// 初始化 mermaid 默认显示模式
setGlobalMermaidDefaultMode(appConfig.value.mermaid?.defaultDisplayMode || "diagram");
watchConf("mermaid", (val) => {
  setGlobalMermaidDefaultMode(val?.defaultDisplayMode || "diagram");
});

const containerRef = ref<HTMLElement | null>(null);
const scrollViewRef = ref<HTMLElement | null>(null);
let editor: MilkupEditor | null = null;
const lastEmittedValue = ref<string | null>(null);
let isSourceViewToggling = false;
let preservedSourceView = false;

// isNewlyLoaded 归一化清理定时器
let newlyLoadedTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleNewlyLoadedCleanup() {
  if (newlyLoadedTimer) clearTimeout(newlyLoadedTimer);
  newlyLoadedTimer = setTimeout(() => {
    newlyLoadedTimer = null;
    props.tab.isNewlyLoaded = false;
  }, 150);
}

// 更新滚动比例（rAF 节流）
let scrollRafId: number | null = null;
function updateScrollRatio(e: Event) {
  if (scrollRafId !== null) return;
  const target = e.target as HTMLElement;
  scrollRafId = requestAnimationFrame(() => {
    scrollRafId = null;
    const scrollTop = target.scrollTop;
    const scrollHeight = target.scrollHeight - target.clientHeight;
    const ratio = scrollHeight === 0 ? 0 : scrollTop / scrollHeight;
    props.tab.scrollRatio = ratio;
  });
}

// 预处理内容（主进程已完成图片路径转换，这里仅处理空格编码供编辑器渲染）
function preprocessContent(content: string): string {
  if (!content) return "";
  // 将图片路径中的空格转换为 %20（编辑器渲染需要，postprocessContent 会还原）
  return content.replace(/!\[([^\]]*)\]\(([^)]*)\)/g, (match, alt, src) => {
    if (src.includes(" ")) {
      const encodedSrc = src.replace(/ /g, "%20");
      return `![${alt}](${encodedSrc})`;
    }
    return match;
  });
}

// 处理图片路径（保存前）
function postprocessContent(content: string): string {
  // 将图片路径中的 %20 还原为空格
  return content.replace(/!\[([^\]]*)\]\(([^)]*)\)/g, (match, alt, src) => {
    if (src.includes("%20")) {
      const decodedSrc = src.replace(/%20/g, " ");
      return `![${alt}](${decodedSrc})`;
    }
    return match;
  });
}

// 发送大纲更新事件（防抖，避免大文件每次按键都遍历文档）
let outlineTimer: ReturnType<typeof setTimeout> | null = null;
function emitOutlineUpdate() {
  if (outlineTimer !== null) {
    clearTimeout(outlineTimer);
  }
  outlineTimer = setTimeout(() => {
    outlineTimer = null;
    if (!editor || !props.isActive) return;

    const doc = editor.getDoc();
    const headings: Array<{ level: number; text: string; id: string; pos: number }> = [];

    doc.descendants((node, pos) => {
      if (node.type.name === "heading") {
        // 提取不含语法标记的纯文本
        let text = "";
        node.forEach((child) => {
          if (child.isText && !child.marks.some((m) => m.type.name === "syntax_marker")) {
            text += child.text || "";
          }
        });
        headings.push({
          level: node.attrs.level,
          text: text.trim(),
          id: `heading-${pos}`,
          pos,
        });
      }
      return true;
    });

    emitter.emit("outline:Update", headings);
  }, 150);
}

function createEditorInstance() {
  if (!containerRef.value) return;

  // 设置全局文件路径供插件使用
  if (props.isActive) {
    (window as any).__currentFilePath = props.tab.filePath || null;
  }

  // 预处理内容
  const contentForRendering = preprocessContent(props.tab.content);

  const config: MilkupConfig = {
    content: contentForRendering,
    readonly: props.tab.readOnly,
    sourceView: preservedSourceView,
    placeholder: "写点什么吧...",
    pasteConfig: {
      getImagePasteMethod,
      imageUploader: async (file: File) => {
        return await uploadImage(file);
      },
      localImageSaver: async (file: File) => {
        return await saveImageLocally(file);
      },
    },
    // AI 续写配置（使用 getter 函数以支持响应式更新）
    aiConfig: {
      get enabled() {
        return aiEnabled.value;
      },
      get debounceWait() {
        return aiConfig.value.debounceWait;
      },
      complete: async (context) => {
        return await AIService.complete(aiConfig.value, context);
      },
    },
  };

  editor = createMilkupEditor(containerRef.value, config);

  // 监听变更事件
  editor.on("change", ({ markdown }: { markdown: string }) => {
    // 源码模式切换是视图变换，不是内容修改，跳过
    if (isSourceViewToggling) return;
    const restoredMarkdown = postprocessContent(markdown);
    lastEmittedValue.value = restoredMarkdown;

    // 直接写入 tab 对象
    const tab = props.tab;
    tab.content = restoredMarkdown;

    if (tab.readOnly) {
      tab.isModified = false;
      return;
    }

    // 刚加载的 tab，吸收编辑器归一化产生的变化
    if (tab.isNewlyLoaded) {
      tab.originalContent = restoredMarkdown;
      tab.isModified = false;
      // 归一化每步都可能触发 change，重置定时器等待全部完成
      scheduleNewlyLoadedCleanup();
      return;
    }

    tab.isModified =
      normalizeMarkdownForDirtyCheck(restoredMarkdown) !==
      normalizeMarkdownForDirtyCheck(tab.originalContent);
    emitOutlineUpdate();
  });

  // 监听选区变更
  editor.on("selectionChange", (data: { from: number; to: number }) => {
    props.tab.milkdownCursorOffset = data.from;
    // 计算源码偏移量
    const markdown = editor?.getMarkdown() || "";
    props.tab.codeMirrorCursorOffset =
      markdown.length > 0 ? Math.min(data.from, markdown.length) : 0;
  });

  // 初始化大纲（仅活跃编辑器）
  if (props.isActive) {
    emitOutlineUpdate();
  }

  // 恢复光标位置
  if (props.tab.milkdownCursorOffset) {
    editor.setCursorOffset(props.tab.milkdownCursorOffset);
  }

  // 恢复滚动位置
  nextTick(() => {
    if (scrollViewRef.value) {
      const scrollRatio = props.tab.scrollRatio ?? 0;
      const targetScrollTop =
        scrollRatio * (scrollViewRef.value.scrollHeight - scrollViewRef.value.clientHeight);
      scrollViewRef.value.scrollTop = targetScrollTop;
    }
  });
}

function syncEditorFromTab(content: string) {
  if (!editor) return;

  requestAnimationFrame(() => {
    if (props.isActive) {
      (window as any).__currentFilePath = props.tab.filePath || null;
    }

    const contentForRendering = preprocessContent(content);
    editor?.setMarkdown(contentForRendering);

    nextTick(() => {
      if (scrollViewRef.value) {
        const scrollRatio = props.tab.scrollRatio ?? 0;
        const targetScrollTop =
          scrollRatio * (scrollViewRef.value.scrollHeight - scrollViewRef.value.clientHeight);
        scrollViewRef.value.scrollTop = targetScrollTop;
      }
    });
  });
}

onMounted(async () => {
  if (!containerRef.value) return;
  await nextTick();
  createEditorInstance();
});

onUnmounted(() => {
  editor?.destroy();
  editor = null;
  if (newlyLoadedTimer) clearTimeout(newlyLoadedTimer);
  if (outlineTimer) clearTimeout(outlineTimer);
  emitter.off("sourceView:toggle", handleSourceViewToggle);
  emitter.off("outline:scrollTo", handleOutlineScrollTo);
  emitter.off("editor:reload", handleEditorReload);
  window.electronAPI.removeListener?.("editor:undo", handleMenuUndo);
  window.electronAPI.removeListener?.("editor:redo", handleMenuRedo);
});

// 处理源码模式切换事件（仅活跃编辑器响应）
function handleSourceViewToggle() {
  if (!props.isActive || !editor) return;
  isSourceViewToggling = true;
  editor.toggleSourceView();
  isSourceViewToggling = false;
  emitter.emit("sourceView:changed", editor.isSourceViewEnabled());
}
emitter.on("sourceView:toggle", handleSourceViewToggle);

// 处理大纲点击滚动（仅活跃编辑器响应）
function handleOutlineScrollTo(pos: unknown) {
  if (!props.isActive || !editor || typeof pos !== "number") return;
  const view = editor.view;
  const dom = view.domAtPos(pos + 1);
  if (dom.node) {
    const el = dom.node instanceof HTMLElement ? dom.node : dom.node.parentElement;
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}
emitter.on("outline:scrollTo", handleOutlineScrollTo);

// 处理菜单栏的撤销/重做（仅活跃编辑器响应）
function handleMenuUndo() {
  if (!props.isActive || !editor) return;
  const view = editor.view;
  undo(view.state, view.dispatch.bind(view));
}
function handleMenuRedo() {
  if (!props.isActive || !editor) return;
  const view = editor.view;
  redo(view.state, view.dispatch.bind(view));
}
window.electronAPI.on?.("editor:undo", handleMenuUndo);
window.electronAPI.on?.("editor:redo", handleMenuRedo);

// 处理编辑器重载事件（仅活跃编辑器响应）
function handleEditorReload() {
  if (!props.isActive || !containerRef.value) return;
  preservedSourceView = editor?.isSourceViewEnabled() ?? false;
  editor?.destroy();
  editor = null;
  // 清空容器
  if (containerRef.value) {
    containerRef.value.innerHTML = "";
  }
  createEditorInstance();
}
emitter.on("editor:reload", handleEditorReload);

// 监听 tab.content 变化（处理外部内容更新，如文件 watcher、useFile 打开文件等）
watch(
  () => props.tab.content,
  (newValue) => {
    if (newValue === lastEmittedValue.value) {
      return;
    }
    if (editor && newValue !== undefined) {
      syncEditorFromTab(newValue);
    }
  }
);

watch(
  () => props.tab.filePath,
  (newValue, oldValue) => {
    if (!editor || newValue === oldValue) return;
    if (props.isActive) {
      (window as any).__currentFilePath = newValue || null;
    }
    if (props.tab.content !== undefined) {
      lastEmittedValue.value = null;
      syncEditorFromTab(props.tab.content);
    }
  }
);

// 监听 tab.readOnly 变化
watch(
  () => props.tab.readOnly,
  (newValue) => {
    editor?.updateConfig({ readonly: newValue });
  }
);

// 监听 isActive 变化：激活时同步全局状态
watch(
  () => props.isActive,
  (isActive) => {
    if (isActive) {
      // 更新全局文件路径
      (window as any).__currentFilePath = props.tab.filePath || null;
      // 发送大纲更新
      emitOutlineUpdate();
      // 通知源码模式状态
      emitter.emit("sourceView:changed", editor?.isSourceViewEnabled() ?? false);
    }
  }
);

// 暴露方法
defineExpose({
  getEditor: () => editor,
  focus: () => editor?.focus(),
  getMarkdown: () => editor?.getMarkdown() ?? "",
  setMarkdown: (content: string) => editor?.setMarkdown(content),
  toggleSourceView: () => editor?.toggleSourceView(),
});
</script>

<template>
  <div
    class="editor-box milkup-editor-instance"
    :data-tab-id="tab.id"
    :data-active="isActive ? 'true' : 'false'"
  >
    <div ref="scrollViewRef" class="scrollView milkup" @scroll="updateScrollRatio">
      <div ref="containerRef" class="milkup-container"></div>
    </div>
  </div>
</template>

<style scoped lang="less">
.editor-box {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;

  .scrollView {
    flex: 1;
    height: 100%;
    overflow-y: auto;
    background: var(--background-color-1);
  }

  .milkup-container {
    min-height: 100%;
    display: flex;
    flex-direction: column;
  }
}
</style>

<style>
/* Milkup 编辑器全局样式覆盖 */
.milkup-editor {
  background: var(--background-color-1);
  color: var(--text-color-1);
  font-family: var(--font-family);
  font-size: var(--font-size);
  line-height: var(--line-height);
}

.milkup-editor h1,
.milkup-editor h2,
.milkup-editor h3,
.milkup-editor h4,
.milkup-editor h5,
.milkup-editor h6 {
  color: var(--text-color-1);
}

.milkup-editor blockquote {
  border-left-color: var(--border-color-1);
  background: var(--background-color-2);
}

.milkup-code-block {
  background: var(--background-color-2);
  border-color: var(--border-color-1);
}

.milkup-code-block-header {
  background: var(--background-color-3);
}

.milkup-editor table th,
.milkup-editor table td {
  border-color: var(--border-color-1);
}

.milkup-editor table th {
  background: var(--background-color-2);
}

.milkup-editor hr {
  background: var(--border-color-1);
}

.milkup-syntax-marker {
  color: var(--text-color-3);
}

.milkup-link {
  color: var(--link-color);
}
</style>
