<script setup lang="ts">
import autodialog from "autodialog.js";
import { ref } from "vue";
import ReloadConfirmDialog from "@/renderer/components/dialogs/ReloadConfirmDialog.vue";
import Selector from "@/renderer/components/ui/selector/Selector.vue";
import useTab from "@/renderer/hooks/useTab";

type LanguageCode = "zh-cn" | "ja" | "ko" | "ru" | "en" | "fr";
const languages = [
  { code: "zh-cn", name: "中文" },
  { code: "ja", name: "日本語" },
  { code: "ko", name: "한국어" },
  { code: "ru", name: "Русский язык" },
  { code: "en", name: "English" },
  { code: "fr", name: "En français" },
];

const { tabs, saveTab } = useTab();

const selectedLanguage = ref<LanguageCode>(
  (localStorage.getItem("lang") as LanguageCode) || "zh-cn"
);

async function selectLanguage() {
  const currentLang = (localStorage.getItem("lang") as LanguageCode) || "zh-cn";
  if (selectedLanguage.value === currentLang) {
    return;
  }
  const res = await autodialog.show(ReloadConfirmDialog);

  if (res === "cancel") {
    selectedLanguage.value = currentLang;
    return;
  }

  localStorage.setItem("lang", selectedLanguage.value);

  if (res === "saveAndReload") {
    // 保存所有标签页
    let allSaved = true;
    for (const tab of tabs.value) {
      if (tab.isModified) {
        const success = await saveTab(tab);
        if (!success) {
          allSaved = false;
        }
      }
    }
    if (allSaved) {
      window.location.reload(); // 刷新页面以应用语言更改
    }
  }
  // res === 'reloadLater' do nothing
}
</script>

<template>
  <div class="Language">
    <label for="language-select">选择语言</label>
    <div class="selector-wrapper">
      <Selector
        v-model="selectedLanguage"
        :items="
          languages.map((lang) => {
            return { value: lang.code, label: lang.name };
          })
        "
        placeholder="选择语言"
        @change="selectLanguage"
      />
    </div>
  </div>
</template>

<style scoped lang="less">
.Language {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: 50px;

  label {
    font-weight: bold;
    font-size: 28px;
    color: var(--text-color);
  }

  .selector-wrapper {
    width: 300px;
  }

  p {
    margin-top: 10px;
    font-size: 14px;
    color: var(--text-color-2);
  }
}
</style>
