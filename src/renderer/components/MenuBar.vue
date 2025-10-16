<script setup lang="ts">
import { ref } from 'vue'
import About from './About.vue'
import appearancePage from './AppearancePage.vue'
import FileOptions from './FileOptions.vue'
import Language from './Language.vue'
import SettingBase from './SettingBase.vue'

const activeTab = ref<'settings' | 'about' | 'appearance' | 'file' | 'language'>('file')
const MenuComponents = {
  settings: SettingBase,
  about: About,
  language: Language,
  appearance: appearancePage,
  file: FileOptions,
}
const MenuOptions = [
  { label: '文件', action: () => (activeTab.value = 'file'), icon: 'icon-document', value: 'file' },
  // { label: '打开', action: onOpen, icon: 'icon-data-select' },
  // { label: '保存', action: onSave, icon: 'icon-baocun' },
  // { label: '另存为', action: onSaveAs, icon: 'icon-baocun' },
  { label: '设置', action: () => (activeTab.value = 'settings'), icon: 'icon-config-props', value: 'settings' },
  { label: '外观', action: () => (activeTab.value = 'appearance'), icon: 'icon-waiguan', value: 'appearance' },
  { label: '语言', action: () => (activeTab.value = 'language'), icon: 'icon-language', value: 'language' },
  { label: '关于', action: () => (activeTab.value = 'about'), icon: 'icon-github', value: 'about' },
]
</script>

<template>
  <div class="MenubarBox">
    <div class="optionsContainer">
      <span
        v-for="option in MenuOptions" :key="option.label" class="iconfont"
        :class="{ active: activeTab === option.value, [option.icon]: true }" @click="option.action"
      >
        {{ option.label }}
      </span>
    </div>
    <div class="detailContainer">
      <div class="scrollView">
        <div class="components">
          <component :is="MenuComponents[activeTab]" />
        </div>
      </div>
    </div>
  </div>
</template>

<style lang="less" scoped>
.MenubarBox {
  height: 100%;
  display: flex;

  .detailContainer {
    flex: 1;
    height: calc(100% - 24px);
    padding: 12px;
    padding-top: 0;
    padding-right: 0;
    background: var(--background-color-2);

    .scrollView {
      height: 100%;
      overflow-y: auto;
      background: var(--background-color-2);
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .components {
      height: 100%;
      padding-top: 12px;
    }
  }

  .optionsContainer {
    display: flex;
    flex-direction: column;
    justify-content: flex-start;
    align-items: flex-start;
    padding: 12px 0;
    width: 200px;
    gap: 4px;
    -webkit-app-region: drag;
    background: var(--background-color);

    span {
      cursor: pointer;
      width: 100%;
      -webkit-app-region: no-drag;
      padding: 16px 12px;
      font-size: 16px;
      display: flex;
      align-items: center;
      gap: 8px;
      color: var(--text-color);

      &::before {
        font-size: 16px;
        transform: translateY(1px);
        font-weight: 100 !important;
      }

      &:hover {
        background: var(--hover-color);
      }

      &.active {
        background: var(--active-color);
        font-weight: bold;
      }
    }
  }
}
</style>
