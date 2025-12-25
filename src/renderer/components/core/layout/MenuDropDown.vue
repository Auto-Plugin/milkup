<script setup lang="ts">
import { useEventListener } from '@vueuse/core'
import { ref } from 'vue'
import logo from '@/assets/icons/milkup.ico'
import emitter from '@/renderer/events'
import MenuBar from './MenuBar.vue'

const isOpen = ref(false)

emitter.on('file:Change', () => {
  isOpen.value = false
})

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && isOpen.value) {
    isOpen.value = false
  }
}

useEventListener(document, 'keydown', handleKeydown)
</script>

<template>
  <div class="MenuDropDownBox">
    <div class="dropdown-header">
      <img :src="logo" alt="" class="logo" :class="{ active: isOpen }" @click="isOpen = !isOpen" />
    </div>
    <Transition name="fade">
      <div v-show="isOpen" class="dropdown-content">
        <MenuBar />
      </div>
    </Transition>
  </div>
</template>

<style lang="less" scoped>
.MenuDropDownBox {
  height: 100%;
  .dropdown-header {
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    cursor: pointer;
    padding: 0 0 0 10px;
    height: 100%;
    -webkit-app-region: no-drag; /* 禁止拖动 */
    img {
      width: 24px;
      height: 24px;
      border-radius: 50%;
      // margin-right: 8px;
      display: inline-block;
      transition: 0.2s;
      margin: 4px;
      &.active {
        transform: rotate(180deg);
      }
    }
  }
  .dropdown-content {
    position: absolute;
    top: 40px; /* 与标题栏高度一致 */
    left: 0;
    background: var(--background-color-1);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
    z-index: 1000;
    width: 100%;
    height: 100%;
    border-radius: 4px;
    -webkit-app-region: no-drag; /* 禁止拖动 */
    // animation: fade-in 0.3s linear;
    white-space: nowrap;
  }
}
</style>
