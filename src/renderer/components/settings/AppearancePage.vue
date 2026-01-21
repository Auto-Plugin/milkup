<script setup lang="ts">
import FontPage from './FontPage.vue'
import OtherSetting from './OtherSetting.vue'
import ThemePage from './ThemePage.vue'
</script>

<template>
  <div class="appearance">
    <div class="appearance-item">
      <h2>主题</h2>

      <div class="appearance-item-content">
        <ThemePage />
      </div>
    </div>
    <div class="appearance-item">
      <h2>字体</h2>

      <div class="appearance-item-content">
        <FontPage />
      </div>
    </div>

    <div class="appearance-item">
      <h2>其他</h2>

      <div class="appearance-item-content">
        <OtherSetting />
      </div>
    </div>
  </div>
</template>

<style lang="less" scoped>
.appearance {
    width: 100%;
    display: flex;
    flex-direction: column;
    padding: 0 10px;
    box-sizing: border-box;
    gap: 10px;
    padding-bottom: 200px;
    max-width: 800px;

    .appearance-item {
        display: flex;
        flex-direction: column;
        gap: 10px;
    }
}
</style>
