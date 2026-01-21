<script setup lang="ts">
import autodialog from 'autodialog.js'
import { ref } from 'vue'
import ReloadConfirmDialog from '@/renderer/components/dialogs/ReloadConfirmDialog.vue'
import Selector from '@/renderer/components/ui/selector/Selector.vue'

type LanguageCode = 'zh-cn' | 'ja' | 'ko' | 'ru' | 'en' | 'fr'
const languages = [
  { code: 'zh-cn', name: '中文' },
  { code: 'ja', name: '日本語' },
  { code: 'ko', name: '한국어' },
  { code: 'ru', name: 'Русский язык' },
  { code: 'en', name: 'English' },
  { code: 'fr', name: 'En français' },
]

const selectedLanguage = ref<LanguageCode>(
  (localStorage.getItem('lang') as LanguageCode) || 'zh-cn',
)

async function selectLanguage() {
  if (selectedLanguage.value === (localStorage.getItem('lang') as LanguageCode)) {
    return
  }
  const res = await autodialog.show(ReloadConfirmDialog)
  localStorage.setItem('lang', selectedLanguage.value)
  if (res === 'ignore') {
    return
  }
  window.location.reload() // 刷新页面以应用语言更改
}
</script>

<template>
  <div class="Language">
    <label for="language-select">选择语言</label>
    <Selector
      v-model="selectedLanguage"
      :items="languages.map(lang => { return { value: lang.code, label: lang.name } })" placeholder="选择语言"
      @change="selectLanguage"
    />
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

  select {
    padding: 5px;
    font-size: 16px;
  }

  p {
    margin-top: 10px;
    font-size: 14px;
    color: var(--text-color-2);
  }
}
</style>
