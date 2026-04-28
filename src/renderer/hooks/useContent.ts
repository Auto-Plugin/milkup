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

  const { currentTab, hasUnsavedTabs } = useTab();

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

  // 监听窗口内所有标签页的修改状态，通知主进程保存状态。
  // 主进程只维护窗口级状态；如果只上报当前标签页状态，切换到已保存标签页后
  // 关闭窗口会绕过未保存标签页的确认流程。
  watch(
    () => hasUnsavedTabs.value,
    (hasUnsaved) => {
      window.electronAPI.changeSaveStatus(!hasUnsaved);
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
