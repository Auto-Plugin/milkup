<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import emitter from "@/renderer/events";
import BottleIcon from "../ui/BottleIcon.vue";
import MenuBar from "./MenuBar.vue";

const isOpen = ref(false);

// 事件处理器
function handleFileChange() {
  isOpen.value = false;
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === "Escape" && isOpen.value) {
    isOpen.value = false;
  }
}

onMounted(() => {
  emitter.on("file:Change", handleFileChange);
  document.addEventListener("keydown", handleKeydown);
});

onUnmounted(() => {
  emitter.off("file:Change", handleFileChange);
  document.removeEventListener("keydown", handleKeydown);
});
</script>

<template>
  <div class="MenuDropDownBox">
    <div class="dropdown-header">
      <BottleIcon :size="18" class="logo" :class="{ active: isOpen }" @click="isOpen = !isOpen" />
    </div>
    <Transition name="menu-slide">
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
    padding: 0 0 3px 10px;
    height: 100%;
    -webkit-app-region: no-drag; /* 禁止拖动 */
    .logo {
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
    white-space: nowrap;
  }
}

.menu-slide-enter-active,
.menu-slide-leave-active {
  transition:
    opacity 0.15s ease,
    transform 0.15s ease;
}

.menu-slide-enter-from,
.menu-slide-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}
</style>
