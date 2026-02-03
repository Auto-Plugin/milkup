<script setup lang="ts">
import type { Ctx } from "@milkdown/kit/ctx";
import { vue } from "@codemirror/lang-vue";
import { Crepe } from "@milkdown/crepe";
import { editorViewCtx, serializerCtx } from "@milkdown/kit/core";
import { upload, uploadConfig } from "@milkdown/kit/plugin/upload";
import { outline, replaceAll } from "@milkdown/kit/utils";
import { automd } from "@milkdown/plugin-automd";
import { commonmark } from "@milkdown/preset-commonmark";
import { TextSelection } from "@milkdown/prose/state";
import { enhanceConfig } from "@renderer/enhance/crepe/config";
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { uploader } from "@/plugins/customPastePlugin";
import { htmlPlugin } from "@/plugins/hybridHtmlPlugin/rawHtmlPlugin";
import { processImagePaths, reverseProcessImagePaths } from "@/plugins/imagePathPlugin";
import { laxImageInputRule, laxImagePastePlugin } from "@/plugins/laxImagePlugin";
import { sourceOnFocusPlugin } from "@renderer/enhance/crepe/plugins/sourceOnFocus";
import { diagram } from "@/plugins/mermaidPlugin";
import { completionPlugin } from "./plugins/completionPlugin";
import emitter from "@/renderer/events";
import useTab from "@/renderer/hooks/useTab";

import {
  ensureTrailingNewline,
  fixUnclosedCodeBlock,
  normalizeMarkdown,
} from "@/renderer/utils/text";

const props = defineProps<{
  modelValue: string;
  readOnly?: boolean;
}>();

const emit = defineEmits<{
  (e: "update:modelValue", value: string): void;
}>();

const { currentTab } = useTab();

const lastEmittedValue = ref<string | null>(null);
const scrollViewRef = ref<HTMLElement | null>(null);

function updateScrollRatio(e: Event) {
  const target = e.target as HTMLElement;
  const scrollTop = target.scrollTop;
  const scrollHeight = target.scrollHeight - target.clientHeight;
  const ratio = scrollHeight === 0 ? 0 : scrollTop / scrollHeight;
  if (currentTab.value) {
    currentTab.value.scrollRatio = ratio;
  }
}

let crepe: Crepe | null = null;

onMounted(async () => {
  await nextTick();

  // 设置全局文件路径供插件使用
  (window as any).__currentFilePath = currentTab.value?.filePath || null;

  // 预览模式下支持自定义css文件路径解析
  // 还有在源码模式下 支持自定义字体大小调节
  // 还有 切换 源码和预览模式 以及 目录打开与关闭 搞个可以自定义的快捷键

  // 将原始内容转换为包含协议 URL 的内容用于渲染
  let contentForRendering = processImagePaths(
    normalizeMarkdown(fixUnclosedCodeBlock(ensureTrailingNewline(props.modelValue.toString()))),
    currentTab.value?.filePath || null
  );

  console.log("[Debug] Original content:", props.modelValue.toString().slice(0, 100));
  console.log("[Debug] After processImagePaths:", contentForRendering.slice(0, 100));

  // 预处理：将图片路径中的空格转换为 %20，确保 crepe 能正确渲染
  // 匹配 ![alt](path) 格式
  contentForRendering = contentForRendering.replace(
    /!\[([^\]]*)\]\(([^)]*)\)/g,
    (match, alt, src) => {
      if (src.includes(" ")) {
        console.log("[Debug] Found image with space during load:", src);
        const encodedSrc = src.replace(/ /g, "%20");
        const result = `![${alt}](${encodedSrc})`;
        console.log("[Debug] Replaced with:", result);
        return result;
      }
      return match;
    }
  );

  // crepe 有更好的用户体验👇
  crepe = new Crepe({
    root: document.querySelector("#milkdown") as HTMLElement,
    defaultValue: contentForRendering,
    featureConfigs: {
      "code-mirror": {
        extensions: [vue()],
      },
      ...enhanceConfig,
    },
  });
  crepe.on((lm) => {
    lm.markdownUpdated((Ctx, nextMarkdown) => {
      // 将协议 URL 转回相对路径再发送给父组件
      let restoredMarkdown = reverseProcessImagePaths(
        nextMarkdown,
        currentTab.value?.filePath || null
      );

      // 后处理：将图片路径中的 %20 还原为空格（如果需要）
      // 匹配 ![alt](path) 格式
      restoredMarkdown = restoredMarkdown.replace(
        /!\[([^\]]*)\]\(([^)]*)\)/g,
        (match, alt, src) => {
          if (src.includes("%20")) {
            console.log("[Debug] decoding image path for save:", src);
            const decodedSrc = src.replace(/%20/g, " ");
            return `![${alt}](${decodedSrc})`;
          }
          return match;
        }
      );

      lastEmittedValue.value = restoredMarkdown;
      emit("update:modelValue", restoredMarkdown);
      emitOutlineUpdate(Ctx);
    });
    lm.mounted(async (Ctx) => {
      emitOutlineUpdate(Ctx);
      setSelectionAndScrollToView(Ctx);
      // 监听滚动事件
      // 监听滚动事件
      // const view = Ctx.get(editorViewCtx)
      // view.dom.addEventListener('scroll', (e) => {
      //   console.log('e::: ', e)
      //   const scrollTop = view.dom.scrollTop
      //   const scrollHeight = view.dom.scrollHeight - view.dom.clientHeight
      //   const ratio = scrollHeight === 0 ? 0 : scrollTop / scrollHeight
      //   currentTab.value!.scrollRatio = ratio
      // })
    });
    lm.selectionUpdated((Ctx) => {
      // 获取光标位置
      try {
        nextTick(() => {
          const view = Ctx.get(editorViewCtx);
          const serializer = Ctx.get(serializerCtx);
          const sel = view.state.selection;
          const head = sel.head ? sel.head : sel.head; // 对应光标位置
          // 获取光标之前的文档部分
          const before = view.state.doc.cut(0, head);
          // 序列化为 Markdown 源码
          const markdownBefore = serializer(before);
          currentTab.value!.codeMirrorCursorOffset = markdownBefore.length;
          currentTab.value!.milkdownCursorOffset = head;
        });
      } catch (err) {
        console.error("获取光标位置失败:", err);
      }
    });
  });
  const editor = crepe.editor;
  editor.ctx.inject(uploadConfig.key);
  editor
    .use(laxImageInputRule)
    .use(laxImagePastePlugin)
    .use(automd)
    .use(upload)
    .use(htmlPlugin)
    .use(diagram)
    .use(completionPlugin)
    .use(sourceOnFocusPlugin)
    .use(commonmark);

  props.readOnly && crepe.setReadonly(true);
  await crepe.create();

  editor.ctx.update(uploadConfig.key, (prev) => ({ ...prev, uploader }));

  watch(
    () => props.modelValue,
    (newValue) => {
      if (newValue === lastEmittedValue.value) {
        return;
      }
      if (crepe && newValue !== undefined) {
        // 延迟高开销的编辑器更新操作，优先保证 UI 响应（如 Tab 切换动画）
        requestAnimationFrame(() => {
          // 更新全局文件路径
          (window as any).__currentFilePath = currentTab.value?.filePath || null;

          // 将原始内容转换为包含协议 URL 的内容用于渲染
          let contentForRendering = processImagePaths(newValue, currentTab.value?.filePath || null);

          // 预处理：将图片路径中的空格转换为 %20
          contentForRendering = contentForRendering.replace(
            /!\[([^\]]*)\]\(([^)]*)\)/g,
            (match, alt, src) => {
              if (src.includes(" ")) {
                console.log("[Debug] Found image with space during update:", src);
                const encodedSrc = src.replace(/ /g, "%20");
                const result = `![${alt}](${encodedSrc})`;
                console.log("[Debug] Replaced with (update):", result);
                return result;
              }
              return match;
            }
          );

          editor.action(replaceAll(contentForRendering));
          // Update lastEmittedValue to avoid immediate echo if editor emits back synchronously
          lastEmittedValue.value = newValue;

          // Restore scroll position
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
});
onBeforeUnmount(() => {
  if (crepe) {
    crepe.destroy();
    crepe = null;
  }
});

function emitOutlineUpdate(ctx: Ctx) {
  const headings = outline()(ctx);
  emitter.emit("outline:Update", headings);
}
function setSelectionAndScrollToView(Ctx: Ctx) {
  try {
    const view = Ctx.get(editorViewCtx);
    const size = view.state.doc.content.size;
    const rawPos = currentTab.value?.milkdownCursorOffset ?? 1;
    // 设置光标位置
    const tr = view.state.tr.setSelection(TextSelection.create(view.state.doc, rawPos));
    view.dispatch(tr);
    const clamped = Math.max(1, Math.min(rawPos, Math.max(1, size - 1)));
    const dom = view.domAtPos(clamped).node as HTMLElement;
    // 检查是 文本节点还是 元素节点
    if (dom.nodeType === Node.TEXT_NODE) {
      const parent = dom.parentElement!;
      parent.scrollIntoView({ behavior: "instant", block: "center" });
    } else {
      dom.scrollIntoView({ behavior: "instant", block: "center" });
    }
  } catch {
    if (
      currentTab.value!.milkdownCursorOffset !== null &&
      currentTab.value!.milkdownCursorOffset! > 0
    ) {
      currentTab.value!.milkdownCursorOffset!--;
      setSelectionAndScrollToView(Ctx);
    }
  }
}
</script>

<template>
  <div class="editor-box">
    <div ref="scrollViewRef" class="scrollView milk" @scroll="updateScrollRatio">
      <div id="milkdown"></div>
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
}
</style>
