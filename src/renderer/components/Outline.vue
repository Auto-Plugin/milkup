<script setup lang="ts">
import { ref } from 'vue'
import useOutline from '@/hooks/useOutline'

const { outline } = useOutline()

const activeTab = ref<'outline' | 'file'>('outline')

function onOiClick(oi: { id: string, text: string, level: number }) {
  // 滚动到指定元素
  const element = document.querySelector(`h${oi.level}[id="${oi.id}"]`)
  if (element) {
    element.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
}
</script>

<template>
  <div class="OutlineBox">
    <svg viewBox="0 0 5 5" fill="none" xmlns="http://www.w3.org/2000/svg" class="OutlineBoxBefore">
      <path d="M0 -1.31134e-07L3 0C1 -8.74228e-08 -4.37114e-08 1 -1.31134e-07 3L0 -1.31134e-07Z" />
    </svg>

    <svg viewBox="0 0 5 5" fill="none" xmlns="http://www.w3.org/2000/svg" class="OutlineBoxAfter">
      <path d="M0 5L5 5C1.66667 5 7.28523e-08 3.33333 2.18557e-07 -2.18557e-07L0 5Z" />
    </svg>

    <div class="OutlineBoxTabs">
      <div class="OutlineBoxTab" :class="{ active: activeTab === 'outline' }" @click="activeTab = 'outline'">
        大纲
      </div>
      <div class="OutlineBoxTab" :class="{ active: activeTab === 'file' }" @click="activeTab = 'file'">
        文件
      </div>
    </div>

    <div class="content-container">
      <div v-if="activeTab === 'outline'" class="outlineList">
        <span
          v-for="oi in outline" :key="oi.id" class="outlineItem" :style="{ paddingLeft: `${oi.level * 12}px` }"
          @click="onOiClick(oi)"
        >
          {{ oi.text }}
        </span>
        <span v-if="outline.length === 0" class="empty">暂无内容</span>
      </div>

      <div v-else-if="activeTab === 'file'" class="fileList">
        <div class="empty">
          文件列表开发中...
        </div>
      </div>
    </div>
  </div>
</template>

<style lang="less" scoped>
.OutlineBox {
  width: 100%;
  height: 100%;
  background: var(--background-color-2);
  display: flex;
  flex-direction: column;
  // overflow: hidden;
  position: relative;

  &::-webkit-scrollbar {
    display: none;
  }

  .OutlineBoxBefore {
    height: 10px;
    width: 10px;
    position: absolute;
    right: -10px;
    top: 0;

    // fill: red;
    fill: var(--background-color-2);
    z-index: 999;

  }
  .OutlineBoxAfter {
    height: 10px;
    width: 10px;
    position: absolute;
    right: -10px;
    bottom: 0;

    // fill: red;
    fill: var(--background-color-2);
    z-index: 999;

  }

  .OutlineBoxTabs {
    width: 100%;
    background: var(--background-color-2);
    display: flex;

    .OutlineBoxTab {
      width: 50%;
      padding: 10px;
      text-align: center;
      cursor: pointer;
      transition: color 0.3s ease;
      font-size: 12px;
      border-bottom: 2px solid transparent;
      color: var(--text-color-3);
      transition: all 0.3s ease;

      &:hover {
        color: var(--text-color-2);
      }

    }

    .active {
      color: var(--text-color-1);
      font-weight: bold;
      position: relative;

      &::after {
        content: '';
        position: absolute;
        bottom: 0;
        left: 50%;
        transform: translateX(-50%);
        width: 30%;
        height: 1px;
        background: var(--primary-color);
      }
    }
  }

  .content-container {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;

    &::-webkit-scrollbar {
      display: none;
    }
  }

  .outlineList {
    display: flex;
    flex-direction: column;
    gap: 6px;
    width: 100%;
    padding: 12px;

    .empty {
      color: var(--text-color-3);
      font-size: 14px;
      text-align: center;
      padding: 20px 0;
    }

    .outlineItem {
      width: 100%;
      color: var(--text-color-1);
      font-size: 14px;
      cursor: pointer;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      transition: color 0.3s ease;
      padding: 4px 8px;
      border-radius: 4px;

      &:hover {
        color: var(--text-color-2);
        background: var(--background-color-1);
      }
    }
  }

  .fileList {
    display: flex;
    flex-direction: column;
    gap: 8px;
    width: 100%;
    padding: 12px;

    .file-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      cursor: pointer;
      border-radius: 6px;
      transition: all 0.3s ease;

      &:hover {
        background: var(--background-color-1);
      }

      .file-icon {
        font-size: 16px;
      }

      .file-name {
        color: var(--text-color-1);
        font-size: 14px;
        flex: 1;
      }
    }

    .empty {
      color: var(--text-color-3);
      font-size: 14px;
      text-align: center;
      padding: 20px 0;
    }
  }
}
</style>
