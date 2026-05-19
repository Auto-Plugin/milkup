<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import AppIcon from "@/renderer/components/ui/AppIcon.vue";
import WorkSpace from "@/renderer/components/workspace/WorkSpace.vue";
import useOutline from "@/renderer/hooks/useOutline";
import emitter from "@/renderer/events";

const { outline } = useOutline();

type OutlineItem = { id: string; level: number; text: string; pos: number };
type OutlineRow = {
  item: OutlineItem;
  hasChildren: boolean;
};

const savedTab = localStorage.getItem("sidebar-active-tab") as "outline" | "file" | null;
const activeTab = ref<"outline" | "file">(savedTab === "outline" ? "outline" : "file");
watch(activeTab, (val) => localStorage.setItem("sidebar-active-tab", val));

// 折叠状态：记录哪些标题被折叠了（key 是 heading id）
const collapsedSet = reactive(new Set<string>());

const outlineRows = computed<OutlineRow[]>(() => {
  const items = outline.value;
  const rows: OutlineRow[] = [];
  const collapsedAncestorLevels: number[] = [];

  items.forEach((item, index) => {
    while (
      collapsedAncestorLevels.length > 0 &&
      collapsedAncestorLevels[collapsedAncestorLevels.length - 1] >= item.level
    ) {
      collapsedAncestorLevels.pop();
    }

    const hasCollapsedAncestor = collapsedAncestorLevels.length > 0;
    const hasChildHeading = index + 1 < items.length && items[index + 1].level > item.level;

    if (!hasCollapsedAncestor) {
      rows.push({
        item,
        hasChildren: hasChildHeading,
      });
    }

    if (hasChildHeading && collapsedSet.has(item.id)) {
      collapsedAncestorLevels.push(item.level);
    }
  });

  return rows;
});

// 判断某个标题是否有子标题
function hasChildren(index: number): boolean {
  const items = outline.value;
  const currentLevel = items[index].level;
  return index + 1 < items.length && items[index + 1].level > currentLevel;
}

function toggleCollapse(oi: OutlineItem) {
  if (collapsedSet.has(oi.id)) {
    collapsedSet.delete(oi.id);
  } else {
    collapsedSet.add(oi.id);
  }
}

function onOiClick(oi: OutlineItem) {
  emitter.emit("outline:scrollTo", oi.pos);
}

// 右键菜单
const contextMenu = ref<{
  visible: boolean;
  x: number;
  y: number;
  item: OutlineItem | null;
}>({
  visible: false,
  x: 0,
  y: 0,
  item: null,
});

// 折叠子菜单
const showCollapseSubmenu = ref(false);

function onItemContextMenu(e: MouseEvent, oi: OutlineItem) {
  e.preventDefault();
  e.stopPropagation();
  showCollapseSubmenu.value = false;
  contextMenu.value = {
    visible: true,
    x: e.clientX,
    y: e.clientY,
    item: oi,
  };
}

function closeContextMenu() {
  contextMenu.value.visible = false;
  showCollapseSubmenu.value = false;
}

function handleJump() {
  if (contextMenu.value.item) {
    emitter.emit("outline:scrollTo", contextMenu.value.item.pos);
  }
  closeContextMenu();
}

function collapseByLevel(level: number) {
  // 折叠所有该级别的标题（只折叠有子标题的）
  outline.value.forEach((oi, index) => {
    if (oi.level === level && hasChildren(index)) {
      collapsedSet.add(oi.id);
    }
  });
  closeContextMenu();
}

function expandAll() {
  collapsedSet.clear();
  closeContextMenu();
}

// 全局点击关闭菜单
function onDocClick() {
  closeContextMenu();
}

import { onMounted, onUnmounted } from "vue";
onMounted(() => document.addEventListener("click", onDocClick));
onUnmounted(() => document.removeEventListener("click", onDocClick));
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
      <div
        class="OutlineBoxTab"
        :class="{ active: activeTab === 'file' }"
        @click="activeTab = 'file'"
      >
        文件
      </div>
      <div
        class="OutlineBoxTab"
        :class="{ active: activeTab === 'outline' }"
        @click="activeTab = 'outline'"
      >
        大纲
      </div>
    </div>

    <div class="content-container">
      <div v-if="activeTab === 'outline'" class="outlineList">
        <template v-if="outline.length > 0">
          <div
            v-for="{ item: oi, hasChildren: itemHasChildren } in outlineRows"
            :key="oi.id"
            class="outlineItem"
            :style="{ paddingLeft: `${oi.level * 12}px` }"
            @click="onOiClick(oi)"
            @contextmenu="onItemContextMenu($event, oi)"
          >
            <span
              v-if="itemHasChildren"
              class="collapse-icon"
              :class="{ collapsed: collapsedSet.has(oi.id) }"
              @click.stop="toggleCollapse(oi)"
            >
              <AppIcon name="arrow-right" />
            </span>
            <span v-else class="collapse-icon-placeholder"></span>
            <span class="outlineItem-text">{{ oi.text }}</span>
          </div>
        </template>
        <div v-else class="empty-state">
          <AppIcon name="List-outlined" class="empty-icon" />
          <span class="empty-text">暂无大纲</span>
        </div>
      </div>
      <WorkSpace v-else-if="activeTab === 'file'" />
    </div>

    <!-- 右键菜单 -->
    <Teleport to="body">
      <div
        v-if="contextMenu.visible"
        class="outline-context-menu"
        :style="{ left: contextMenu.x + 'px', top: contextMenu.y + 'px' }"
        @click.stop
      >
        <div class="outline-ctx-item" @click="handleJump">
          <span>跳转到该位置</span>
        </div>
        <div class="outline-ctx-divider" />
        <div
          class="outline-ctx-item has-submenu"
          @mouseenter="showCollapseSubmenu = true"
          @mouseleave="showCollapseSubmenu = false"
        >
          <span>折叠</span>
          <AppIcon name="arrow-right" class="submenu-arrow" />
          <!-- 二级菜单 -->
          <div v-if="showCollapseSubmenu" class="outline-submenu">
            <div class="outline-ctx-item" @click="collapseByLevel(1)">折叠一级标题</div>
            <div class="outline-ctx-item" @click="collapseByLevel(2)">折叠二级标题</div>
            <div class="outline-ctx-item" @click="collapseByLevel(3)">折叠三级标题</div>
            <div class="outline-ctx-item" @click="collapseByLevel(4)">折叠四级标题</div>
            <div class="outline-ctx-item" @click="collapseByLevel(5)">折叠五级标题</div>
            <div class="outline-ctx-item" @click="collapseByLevel(6)">折叠六级标题</div>
            <div class="outline-ctx-divider" />
            <div class="outline-ctx-item" @click="expandAll">展开全部</div>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style lang="less" scoped>
.OutlineBox {
  width: 100%;
  height: 100%;
  background: var(--background-color-2);
  display: flex;
  flex-direction: column;
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
    fill: var(--background-color-2);
    z-index: 999;
  }
  .OutlineBoxAfter {
    height: 10px;
    width: 10px;
    position: absolute;
    right: -10px;
    bottom: 0;
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
      font-size: 12px;
      border-bottom: 2px solid transparent;
      color: var(--text-color-3);
      transition: all 0.3s ease;

      &:hover {
        color: var(--text-color-2);
      }
    }

    .active {
      color: var(--text-color-3);
      font-weight: bold;
      position: relative;

      &::after {
        content: "";
        position: absolute;
        bottom: 0;
        left: 50%;
        transform: translateX(-50%);
        width: 30%;
        height: 1px;
        background: var(--text-color-3);
      }
    }
  }

  .content-container {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
    scrollbar-width: thin;
    scrollbar-color: color-mix(in srgb, var(--text-color-3) 34%, transparent) transparent;

    &::-webkit-scrollbar {
      width: 8px;
    }

    &::-webkit-scrollbar-track {
      background: transparent;
    }

    &::-webkit-scrollbar-thumb {
      background: color-mix(in srgb, var(--text-color-3) 28%, transparent);
      border: 2px solid transparent;
      border-radius: 999px;
      background-clip: content-box;
    }

    &::-webkit-scrollbar-thumb:hover {
      background: color-mix(in srgb, var(--text-color-3) 45%, transparent);
      background-clip: content-box;
    }
  }

  .outlineList {
    display: flex;
    flex-direction: column;
    width: 100%;
    padding: 8px 4px;

    .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 40px 20px;
      gap: 12px;

      .empty-icon {
        font-size: 32px;
        color: var(--text-color-3);
        opacity: 0.5;
      }

      .empty-text {
        color: var(--text-color-3);
        font-size: 12px;
      }
    }

    .outlineItem {
      display: flex;
      align-items: center;
      width: 100%;
      color: var(--text-color-1);
      font-size: 13px;
      cursor: pointer;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      transition: all 0.2s ease;
      padding: 4px 4px;
      border-radius: 4px;
      margin: 0 2px;

      &:hover {
        background: var(--background-color-1);
      }

      .collapse-icon {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 16px;
        height: 16px;
        flex-shrink: 0;
        margin-right: 4px;
        transition: transform 0.2s;
        transform: rotate(90deg);
        color: var(--text-color-3);
        font-size: 10px;
        border-radius: 3px;

        &:hover {
          background: var(--hover-background-color);
        }

        &.collapsed {
          transform: rotate(0deg);
        }
      }

      .collapse-icon-placeholder {
        display: inline-block;
        width: 16px;
        height: 16px;
        flex-shrink: 0;
        margin-right: 4px;
      }

      .outlineItem-text {
        overflow: hidden;
        text-overflow: ellipsis;
      }
    }
  }

  .fileList {
    display: flex;
    flex-direction: column;
    gap: 8px;
    width: 100%;

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

<style lang="less">
// 大纲右键菜单
.outline-context-menu {
  position: fixed;
  z-index: 10000;
  min-width: 140px;
  background: var(--background-color-1);
  border: 1px solid var(--border-color-1);
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  padding: 4px 0;
  font-size: 12px;

  .outline-ctx-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 6px 12px;
    cursor: pointer;
    color: var(--text-color-1);
    transition: background-color 0.15s;
    position: relative;
    white-space: nowrap;

    &:hover {
      background: var(--hover-background-color);
    }

    .submenu-arrow {
      font-size: 10px;
      color: var(--text-color-3);
    }
  }

  .outline-ctx-divider {
    height: 1px;
    background: var(--border-color-1);
    margin: 4px 0;
  }

  .has-submenu {
    position: relative;
  }

  .outline-submenu {
    position: absolute;
    left: 100%;
    top: -4px;
    min-width: 130px;
    background: var(--background-color-1);
    border: 1px solid var(--border-color-1);
    border-radius: 6px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    padding: 4px 0;
  }
}
</style>
