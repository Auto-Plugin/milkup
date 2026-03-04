import type { ComputedRef, WritableComputedRef } from "vue";
import { computed, watch } from "vue";
import useTab from "./useTab";

// 延迟初始化，避免模块加载时立即调用useTab
let isInitialized = false;

// 用于外部访问的 computed 引用（模块级缓存）
let _markdown: WritableComputedRef<string> | null = null;
let _originalContent: WritableComputedRef<string> | null = null;
let _filePath: WritableComputedRef<string> | null = null;
let _isModified: ComputedRef<boolean> | null = null;

function initialize() {
  if (isInitialized) return;

  const { currentTab } = useTab();

  _markdown = computed({
    get: () => currentTab.value?.content ?? "",
    set: (val) => {
      if (currentTab.value) currentTab.value.content = val;
    },
  });

  _originalContent = computed({
    get: () => currentTab.value?.originalContent ?? "",
    set: (val) => {
      if (currentTab.value) currentTab.value.originalContent = val;
    },
  });

  _filePath = computed({
    get: () => currentTab.value?.filePath ?? "",
    set: (val: string) => {
      if (currentTab.value) currentTab.value.filePath = val;
    },
  });

  _isModified = computed(() => currentTab.value?.isModified ?? false);

  // 监听 isModified 变化，通知主进程保存状态
  watch(
    () => _isModified!.value,
    (newValue) => {
      const md = currentTab.value?.content ?? "";
      const orig = currentTab.value?.originalContent ?? "";
      if (md || orig) {
        window.electronAPI.changeSaveStatus(!newValue);
      }
    },
    { immediate: true }
  );

  isInitialized = true;
}

export default () => {
  initialize();

  return {
    markdown: _markdown!,
    originalContent: _originalContent!,
    filePath: _filePath!,
    isModified: _isModified!,
  };
};
