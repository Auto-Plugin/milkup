<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import { vDraggable } from "vue-draggable-plus";
import useFile from "@/renderer/hooks/useFile";
import useTab from "@/renderer/hooks/useTab";

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
  startTearOff,
  endTearOff,
  cancelTearOff,
  isSingleTab,
  startSingleTabDrag,
  endSingleTabDrag,
} = useTab();

const { createNewFile } = useFile();

// 拦截 ctrl/cmd + w 快捷键关闭tab
function handleCloseTabShortcut(e: KeyboardEvent) {
  const isMac = window.electronAPI.platform === "darwin";
  if ((isMac ? e.metaKey : e.ctrlKey) && e.key.toLowerCase() === "w") {
    e.preventDefault();
    if (activeTabId.value) {
      closeWithConfirm(activeTabId.value);
    }
  }
}
window.addEventListener("keydown", handleCloseTabShortcut);

// 获取tab容器的DOM引用
const tabContainerRef = ref<HTMLElement | null>(null);

// 保存wheel事件处理器引用以便正确移除
let wheelHandler: ((event: WheelEvent) => void) | null = null;

function handleTabClick(id: string) {
  switchToTab(id);
}

function handleAddTab() {
  createNewFile();
}

async function handleCloseTab(id: string, event: Event) {
  event.stopPropagation();
  closeWithConfirm(id);
}

// ── Tab 拖拽分离检测 ────────────────────────────────────────

/** 鼠标超出窗口边界的阈值（px），避免微小越界误触发 */
const TEAR_OFF_THRESHOLD = 30;

/** 拖拽期间的状态 */
let dragState: {
  tabId: string | null;
  tearOffTriggered: boolean; // 多 Tab：已触发 tear-off
  singleTabDragActive: boolean; // 单 Tab：窗口拖拽激活
  lastScreenX: number;
  lastScreenY: number;
  initialOffsetX: number; // 鼠标距离 Tab 左上角的 X 偏移
  initialOffsetY: number; // 鼠标距离 Tab 左上角的 Y 偏移
} = {
  tabId: null,
  tearOffTriggered: false,
  singleTabDragActive: false,
  lastScreenX: 0,
  lastScreenY: 0,
  initialOffsetX: 0,
  initialOffsetY: 0,
};

/** 缓存的窗口边界 */
let cachedBounds: { x: number; y: number; width: number; height: number } | null = null;

/** 判断屏幕坐标是否在窗口外 */
function isOutsideWindow(screenX: number, screenY: number): boolean {
  if (!cachedBounds) return false;
  const { x, y, width, height } = cachedBounds;
  return (
    screenX < x - TEAR_OFF_THRESHOLD ||
    screenX > x + width + TEAR_OFF_THRESHOLD ||
    screenY < y - TEAR_OFF_THRESHOLD ||
    screenY > y + height + TEAR_OFF_THRESHOLD
  );
}

/**
 * 拖拽期间的 pointer 位置追踪
 *
 * 多 Tab：指针离开窗口 → 立即创建新窗口跟随光标（fire-and-forget）
 * 单 Tab：直接进入窗口拖拽模式（由主进程 setInterval 驱动位置更新）
 */
function onDragPointerMove(e: PointerEvent) {
  dragState.lastScreenX = e.screenX;
  dragState.lastScreenY = e.screenY;

  // 单 Tab 模式已激活，不需要做别的
  if (dragState.singleTabDragActive) return;

  if (!dragState.tabId) return;

  if (isSingleTab.value) {
    // ── 单 Tab：立即开始窗口拖拽 ──
    if (!cachedBounds) return;
    dragState.singleTabDragActive = true;
    const offsetX = e.screenX - cachedBounds.x;
    const offsetY = e.screenY - cachedBounds.y;
    startSingleTabDrag(dragState.tabId, offsetX, offsetY);
    document.body.classList.add("tab-torn-off");
    return;
  }

  // 多 Tab 模式：检测拖拽分离与回拖
  if (dragState.tearOffTriggered) {
    // 已触发 tear-off，检查指针是否回到窗口内
    if (!isOutsideWindow(e.screenX, e.screenY)) {
      // 指针回到窗口内 → 取消分离，关闭跟随窗口
      dragState.tearOffTriggered = false;
      document.body.classList.remove("tab-torn-off");
      cancelTearOff();
    }
    return;
  }

  if (isOutsideWindow(e.screenX, e.screenY)) {
    // ── 多 Tab：指针离开窗口 → 开始分离跟随 ──
    dragState.tearOffTriggered = true;
    document.body.classList.add("tab-torn-off");
    startTearOff(
      dragState.tabId,
      e.screenX,
      e.screenY,
      dragState.initialOffsetX,
      dragState.initialOffsetY
    );
  }
}

/** SortableJS onStart：记录拖拽的 Tab 并开始追踪指针 */
function handleDragStart(event: any) {
  const tabId = event.item?.dataset?.tabId ?? null;

  // 计算初始点击位置相对 Tab 元素的偏移
  let initialOffsetX = 0;
  let initialOffsetY = 0;
  if (event.originalEvent && event.item) {
    const rect = event.item.getBoundingClientRect();
    const clientX = event.originalEvent.clientX ?? event.originalEvent.touches?.[0]?.clientX ?? 0;
    const clientY = event.originalEvent.clientY ?? event.originalEvent.touches?.[0]?.clientY ?? 0;
    if (clientX && clientY) {
      initialOffsetX = clientX - rect.left;
      initialOffsetY = clientY - rect.top;
    }
  }

  dragState = {
    tabId,
    tearOffTriggered: false,
    singleTabDragActive: false,
    lastScreenX: 0,
    lastScreenY: 0,
    initialOffsetX,
    initialOffsetY,
  };

  // 非阻塞获取窗口边界，tear-off 检测在边界就绪后自动激活
  window.electronAPI.getWindowBounds().then((bounds) => {
    cachedBounds = bounds;
  });

  document.addEventListener("pointermove", onDragPointerMove, { capture: true });
}

/**
 * SortableJS onEnd：鼠标松开
 * - 单 Tab 窗口拖拽 → 停止拖拽，判断合并
 * - 多 Tab tear-off → 停止跟随，判断合并/保留
 * - 正常拖拽 → 重排
 */
function handleDragEnd(event: { oldIndex: number; newIndex: number }) {
  document.removeEventListener("pointermove", onDragPointerMove, { capture: true });
  document.body.classList.remove("tab-torn-off");

  const { tabId, tearOffTriggered, singleTabDragActive, lastScreenX, lastScreenY } = dragState;
  dragState = {
    tabId: null,
    tearOffTriggered: false,
    singleTabDragActive: false,
    lastScreenX: 0,
    lastScreenY: 0,
    initialOffsetX: 0,
    initialOffsetY: 0,
  };
  cachedBounds = null;

  if (singleTabDragActive) {
    endSingleTabDrag(lastScreenX, lastScreenY);
    return;
  }

  if (tearOffTriggered && tabId) {
    // 必须通过数据驱动视图更新，确保 SortableJS 内部状态重置
    // 使用 requestAnimationFrame 确保 UI 更新后再执行结束逻辑
    requestAnimationFrame(() => {
      endTearOff(tabId, lastScreenX, lastScreenY);
    });
    return;
  }

  reorderTabs(event.oldIndex, event.newIndex);
}

// 因为vueTransition的移除会让元素回到父元素0,  so 需要保存位置信息
function handleBeforeLeave(el: Element) {
  const element = el as HTMLElement;
  const rect = element.getBoundingClientRect();
  const parentRect = element.parentElement?.getBoundingClientRect();

  if (parentRect) {
    const left = rect.left - parentRect.left;
    const top = rect.top - parentRect.top;

    element.style.setProperty("--tab-left", `${left}px`);
    element.style.setProperty("--tab-top", `${top}px`);
  }
}

// 设置滚动监听
setupTabScrollListener(tabContainerRef);

// 组件挂载时添加事件监听器
onMounted(() => {
  const container = tabContainerRef.value;
  if (container) {
    // 创建并保存事件处理器引用
    wheelHandler = (event: WheelEvent) => handleWheelScroll(event, tabContainerRef);
    container.addEventListener("wheel", wheelHandler, { passive: false });
  }
});

// 组件卸载时移除事件监听器和清理惯性滚动实例
onUnmounted(() => {
  const container = tabContainerRef.value;
  if (container && wheelHandler) {
    // 使用保存的引用移除监听器
    container.removeEventListener("wheel", wheelHandler);
    // 清理惯性滚动实例
    cleanupInertiaScroll(container);
  }
  // 移除全局键盘事件监听器
  window.removeEventListener("keydown", handleCloseTabShortcut);
  // 清理拖拽追踪
  document.removeEventListener("pointermove", onDragPointerMove, { capture: true });
});
</script>

<template>
  <div
    ref="tabContainerRef"
    class="tabBarContarner"
    :class="{ 'offset-right': shouldOffsetTabBar }"
  >
    <TransitionGroup
      v-draggable="[
        formattedTabs,
        {
          animation: 250,
          forceFallback: true,
          fallbackOnBody: true,
          fallbackTolerance: 3,
          onStart: handleDragStart,
          onEnd: handleDragEnd,
          ghostClass: 'ghost',
          fallbackClass: 'tab-drag-fallback',
          draggable: '.tabItem',
          filter: '.addTab',
          delay: 0,
        },
      ]"
      name="tab"
      class="tabBar"
      mode="out-in"
      tag="div"
      @before-leave="handleBeforeLeave"
    >
      <div
        v-for="tab in formattedTabs"
        :key="tab.id"
        class="tabItem"
        :class="{ active: activeTabId === tab.id, 'merge-preview': tab.isMergePreview }"
        :data-tab-id="tab.id"
        @click="handleTabClick(tab.id)"
      >
        <p>{{ `${tab.readOnly ? "[只读] " : ""}${tab.displayName}` }}</p>

        <div class="closeIcon">
          <span class="iconfont icon-close" @click="handleCloseTab(tab.id, $event)"></span>
        </div>

        <!-- pre -->

        <svg
          :class="{ active: activeTabId === tab.id }"
          class="pre"
          viewBox="0 0 5 5"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path d="M5 5L0 5C3.33333 5 5 3.33333 5 -2.18557e-07L5 5Z" />
        </svg>

        <!-- after -->
        <svg
          :class="{ active: activeTabId === tab.id }"
          class="after"
          viewBox="0 0 5 5"
          fill="none"
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
  transition: margin-left 0.6s 0.02s cubic-bezier(0.035, 0.63, 0, 1); //一个延迟能变得高级，你就学吧

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

          &::before {
            padding: 2px;
          }
        }
      }

      .closeIcon:hover {
        span {
          color: var(--text-color-1);

          &::before {
            background: var(--active-color);
            border-radius: 9999px;
          }
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

      &.merge-preview {
        background: var(--background-color-2);
        opacity: 0.6;
        border: 2px dashed var(--active-color);
        box-shadow: none;

        p,
        .closeIcon {
          opacity: 0.5;
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

/* forceFallback 克隆体：保持原始 tab 样式，仅隐藏无关装饰 */
:global(.tab-drag-fallback) {
  /* 恢复丢失的 scoped 样式 */
  position: fixed; /* fallbackOnBody 时是 fixed */
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: var(--background-color-1);
  gap: 8px;
  border-radius: 6px 6px 0 0;
  padding: 0 10px;
  box-sizing: border-box;
  width: 150px;
  height: 30px; /* tabItem 高度由父级决定，这里显式指定 */

  z-index: 99999;
  pointer-events: none;
  box-shadow: 0 8px 20px rgba(0, 0, 0, 0.25);
  opacity: 0.95;
  cursor: grabbing;
}

:global(.tab-drag-fallback p) {
  margin: 0;
  font-size: 12px;
  color: var(--text-color-1); /* 激活态颜色 */
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  min-width: 0;
}

:global(.tab-drag-fallback .closeIcon) {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

:global(.tab-drag-fallback .closeIcon span) {
  font-size: 12px;
  line-height: 28px;
  color: var(--text-color-1);
}

:global(.tab-drag-fallback .pre),
:global(.tab-drag-fallback .after) {
  position: absolute;

  bottom: -10px;
  width: 10px;
  height: 100%;
  fill: var(--background-color-2);
  animation: fadeIn 0.3s ease;
  transition: all 0.3s ease;

  &.active {
    fill: var(--background-color-1);
  }
}
:global(.tab-drag-fallback .pre) {
  left: -10px;
}
:global(.tab-drag-fallback .after) {
  right: -10px;
}

/* Tab 拖拽到窗口外时隐藏 SortableJS 克隆体（此时新窗口已在跟随光标） */
:global(body.tab-torn-off .tab-drag-fallback) {
  opacity: 0;
  transition: none;
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
