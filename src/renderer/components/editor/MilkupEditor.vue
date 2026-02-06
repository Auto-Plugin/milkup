<script setup lang="ts">
/**
 * Milkup 编辑器 Vue 组件
 * 基于自研 ProseMirror 内核的即时渲染 Markdown 编辑器
 */
import { ref, onMounted, onUnmounted, watch, nextTick } from "vue";
import { MilkupEditor, createMilkupEditor, type MilkupConfig, type ImagePasteMethod } from "@/core";
import { processImagePaths, reverseProcessImagePaths } from "@/plugins/imagePathPlugin";
import { uploadImage } from "@/renderer/services/api";
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

const containerRef = ref<HTMLElement | null>(null);
const scrollViewRef = ref<HTMLElement | null>(null);
let editor: MilkupEditor | null = null;
const lastEmittedValue = ref<string | null>(null);

// 更新滚动比例
function updateScrollRatio(e: Event) {
  const target = e.target as HTMLElement;
  const scrollTop = target.scrollTop;
  const scrollHeight = target.scrollHeight - target.clientHeight;
  const ratio = scrollHeight === 0 ? 0 : scrollTop / scrollHeight;
  if (currentTab.value) {
    currentTab.value.scrollRatio = ratio;
  }
}

// 处理图片路径（渲染前）
function preprocessContent(content: string): string {
  if (!content) return "";
  let processed = processImagePaths(content, currentTab.value?.filePath || null);
  // 将图片路径中的空格转换为 %20
  processed = processed.replace(/!\[([^\]]*)\]\(([^)]*)\)/g, (match, alt, src) => {
    if (src.includes(" ")) {
      const encodedSrc = src.replace(/ /g, "%20");
      return `![${alt}](${encodedSrc})`;
    }
    return match;
  });
  return processed;
}

// 处理图片路径（保存前）
function postprocessContent(content: string): string {
  let processed = reverseProcessImagePaths(content, currentTab.value?.filePath || null);
  // 将图片路径中的 %20 还原为空格
  processed = processed.replace(/!\[([^\]]*)\]\(([^)]*)\)/g, (match, alt, src) => {
    if (src.includes("%20")) {
      const decodedSrc = src.replace(/%20/g, " ");
      return `![${alt}](${decodedSrc})`;
    }
    return match;
  });
  return processed;
}

// 发送大纲更新事件
function emitOutlineUpdate() {
  if (!editor) return;

  const doc = editor.getDoc();
  const headings: Array<{ level: number; text: string; id: string }> = [];

  doc.descendants((node, pos) => {
    if (node.type.name === "heading") {
      headings.push({
        level: node.attrs.level,
        text: node.textContent,
        id: `heading-${pos}`,
      });
    }
    return true;
  });

  emitter.emit("outline:Update", headings);
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
    if (scrollViewRef.value && currentTab.value) {
      const scrollRatio = currentTab.value.scrollRatio ?? 0;
      const targetScrollTop =
        scrollRatio * (scrollViewRef.value.scrollHeight - scrollViewRef.value.clientHeight);
      scrollViewRef.value.scrollTop = targetScrollTop;
    }
  });
});

onUnmounted(() => {
  editor?.destroy();
  editor = null;
});

// 监听 modelValue 变化
watch(
  () => props.modelValue,
  (newValue) => {
    if (newValue === lastEmittedValue.value) {
      return;
    }
    if (editor && newValue !== undefined) {
      requestAnimationFrame(() => {
        // 更新全局文件路径
        (window as any).__currentFilePath = currentTab.value?.filePath || null;

        const contentForRendering = preprocessContent(newValue);
        editor?.setMarkdown(contentForRendering);
        lastEmittedValue.value = newValue;

        // 恢复滚动位置
        nextTick(() => {
          if (scrollViewRef.value && currentTab.value) {
            const scrollRatio = currentTab.value.scrollRatio ?? 0;
            const targetScrollTop =
              scrollRatio * (scrollViewRef.value.scrollHeight - scrollViewRef.value.clientHeight);
            scrollViewRef.value.scrollTop = targetScrollTop;
          }
        });
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

  .scrollView {
    flex: 1;
    height: 100%;
    overflow-y: auto;
    background: var(--background-color-1);
  }

  .milkup-container {
    min-height: 100%;
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
