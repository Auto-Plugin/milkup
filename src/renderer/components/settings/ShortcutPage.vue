<script setup lang="ts">
import { ref, computed } from "vue";
import {
  useShortcutConfig,
  formatKeyForDisplay,
  keyEventToProseMirrorKey,
} from "@/renderer/hooks/useShortcutConfig";
import type { ShortcutActionId, ShortcutCategory } from "@/core";

const {
  shortcuts,
  hasConflict,
  getConflictLabels,
  updateShortcut,
  resetShortcut,
  resetAll,
  CATEGORY_LABELS,
} = useShortcutConfig();

// 搜索状态
const nameSearch = ref("");
const keySearch = ref("");
const keySearchDisplay = ref("");

// 录制状态
const recordingId = ref<ShortcutActionId | null>(null);
const recordingKey = ref("");

// 分类折叠状态
const expandedCategories = ref<Set<ShortcutCategory>>(
  new Set(["inline", "block", "insert", "editor"])
);

// 按分类分组
const categories: ShortcutCategory[] = ["inline", "block", "insert", "editor"];

const filteredShortcuts = computed(() => {
  return shortcuts.value.filter((s) => {
    if (nameSearch.value) {
      const q = nameSearch.value.toLowerCase();
      if (!s.label.toLowerCase().includes(q) && !s.id.toLowerCase().includes(q)) {
        return false;
      }
    }
    if (keySearch.value) {
      if (s.key !== keySearch.value) return false;
    }
    return true;
  });
});

function groupedShortcuts(category: ShortcutCategory) {
  return filteredShortcuts.value.filter((s) => s.category === category);
}

function toggleCategory(cat: ShortcutCategory) {
  if (expandedCategories.value.has(cat)) {
    expandedCategories.value.delete(cat);
  } else {
    expandedCategories.value.add(cat);
  }
}
</script>

<template>
  <div class="shortcut-page">
    <!-- 搜索区域 -->
    <div class="search-area">
      <div class="search-box">
        <input
          v-model="nameSearch"
          class="search-input"
          placeholder="搜索功能名称..."
          @input="
            keySearch = '';
            keySearchDisplay = '';
          "
        />
        <span v-if="nameSearch" class="search-clear" @click="nameSearch = ''">&times;</span>
      </div>
      <div class="search-box">
        <div
          class="key-search-input"
          tabindex="0"
          :class="{ active: keySearchDisplay }"
          @keydown.prevent="
            (e: KeyboardEvent) => {
              if (e.key === 'Escape' || e.key === 'Backspace' || e.key === 'Delete') {
                keySearch = '';
                keySearchDisplay = '';
                return;
              }
              const k = keyEventToProseMirrorKey(e);
              if (k) {
                keySearch = k;
                keySearchDisplay = formatKeyForDisplay(k);
                nameSearch = '';
              }
            }
          "
        >
          {{ keySearchDisplay || "按下快捷键搜索..." }}
        </div>
        <span
          v-if="keySearchDisplay"
          class="search-clear"
          @click="
            keySearch = '';
            keySearchDisplay = '';
          "
          >&times;</span
        >
      </div>
    </div>

    <!-- 快捷键列表 -->
    <div class="shortcut-list">
      <template v-for="cat in categories" :key="cat">
        <div v-if="groupedShortcuts(cat).length > 0" class="category-section">
          <div class="category-header" @click="toggleCategory(cat)">
            <span
              class="iconfont icon-arrow-right"
              :class="{ expanded: expandedCategories.has(cat) }"
            ></span>
            <span class="category-label">{{ CATEGORY_LABELS[cat] }}</span>
            <span class="category-count">{{ groupedShortcuts(cat).length }}</span>
          </div>
          <div class="category-items" :class="{ expanded: expandedCategories.has(cat) }">
            <div v-for="s in groupedShortcuts(cat)" :key="s.id" class="shortcut-item">
              <span class="shortcut-label">{{ s.label }}</span>
              <div class="shortcut-key-area">
                <span
                  v-if="hasConflict(s.id)"
                  class="conflict-icon"
                  :title="'与以下功能冲突：' + getConflictLabels(s.id).join('、')"
                  >⚠</span
                >
                <div
                  class="key-badge"
                  :class="{
                    recording: recordingId === s.id,
                    conflict: hasConflict(s.id),
                    modified: s.key !== s.defaultKey,
                  }"
                  tabindex="0"
                  @click="
                    recordingId = s.id;
                    recordingKey = '';
                  "
                  @keydown.prevent="
                    (e: KeyboardEvent) => {
                      if (recordingId !== s.id) return;
                      if (e.key === 'Escape') {
                        recordingId = null;
                        recordingKey = '';
                        return;
                      }
                      const k = keyEventToProseMirrorKey(e);
                      if (k) {
                        updateShortcut(s.id, k);
                        recordingId = null;
                        recordingKey = '';
                      }
                    }
                  "
                  @blur="
                    recordingId = null;
                    recordingKey = '';
                  "
                >
                  {{ recordingId === s.id ? "请按下新快捷键..." : formatKeyForDisplay(s.key) }}
                </div>
                <button
                  v-if="s.key !== s.defaultKey"
                  class="reset-btn"
                  title="重置为默认值"
                  @click="resetShortcut(s.id)"
                >
                  ↺
                </button>
              </div>
            </div>
          </div>
        </div>
      </template>
    </div>

    <!-- 底部操作 -->
    <div class="footer-actions">
      <button class="reset-all-btn" @click="resetAll">重置所有快捷键</button>
    </div>
  </div>
</template>

<style lang="less" scoped>
.shortcut-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
  height: 100%;
  overflow-y: auto;
}

.search-area {
  display: flex;
  gap: 8px;
  flex-shrink: 0;

  .search-box {
    flex: 1;
    position: relative;
  }

  .search-clear {
    position: absolute;
    right: 8px;
    top: 50%;
    transform: translateY(-50%);
    width: 18px;
    height: 18px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    background: var(--border-color-1);
    color: var(--text-color-2);
    font-size: 14px;
    line-height: 1;
    cursor: pointer;

    &:hover {
      background: var(--border-color-2);
      color: var(--text-color);
    }
  }

  .search-input {
    width: 100%;
    padding: 8px 12px;
    border: 1px solid var(--border-color-1);
    border-radius: 6px;
    background: var(--background-color);
    color: var(--text-color);
    font-size: 13px;
    outline: none;
    box-sizing: border-box;

    &:focus {
      border-color: var(--primary-color, #4a9eff);
    }
  }

  .key-search-input {
    width: 100%;
    padding: 8px 12px;
    border: 1px solid var(--border-color-1);
    border-radius: 6px;
    background: var(--background-color);
    color: var(--text-color-2);
    font-size: 13px;
    outline: none;
    cursor: pointer;
    box-sizing: border-box;
    user-select: none;

    &:focus {
      border-color: var(--primary-color, #4a9eff);
      color: var(--text-color);
    }

    &.active {
      color: var(--text-color);
    }
  }
}

.shortcut-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex-shrink: 0;
}

.category-section {
  border: 1px solid var(--border-color-1);
  border-radius: 8px;
  overflow: hidden;
}

.category-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  cursor: pointer;
  background: var(--background-color);
  user-select: none;

  &:hover {
    background: var(--hover-color);
  }

  .iconfont {
    font-size: 12px;
    color: var(--text-color-2);
    transition: transform 0.2s ease;

    &.expanded {
      transform: rotate(90deg);
    }
  }

  .category-label {
    font-size: 14px;
    font-weight: 600;
    color: var(--text-color);
  }

  .category-count {
    font-size: 12px;
    color: var(--text-color-2);
    margin-left: auto;
  }
}

.category-items {
  max-height: 0;
  overflow: hidden;
  transition: max-height 0.3s ease;

  &.expanded {
    max-height: 2000px;
  }
}

.shortcut-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 16px 8px 36px;
  border-top: 1px solid var(--border-color-1);

  &:hover {
    background: var(--hover-color);
  }

  .shortcut-label {
    font-size: 13px;
    color: var(--text-color);
  }

  .shortcut-key-area {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .conflict-icon {
    color: #e6a23c;
    font-size: 14px;
    cursor: help;
  }

  .key-badge {
    padding: 4px 10px;
    border: 1px solid var(--border-color-1);
    border-radius: 4px;
    background: var(--background-color);
    color: var(--text-color);
    font-size: 12px;
    font-family: monospace;
    cursor: pointer;
    min-width: 80px;
    text-align: center;
    outline: none;
    user-select: none;
    white-space: nowrap;

    &:hover {
      border-color: var(--primary-color, #4a9eff);
    }

    &:focus {
      border-color: var(--primary-color, #4a9eff);
      box-shadow: 0 0 0 2px rgba(74, 158, 255, 0.2);
    }

    &.recording {
      border-color: var(--primary-color, #4a9eff);
      background: rgba(74, 158, 255, 0.1);
      color: var(--primary-color, #4a9eff);
      animation: pulse 1.5s infinite;
    }

    &.conflict {
      border-color: #e6a23c;
    }

    &.modified {
      border-color: var(--primary-color, #4a9eff);
      color: var(--primary-color, #4a9eff);
    }
  }

  .reset-btn {
    padding: 2px 6px;
    border: 1px solid var(--border-color-1);
    border-radius: 4px;
    background: transparent;
    color: var(--text-color-2);
    font-size: 14px;
    cursor: pointer;
    line-height: 1;

    &:hover {
      background: var(--hover-color);
      color: var(--text-color);
    }
  }
}

.footer-actions {
  display: flex;
  justify-content: flex-end;
  padding-top: 8px;
  padding-bottom: 16px;
  border-top: 1px solid var(--border-color-1);
  flex-shrink: 0;

  .reset-all-btn {
    padding: 6px 16px;
    border: 1px solid var(--border-color-1);
    border-radius: 6px;
    background: transparent;
    color: var(--text-color);
    font-size: 13px;
    cursor: pointer;

    &:hover {
      background: var(--hover-color);
      border-color: #e6a23c;
      color: #e6a23c;
    }
  }
}

@keyframes pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.6;
  }
}
</style>
