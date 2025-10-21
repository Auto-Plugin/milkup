<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { vDraggable } from 'vue-draggable-plus'
import useFile from '@/hooks/useFile'
import useTab from '@/hooks/useTab'

const {
  formattedTabs,
  activeTabId,
  shouldOffsetTabBar,
  switchToTab,
  handleWheelScroll,
  closeWithConfirm,
  setupTabScrollListener,
  cleanupInertiaScroll,
  reorderTabs,

} = useTab()

const { createNewFile } = useFile()

// 拦截 ctrl/cmd + w 快捷键关闭tab
function handleCloseTabShortcut(e: KeyboardEvent) {
  const isMac = window.electronAPI.platform === 'darwin'
  if ((isMac ? e.metaKey : e.ctrlKey) && e.key.toLowerCase() === 'w') {
    e.preventDefault()
    if (activeTabId.value) {
      closeWithConfirm(activeTabId.value)
    }
  }
}
window.addEventListener('keydown', handleCloseTabShortcut)

// 获取tab容器的DOM引用
const tabContainerRef = ref<HTMLElement | null>(null)

function handleTabClick(id: string) {
  switchToTab(id)
}

function handleAddTab() {
  createNewFile()
}

async function handleCloseTab(id: string, event: Event) {
  event.stopPropagation()
  closeWithConfirm(id)
}

// 处理拖动排序
function handleDragEnd(event: { oldIndex: number, newIndex: number }) {
  reorderTabs(event.oldIndex, event.newIndex)
}

// 因为vueTransition的移除会让元素回到父元素0,  so 需要保存位置信息
function handleBeforeLeave(el: Element) {
  const element = el as HTMLElement
  const rect = element.getBoundingClientRect()
  const parentRect = element.parentElement?.getBoundingClientRect()

  if (parentRect) {
    const left = rect.left - parentRect.left
    const top = rect.top - parentRect.top

    element.style.setProperty('--tab-left', `${left}px`)
    element.style.setProperty('--tab-top', `${top}px`)
  }
}

// 设置滚动监听
setupTabScrollListener(tabContainerRef)

// 组件挂载时添加事件监听器
onMounted(() => {
  const container = tabContainerRef.value
  if (container) {
    container.addEventListener('wheel', event => handleWheelScroll(event, tabContainerRef), { passive: false })
  }
})

// 组件卸载时移除事件监听器和清理惯性滚动实例
onUnmounted(() => {
  const container = tabContainerRef.value
  if (container) {
    container.removeEventListener('wheel', event => handleWheelScroll(event, tabContainerRef))
    // 清理惯性滚动实例
    cleanupInertiaScroll(container)
  }
  window.removeEventListener('keydown', handleCloseTabShortcut)
})
</script>

<template>
  <div ref="tabContainerRef" class="tabBarContarner" :class="{ 'offset-right': shouldOffsetTabBar }">
    <TransitionGroup
      v-draggable="[formattedTabs, { animation: 1500, onEnd: handleDragEnd, ghostClass: 'ghost' }]"
      name="tab" class="tabBar" mode="out-in" tag="div" @before-leave="handleBeforeLeave"
    >
      <div
        v-for="tab in formattedTabs" :key="tab.id" class="tabItem" :class="{ active: activeTabId === tab.id }"
        :data-tab-id="tab.id" @click="handleTabClick(tab.id)"
      >
        <p>{{ tab.displayName }}</p>

        <div class="closeIcon">
          <span class="iconfont icon-close" @click="handleCloseTab(tab.id, $event)"></span>
        </div>

        <!-- pre -->

        <svg
          :class="{ active: activeTabId === tab.id }" class="pre" viewBox="0 0 5 5" fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path d="M5 5L0 5C3.33333 5 5 3.33333 5 -2.18557e-07L5 5Z" />
        </svg>

        <!-- after -->
        <svg
          :class="{ active: activeTabId === tab.id }" class="after" viewBox="0 0 5 5" fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path d="M0 5L5 5C1.66667 5 7.28523e-08 3.33333 2.18557e-07 -2.18557e-07L0 5Z" />
        </svg>
      </div>

      <div key="addTab" class="addTab" @click="handleAddTab">
        <div class="addTabLine"></div>
        <span class="iconfont icon-plus"></span>
      </div>
    </TransitionGroup>
  </div>
</template>

<style lang="less" scoped>
.tabBarContarner {

  flex: 1;
  height: 100%;
  display: flex;
  padding: 0 10px;
  flex-direction: column;
  justify-content: flex-end;
  overflow-x: scroll;
  overflow-y: hidden;
  transition: margin-left 0.6s 0.02s cubic-bezier(0.035, 0.630, 0.000, 1.000); //一个延迟能变得高级，你就学吧

  &::-webkit-scrollbar {
    display: none;
  }

  &.offset-right {
    margin-left: 25%;
  }

  .tabBar {
    display: flex;
    justify-content: flex-start;
    // gap: 15px;
    height: 30px;
    position: relative;

    .tabItem {
      position: relative;
      -webkit-app-region: no-drag;
      max-width: 200px;
      min-width: 150px;
      width: 150px; // 固定宽度，确保滚动效果
      flex-shrink: 0; // 防止收缩
      background: var(--background-color-1);
      // border: 1px solid var(--border-color-1);
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 0 10px;
      cursor: pointer;
      background: var(--background-color-2);
      gap: 8px;
      border-radius: 6px 6px 0 0;
      transition: all 0.3s ease;
      user-select: none;
      z-index: 0;

      .closeIcon {
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        flex-shrink: 0;

        span {
          font-size: 12px;
          line-height: 28px;
          cursor: pointer;
          color: var(--text-color-3);
        }
      }

      .closeIcon:hover {

        span {
          color: var(--text-color-1);
        }
      }

      p {
        margin: 0;
        font-size: 12px;
        color: var(--text-color-3);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        flex: 1;
        min-width: 0;
      }

      span {
        font-size: 12px;
        cursor: pointer;
        color: var(--text-color-3);

        &:hover {
          color: var(--border-color-2);
        }

      }

      &.active {
        background: var(--background-color-1);
        box-shadow: 0px 0 6px 2px rgba(0, 0, 0, 0.1);
        z-index: 2;

        p {
          color: var(--text-color-1);
        }

        span {
          color: var(--text-color-1);
        }

      }

      &:hover {

        z-index: 1;

        p {
          color: var(--text-color-2);
        }

        .closeIcon {

          span {
            color: var(--text-color-2);
          }
        }

      }
    }

    .addTab {

      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      gap: 6px;
      flex-shrink: 0; // 防止收缩
      min-width: 40px; // 确保最小宽度

      span {
        border-radius: 4px;
        -webkit-app-region: no-drag;
        font-size: 14px;
        font-weight: bold;
        cursor: pointer;
        color: var(--text-color-3);
        padding: 4px 11px;

      }

      .addTabLine {
        width: 0px;
        height: 20px;
        background: var(--border-color-1);
      }

      &:hover {
        span {

          background: var(--hover-color);
        }

        .addTabLine {
          background: var(--border-color-2);
        }
      }

    }

    .pre {
      position: absolute;
      left: -10px;

      bottom: -10px;
      width: 10px;
      height: 10px;
      height: 100%;
      fill: var(--background-color-2);
      animation: fadeIn 0.3s ease;
      transition: all 0.3s ease;

      &.active {
        fill: var(--background-color-1);
      }

    }

    .after {
      position: absolute;
      right: -10px;
      bottom: -10px;
      width: 10px;
      height: 10px;
      height: 100%;
      fill: var(--background-color-2);
      animation: fadeIn 0.3s ease;
      transition: all 0.3s ease;

      &.active {
        fill: var(--background-color-1);
      }
    }
  }
}

.tab-move,
/* 对移动中的元素应用的过渡 */
.tab-enter-active,
.tab-leave-active {
  transition: all 0.3s ease;
}

.tab-enter-from,
.tab-leave-to {
  opacity: 0;
  transform: translateY(30px);
  filter: blur(10px);
}

/* 确保将离开的元素从布局流中删除
  以便能够正确地计算移动的动画。 */
.tab-leave-active {
  position: absolute !important;
  left: var(--tab-left, 0);
  top: var(--tab-top, 0);
  width: 150px;
  z-index: 1;
  filter: blur(0px);
}

.ghost {
  opacity: 0.5;
  background: var(--background-color-2);
}

@keyframes fadeIn {
  from {
    opacity: 0;
  }

  to {
    opacity: 1;
  }
}
</style>
