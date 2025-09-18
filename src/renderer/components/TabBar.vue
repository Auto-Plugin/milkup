<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { vDraggable } from 'vue-draggable-plus'
import useFile from '@/hooks/useFile'
import useTab from '@/hooks/useTab'

const {
  formattedTabs,
  activeTabId,
  switchToTab,
  handleWheelScroll,
  closeWithConfirm,
  setupTabScrollListener,
  reorderTabs,
} = useTab()

const { createNewFile } = useFile()

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

// 设置滚动监听
setupTabScrollListener(tabContainerRef)

// 组件挂载时添加事件监听器
onMounted(() => {
  const container = tabContainerRef.value
  if (container) {
    container.addEventListener('wheel', event => handleWheelScroll(event, tabContainerRef), { passive: false })
  }
})

// 组件卸载时移除事件监听器
onUnmounted(() => {
  const container = tabContainerRef.value
  if (container) {
    container.removeEventListener('wheel', event => handleWheelScroll(event, tabContainerRef))
  }
})
</script>

<template>
  <div ref="tabContainerRef" class="tabBarContarner">
    <TransitionGroup
      v-draggable="[formattedTabs, { animation: 1500, onEnd: handleDragEnd, ghostClass: 'ghost' }]"
      name="tab"
      class="tabBar"
      mode="out-in"
      tag="div"
    >
      <div
        v-for="tab in formattedTabs" :key="tab.id" class="tabItem" :class="{ active: activeTabId === tab.id }"
        :data-tab-id="tab.id"
        @click="handleTabClick(tab.id)"
      >
        <p>{{ tab.displayName }}</p>

        <div class="closeIcon">
          <span class="iconfont icon-close" @click="handleCloseTab(tab.id, $event)"></span>
        </div>

        <!-- pre -->

        <svg
          :class="{ active: activeTabId === tab.id }" class="pre" viewBox="0 0 4 4" fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path d="M3 3C3.7799 2.2201 3.99414 0 3.99414 0V3.99414H0C0 3.99414 2.2201 3.7799 3 3Z" />
        </svg>

        <!-- after -->
        <svg
          :class="{ active: activeTabId === tab.id }" class="after" viewBox="0 0 4 4" fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M0.994141 3C0.214236 2.2201 1.90735e-06 0 1.90735e-06 0V3.99414H3.99414C3.99414 3.99414 1.77404 3.7799 0.994141 3Z"
          />
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
  // 隐藏滚动条
  &::-webkit-scrollbar {
    display: none;
  }

  .tabBar {

    display: flex;
    justify-content: flex-start;
    // gap: 15px;
    height: 30px;

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
        // background: var(--hover-color);
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

.tab-move, /* 对移动中的元素应用的过渡 */
.tab-enter-active,
.tab-leave-active {
  transition: all 0.3s ease;
}

.tab-enter-from,
.tab-leave-to {
  opacity: 0;
  transform: translateY(30px);
}

/* 确保将离开的元素从布局流中删除
  以便能够正确地计算移动的动画。 */
.tab-leave-active {
  position: absolute;
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
