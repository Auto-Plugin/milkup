<script setup lang="ts">
import autotoast from "autotoast.js";
import AppIcon from "@/renderer/components/ui/AppIcon.vue";
import useContent from "@/renderer/hooks/useContent";
import usefile from "@/renderer/hooks/useFile";
import useWorkSpace from "@/renderer/hooks/useWorkSpace";
import {
  exportElementAsPDF,
  exportMarkdownAsWord,
  exportElementWithStylesAndImages,
  exportAsText,
  getActiveEditorElement,
  getActiveEditorSelector,
} from "@/renderer/utils/exports";

const { onOpen, onSave, onSaveAs, currentTab } = usefile();
const { setWorkSpace } = useWorkSpace();
const { isModified, markdown } = useContent();

function getExportBaseName() {
  return currentTab.value?.name?.slice(0, -3) || "导出的文件";
}

function onOpenFolder() {
  setWorkSpace()
    .then(() => {
      const escEvent = new KeyboardEvent("keydown", { key: "Escape" });
      document.dispatchEvent(escEvent);
    })
    .catch(() => {
      autotoast.show("取消选择");
    });
  // 发射 Escape 按键事件 关闭菜单
}
function exportAsPDF() {
  exportElementAsPDF(getActiveEditorSelector(), `${getExportBaseName()}.pdf`, {
    pageSize: "A4",
    scale: 1,
  })
    .then(() => {
      autotoast.show("导出成功", "success");
    })
    .catch((err) => {
      autotoast.show(`导出失败: ${err.message}`, "error");
    });
}
function exportAsHTML() {
  exportElementWithStylesAndImages(getActiveEditorElement(), `${getExportBaseName()}.html`);
}
function exportAsDocx() {
  exportMarkdownAsWord(markdown.value, `${getExportBaseName()}.docx`)
    .then(() => {
      autotoast.show("导出成功", "success");
    })
    .catch((err) => {
      autotoast.show(`导出失败: ${err.message}`, "error");
    });
}
function exportAsTxt() {
  exportAsText(markdown.value, `${getExportBaseName()}.txt`);
}
</script>

<template>
  <div class="FileOptionsBox">
    <div class="baseOptions optionItem">
      <div class="title-row">
        <span class="title-badge">
          <AppIcon name="document" />
        </span>
        <div class="title-group">
          <h2 class="title">文件</h2>
          <span class="desc">常用的打开、保存与另存为操作</span>
        </div>
      </div>
      <div class="buttons">
        <button @click="() => onOpen()">
          <AppIcon name="document" />
          <span>打开</span>
        </button>
        <button @click="onOpenFolder">
          <AppIcon name="folder-opened" />
          <span>打开文件夹</span>
        </button>
        <button @click="onSave">
          <AppIcon v-if="!isModified" name="circle-check" />
          <AppIcon v-else name="warning-outline" />
          <span>{{ isModified ? "保存" : "已保存" }}</span>
        </button>
        <button @click="onSaveAs">
          <AppIcon name="document-copy" />
          <span>另存为</span>
        </button>
      </div>
    </div>
    <div class="export optionItem">
      <div class="title-row">
        <span class="title-badge export-badge">
          <AppIcon name="export-file" />
        </span>
        <div class="title-group">
          <h2 class="title">导出为</h2>
          <span class="desc">将当前内容导出为不同格式文件</span>
        </div>
      </div>
      <div class="buttons">
        <button @click="exportAsPDF">
          <AppIcon name="pdf" />
          <span>PDF</span>
        </button>
        <button @click="exportAsHTML">
          <AppIcon name="html" />
          <span>HTML</span>
        </button>
        <button @click="exportAsDocx">
          <AppIcon name="word-file" />
          <span>Word</span>
        </button>
        <button @click="exportAsTxt">
          <AppIcon name="document" />
          <span>TXT</span>
        </button>
      </div>
    </div>
  </div>
</template>

<style lang="less" scoped>
.FileOptionsBox {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 40px;
  padding: 0 10px 200px;
  box-sizing: border-box;
  user-select: none;
  max-width: 800px;

  .optionItem {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    width: 100%;
    padding: 0;

    .title-row {
      display: flex;
      align-items: flex-start;
      gap: 14px;
      margin-bottom: 18px;
    }

    .title-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 36px;
      height: 36px;
      border-radius: 12px;
      background: color-mix(in srgb, var(--primary-color) 14%, transparent);
      color: var(--primary-color);
      font-size: 18px;

      &.export-badge {
        background: color-mix(in srgb, #10b981 14%, transparent);
        color: #10b981;
      }
    }

    .title-group {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .title {
      font-size: 18px;
      font-weight: 700;
      color: var(--text-color);
      margin: 0;
    }

    .desc {
      font-size: 13px;
      line-height: 1.5;
      color: var(--text-color-2);
    }

    .buttons {
      display: flex;
      align-items: flex-start;
      flex-direction: column;
      gap: 14px;
      padding-left: 50px;
    }

    &.export {
      .buttons {
        flex-direction: column;

        button {
          justify-content: flex-start;
          width: max-content;
        }
      }
    }
  }

  button {
    padding: 5px 10px;
    flex: 1;
    border: none;
    cursor: pointer;
    font-size: 16px;
    background: none;
    border-radius: 4px;
    transition: background-color 0.3s;
    color: var(--text-color);
    display: flex;
    align-items: center;
    justify-content: center;

    &:hover {
      background-color: var(--border-color-1);
      border-color: var(--border-color-2);
    }

    svg {
      font-size: 18px;
      vertical-align: middle;
      margin-right: 5px;
    }
  }
}

@media (max-width: 768px) {
  .FileOptionsBox {
    padding: 0 10px 160px;

    .optionItem {
      .buttons {
        padding-left: 0;
      }
    }
  }
}
</style>
