<script setup lang="ts">
/**
 * Milkup 编辑器 Vue 组件
 * 基于自研 ProseMirror 内核的即时渲染 Markdown 编辑器
 */
import { ref, onMounted, onUnmounted, watch, nextTick } from "vue";
import {
  MilkupEditor,
  createMilkupEditor,
  type MilkupConfig,
  type ImagePasteMethod,
  setGlobalMermaidDefaultMode,
} from "@/core";
import { uploadImage } from "@/renderer/services/api";
import { AIService } from "@/renderer/services/ai";
import { useAIConfig } from "@/renderer/hooks/useAIConfig";
import { useConfig } from "@/renderer/hooks/useConfig";
import emitter from "@/renderer/events";
import useTab from "@/renderer/hooks/useTab";
import "@/core/styles/milkup.css";

interface Props {
  modelValue: string;
  readOnly?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  modelValue: "",
  readOnly: false,
});

const emit = defineEmits<{
  "update:modelValue": [value: string];
}>();

const { currentTab } = useTab();
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

// 更新滚动位置（rAF 节流）
let scrollRafId: number | null = null;
function updateScrollRatio(e: Event) {
  if (scrollRafId !== null) return;
  const target = e.target as HTMLElement;
  scrollRafId = requestAnimationFrame(() => {
    scrollRafId = null;
    if (currentTab.value) {
      // 虚拟滚动模式：从 editor API 获取状态
      if (editor?.isVirtualScrollEnabled()) {
        currentTab.value.hasScrollState = true;
        const anchor = editor.getScrollAnchor();
        if (anchor) {
          currentTab.value.scrollAnchor = anchor;
        }
        return;
      }

      // 非虚拟滚动模式：从原生 scroll 获取状态
      const scrollTop = target.scrollTop;
      const scrollHeight = target.scrollHeight - target.clientHeight;
      const ratio = scrollHeight === 0 ? 0 : scrollTop / scrollHeight;
      currentTab.value.scrollRatio = ratio;
      currentTab.value.scrollTop = scrollTop;
      currentTab.value.hasScrollState = true;
    }
  });
}

// 处理虚拟滚动事件（自定义事件，由 VS manager 派发）
function handleVSScroll() {
  updateScrollRatio(new Event("vs-scroll"));
}

// 恢复滚动位置
function restoreScrollPosition() {
  if (!scrollViewRef.value || !currentTab.value) return;

  // 虚拟滚动模式：scroll 恢复完全由 setMarkdown 处理，这里不做任何操作
  if (editor?.isVirtualScrollEnabled()) return;

  // 使用 hasScrollState 判断（修复 scrollTop=0 时状态丢失的问题）
  if (currentTab.value.hasScrollState) {
    scrollViewRef.value.scrollTop = currentTab.value.scrollTop ?? 0;
    return;
  }

  // 回退到 scrollRatio（非虚拟滚动模式或首次打开）
  const scrollRatio = currentTab.value.scrollRatio ?? 0;
  if (scrollRatio > 0) {
    const targetScrollTop =
      scrollRatio * (scrollViewRef.value.scrollHeight - scrollViewRef.value.clientHeight);
    scrollViewRef.value.scrollTop = targetScrollTop;
  }
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
    if (!editor) return;

    // 虚拟滚动模式：从完整内容解析标题
    const fullOutline = editor.getFullOutline();
    if (fullOutline) {
      const headings = fullOutline.map((h, i) => ({
        level: h.level,
        text: h.text,
        id: `heading-line-${h.lineNumber}`,
        pos: -1, // 虚拟滚动模式下 pos 无意义
        lineNumber: h.lineNumber,
      }));
      emitter.emit("outline:Update", headings);
      return;
    }

    // 非虚拟滚动模式：遍历 ProseMirror doc
    const doc = editor.getDoc();
    const headings: Array<{
      level: number;
      text: string;
      id: string;
      pos: number;
      lineNumber?: number;
    }> = [];

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

onMounted(async () => {
  if (!containerRef.value) return;

  await nextTick();

  // 设置全局文件路径供插件使用
  (window as any).__currentFilePath = currentTab.value?.filePath || null;

  // 预处理内容
  const contentForRendering = preprocessContent(props.modelValue);

  const config: MilkupConfig = {
    content: contentForRendering,
    readonly: props.readOnly,
    sourceView: false,
    placeholder: "写点什么吧...",
    initialScrollTop: currentTab.value?.scrollTop,
    pasteConfig: {
      getImagePasteMethod: () => {
        const method = localStorage.getItem("pasteMethod");
        return (method as ImagePasteMethod) || "base64";
      },
      imageUploader: async (file: File) => {
        return await uploadImage(file);
      },
      localImageSaver: async (file: File) => {
        // 检查是否在 Electron 环境中
        if (typeof window !== "undefined" && (window as any).electronAPI) {
          const electronAPI = (window as any).electronAPI;

          // 尝试获取剪贴板中的文件路径
          const filePath = await electronAPI.getFilePathInClipboard?.();
          if (filePath) {
            return filePath;
          }

          // 检查 File 对象是否有 path 属性（Electron 环境）
          const absolutePath = (file as any).path;
          if (absolutePath) {
            return absolutePath;
          }

          // 将图片保存到临时目录
          const arrayBuffer = await file.arrayBuffer();
          const buffer = new Uint8Array(arrayBuffer);
          const localImagePath = localStorage.getItem("localImagePath") || "/temp";
          const tempPath = await electronAPI.writeTempImage?.(buffer, localImagePath);

          if (tempPath) {
            return tempPath;
          }
        }

        // 如果不在 Electron 环境或保存失败，回退到 base64
        console.warn("Local image saving not available, falling back to base64");
        return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = (error) => reject(error);
          reader.readAsDataURL(file);
        });
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
    const restoredMarkdown = postprocessContent(markdown);
    lastEmittedValue.value = restoredMarkdown;
    emit("update:modelValue", restoredMarkdown);
    emitOutlineUpdate();
  });

  // 监听选区变更
  editor.on("selectionChange", (data: { from: number; to: number }) => {
    if (currentTab.value) {
      currentTab.value.milkdownCursorOffset = data.from;
      // 计算源码偏移量
      const markdown = editor?.getMarkdown() || "";
      currentTab.value.codeMirrorCursorOffset =
        markdown.length > 0 ? Math.min(data.from, markdown.length) : 0;
    }
  });

  // 初始化大纲
  emitOutlineUpdate();

  // 恢复光标位置
  if (currentTab.value?.milkdownCursorOffset) {
    editor.setCursorOffset(currentTab.value.milkdownCursorOffset);
  }

  // 恢复滚动位置
  nextTick(() => {
    restoreScrollPosition();
  });

  // 监听虚拟滚动自定义事件（VS manager 通过 scrollView 派发 vs-scroll 事件）
  if (scrollViewRef.value) {
    scrollViewRef.value.addEventListener("vs-scroll", handleVSScroll);
  }
});

onUnmounted(() => {
  // 移除虚拟滚动事件监听
  if (scrollViewRef.value) {
    scrollViewRef.value.removeEventListener("vs-scroll", handleVSScroll);
  }
  editor?.destroy();
  editor = null;
  // 移除事件监听
  emitter.off("sourceView:toggle", handleSourceViewToggle);
  emitter.off("outline:scrollTo", handleOutlineScrollTo);
  emitter.off("tab:switch", handleTabSwitch);
});

// 处理源码模式切换事件
function handleSourceViewToggle() {
  if (editor) {
    editor.toggleSourceView();
    // 通知状态变化
    emitter.emit("sourceView:changed", editor.isSourceViewEnabled());
  }
}

// 监听源码模式切换事件
emitter.on("sourceView:toggle", handleSourceViewToggle);

// 处理大纲点击滚动
function handleOutlineScrollTo(data: unknown) {
  if (!editor) return;

  // 支持传入对象 { pos, lineNumber } 或纯数字 pos
  const item = data as { pos?: number; lineNumber?: number } | number;
  const lineNumber = typeof item === "object" ? item?.lineNumber : undefined;
  const pos = typeof item === "number" ? item : item?.pos;

  // 虚拟滚动模式：通过行号跳转
  if (lineNumber !== undefined && lineNumber >= 0) {
    editor.scrollToLine(lineNumber);
    return;
  }

  // 非虚拟滚动模式：通过 ProseMirror pos 跳转
  if (typeof pos === "number" && pos >= 0) {
    const view = editor.view;
    const dom = view.domAtPos(pos + 1);
    if (dom.node) {
      const el = dom.node instanceof HTMLElement ? dom.node : dom.node.parentElement;
      el?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }
}
emitter.on("outline:scrollTo", handleOutlineScrollTo);

// tab 切换时重置 lastEmittedValue，确保 watch 守卫不会跳过新 tab 的内容加载
function handleTabSwitch() {
  lastEmittedValue.value = null;
}
emitter.on("tab:switch", handleTabSwitch);

// 监听 modelValue 变化
watch(
  () => props.modelValue,
  (newValue) => {
    if (newValue === lastEmittedValue.value) {
      return;
    }
    if (editor && newValue !== undefined) {
      // 更新全局文件路径
      (window as any).__currentFilePath = currentTab.value?.filePath || null;

      const contentForRendering = preprocessContent(newValue);
      const savedScrollTop = currentTab.value?.scrollTop;
      const savedAnchor = currentTab.value?.scrollAnchor;
      editor
        .setMarkdown(contentForRendering, { scrollTop: savedScrollTop, scrollAnchor: savedAnchor })
        .then(async () => {
          // 注意：不要在 setMarkdown 之后覆盖 lastEmittedValue。
          // setMarkdown 会同步触发 change 事件，change handler 已经将
          // lastEmittedValue 设置为序列化后的值。如果这里再覆盖为 newValue，
          // 当序列化结果与 newValue 不同时（如引用块归一化），会导致 watch
          // 守卫失效，触发无限循环。

          // 更新大纲
          emitOutlineUpdate();

          // 恢复滚动位置
          await nextTick();
          restoreScrollPosition();
        });
    }
  }
);

// 监听 readOnly 变化
watch(
  () => props.readOnly,
  (newValue) => {
    editor?.updateConfig({ readonly: newValue });
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
  <div class="editor-box">
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
