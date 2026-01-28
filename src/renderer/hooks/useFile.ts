import type { Tab } from "@/types/tab";
// useFile.ts
import { nextTick, onUnmounted } from "vue";
import { reverseProcessImagePaths } from "@/plugins/imagePathPlugin";
import emitter from "@/renderer/events";
import { readAndProcessFile, repairMarkdown } from "@/renderer/services/fileService";
import useContent from "./useContent";
import useTab from "./useTab";
import useTitle from "./useTitle";

const defaultName = "Untitled";

async function onOpen(result?: { filePath: string; content: string } | null) {
  const { updateTitle } = useTitle();
  const { markdown, filePath, originalContent } = useContent();
  const { createTabFromFile, updateCurrentTabContent, switchToTab, getFileName, tabs } = useTab();

  if (!result) {
    result = await window.electronAPI.openFile();
  }
  if (result) {
    filePath.value = result.filePath;
    if (
      tabs.value.length === 1 &&
      tabs.value[0].filePath === null &&
      tabs.value[0].name === defaultName &&
      !tabs.value[0].isModified
    ) {
      // 如果当前有且只有一个默认未命名且未修改的tab，则复用该tab
      const tab = tabs.value[0];
      tab.filePath = filePath.value;
      tab.name = getFileName(filePath.value);
      const repairedContent = repairMarkdown(result.content);
      updateCurrentTabContent(repairedContent, false);
      tab.isModified = false;
      await switchToTab(tab.id);
      markdown.value = tab.content;
      originalContent.value = repairedContent;
      tab.isModified = false;
      tab.normalizationGrace = true;
      tab.readOnly = await window.electronAPI.getIsReadOnly(result.filePath);
    } else {
      // 创建新tab
      const repairedContent = repairMarkdown(result.content);
      const tab = await createTabFromFile(result.filePath, repairedContent);
      tab.readOnly = await window.electronAPI.getIsReadOnly(result.filePath);
      // 更新当前内容状态
      markdown.value = tab.content;
      originalContent.value = repairedContent;
    }

    updateTitle();
    nextTick(() => {
      emitter.emit("file:Change");
    });
  }
}

async function onSave() {
  const { updateTitle } = useTitle();
  const { markdown, filePath, originalContent } = useContent();
  const { updateCurrentTabContent, saveCurrentTab, currentTab } = useTab();

  // 先更新当前tab的内容
  updateCurrentTabContent(markdown.value);

  // 保存当前tab
  const saved = await saveCurrentTab();
  if (saved) {
    filePath.value = currentTab.value?.filePath || "";
    originalContent.value = markdown.value;
    updateTitle();
  }
  return saved;
}

async function onSaveAs() {
  const { updateTitle } = useTitle();
  const { markdown, filePath, originalContent } = useContent();
  const { updateCurrentTabContent, currentTab } = useTab();

  // 先更新当前tab的内容
  updateCurrentTabContent(markdown.value);

  const reversedContent = reverseProcessImagePaths(markdown.value, filePath.value);
  const result = await window.electronAPI.saveFileAs(reversedContent);
  if (result) {
    // 更新当前tab的文件路径
    if (currentTab.value) {
      currentTab.value.filePath = result.filePath;
      currentTab.value.name = result.filePath.split(/[\\/]/).at(-1) || "Untitled";
      currentTab.value.originalContent = markdown.value;
      currentTab.value.isModified = false;
    }

    filePath.value = result.filePath;
    originalContent.value = markdown.value;
    updateTitle();
  }
}

// 创建新文件
function createNewFile() {
  const { updateTitle } = useTitle();
  const { markdown, filePath, originalContent } = useContent();
  const { createNewTab } = useTab();

  createNewTab();

  // 更新当前内容状态
  filePath.value = "";
  markdown.value = "";
  originalContent.value = "";

  updateTitle();
  nextTick(() => {
    emitter.emit("file:Change");
  });
}

function tabSwitch(tab: Tab) {
  const { updateTitle } = useTitle();
  const { markdown, filePath, originalContent } = useContent();

  // 更新当前内容状态
  filePath.value = tab.filePath || "";
  markdown.value = tab.content;
  originalContent.value = tab.originalContent;

  updateTitle();
  nextTick(() => {
    emitter.emit("file:Change");
  });
}

export default function useFile() {
  const { updateTitle } = useTitle();
  const { markdown, filePath, originalContent } = useContent();
  const {
    updateCurrentTabFile,
    createTabFromFile,
    switchToTab,
    updateCurrentTabContent,
    updateCurrentTabScrollRatio,
    saveCurrentTab,
    currentTab,
    hasUnsavedTabs,
    tabs,
  } = useTab();

  // 拖拽打开 Markdown 文件
  const handleDragOver = (event: DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
  };

  const handleDrop = async (event: DragEvent) => {
    event.preventDefault();
    event.stopPropagation();

    const files = Array.from(event.dataTransfer?.files ?? []);

    if (files.length === 0) return;

    // 查找 Markdown 文件
    const mdFile = files.find((f) => /\.(?:md|markdown)$/i.test(f.name));

    if (!mdFile) return;

    // 检查当前是否有未保存的内容
    let userChoice: "cancel" | "save" | "overwrite" | null = null;

    if (hasUnsavedTabs.value) {
      // 先检查要拖入的文件是否已经在某个tab中打开
      const isFileAlreadyOpen = tabs.value.some(
        (tab) => tab.name === mdFile.name || (tab.filePath && tab.filePath.endsWith(mdFile.name))
      );

      // 只有当文件真的已经打开过时，才显示覆盖确认
      if (isFileAlreadyOpen) {
        userChoice = await new Promise<"cancel" | "save" | "overwrite">((resolve) => {
          emitter.emit("file:overwrite-confirm", {
            fileName: mdFile.name,
            resolver: resolve,
          });
        });

        if (userChoice === "cancel") {
          // 用户选择取消
          return;
        } else if (userChoice === "save") {
          // 用户选择保存当前内容
          try {
            await onSave();
          } catch (error) {
            console.error("保存当前文件失败:", error);
            return; // 如果保存失败，不继续打开新文件
          }
        }
        // userChoice === 'overwrite' 表示覆盖当前内容，直接继续执行
      }
    }

    try {
      // 尝试获取文件的完整路径
      let fullPath: string | null = null;

      try {
        // 使用 webUtils.getPathForFile 方法
        const pathResult = window.electronAPI.getPathForFile(mdFile);
        fullPath = pathResult || null;
      } catch {}

      if (!fullPath) {
        const electronFile = mdFile as any;
        if (electronFile.path) {
          fullPath = electronFile.path;
        }
      }

      if (fullPath) {
        // 使用统一的文件服务读取和处理文件
        const fileContent = await readAndProcessFile({ filePath: fullPath });
        if (fileContent) {
          if (userChoice === "overwrite") {
            // 覆盖更新当前tab的文件信息
            updateCurrentTabFile(
              fileContent.filePath,
              fileContent.processedContent || fileContent.content
            );

            // 更新当前内容状态
            markdown.value = fileContent.processedContent || fileContent.content;
            filePath.value = fileContent.filePath;
            originalContent.value = fileContent.content;
            currentTab.value!.readOnly = fileContent.readOnly || false;
          } else {
            // 创建新tab
            const tab = await createTabFromFile(fileContent.filePath, fileContent.content);
            // 更新当前内容
            markdown.value = tab.content;
            filePath.value = fileContent.filePath;
            originalContent.value = fileContent.content;
          }

          updateTitle();
          nextTick(() => {
            emitter.emit("file:Change");
          });
          return;
        }
      }

      // 无法获取回退到直接读取文件内容
      const content = await mdFile.text();

      if (userChoice === "overwrite") {
        // 覆盖更新当前tab的文件信息
        updateCurrentTabFile(mdFile.name, content);

        // 更新内容
        markdown.value = content;
        filePath.value = mdFile.name;
        originalContent.value = content;
      } else {
        // 注意：这里无法处理相对路径图片，因为没有完整的文件路径
        // 图片路径解析需要知道 Markdown 文件的实际位置
        await createTabFromFile(mdFile.name, content);

        // 更新当前内容状态
        markdown.value = content;
        filePath.value = mdFile.name;
        originalContent.value = content;
      }

      updateTitle();
      nextTick(() => {
        emitter.emit("file:Change");
      });
    } catch (error) {
      console.error("读取拖拽文件失败:", error);
    }
  };

  // 注册启动时文件打开监听
  window.electronAPI?.onOpenFileAtLaunch?.(async ({ filePath: launchFilePath, content }) => {
    // 创建新tab
    const repairedContent = repairMarkdown(content);
    const tab = await createTabFromFile(launchFilePath, repairedContent);
    tab.readOnly = await window.electronAPI.getIsReadOnly(launchFilePath);

    // 更新当前内容状态
    markdown.value = tab.content;
    filePath.value = launchFilePath;
    originalContent.value = repairedContent;

    updateTitle();
    nextTick(() => {
      emitter.emit("file:Change");
    });
  });

  // ✅ 通知主进程渲染进程已就绪，可以接收文件了
  window.electronAPI?.rendererReady?.();

  // 注册菜单事件
  window.electronAPI.on?.("menu-open", onOpen);
  window.electronAPI.on?.("menu-save", onSave);

  // 注册拖拽事件
  window.addEventListener("dragover", handleDragOver);
  window.addEventListener("drop", handleDrop);

  // 注册tab切换事件
  emitter.on("tab:switch", tabSwitch);

  // 清理函数
  onUnmounted(() => {
    // 清理IPC监听器
    window.electronAPI?.removeListener?.("menu-open", onOpen);
    window.electronAPI?.removeListener?.("menu-save", onSave);

    // 清理DOM事件监听器
    window.removeEventListener("dragover", handleDragOver);
    window.removeEventListener("drop", handleDrop);

    // 清理emitter事件监听器
    emitter.off("tab:switch", tabSwitch);
  });

  return {
    onOpen,
    onSave,
    onSaveAs,
    tabSwitch,
    createNewFile,
    switchToTab,
    updateCurrentTabContent,
    updateCurrentTabScrollRatio,
    saveCurrentTab,
    hasUnsavedTabs,
    currentTab,
  };
}
