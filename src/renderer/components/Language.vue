<script setup lang="ts">
import { ref } from 'vue'
import Selector from '@/ui/Selector.vue'

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

function selectLanguage() {
  localStorage.setItem('lang', selectedLanguage.value)
  console.log('selectedLanguage.value::: ', selectedLanguage.value)
  // 可在此处添加切换语言的逻辑，如调用 i18n
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
