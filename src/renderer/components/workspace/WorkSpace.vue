<script lang="ts" setup>
import type { TreeNode } from "@ui/tree";
import { onMounted, onUnmounted, ref } from "vue";
import { Tree } from "@ui/tree";
import useTab from "@/renderer/hooks/useTab";
import useWorkSpace from "@/renderer/hooks/useWorkSpace";

const {
  workSpace,
  setWorkSpace,
  searchQuery,
  sortBy,
  toggleSort,
  editingNode,
  createFile,
  createFolder,
  deleteFile,
  renameFile,
  hardRefreshWorkSpace,
  watchedDirPath,
} = useWorkSpace();
const { currentTab, openFile } = useTab();

// 右键菜单状态
const contextMenu = ref<{
  visible: boolean;
  x: number;
  y: number;
  node: TreeNode | null;
}>({
  visible: false,
  x: 0,
  y: 0,
  node: null,
});

// 删除确认弹窗
const deleteConfirm = ref<{
  visible: boolean;
  node: TreeNode | null;
}>({
  visible: false,
  node: null,
});

// 打开文件夹选择对话框
function openFolder() {
  setWorkSpace();
}

function handleNodeClick({ path }: TreeNode) {
  openFile(path);
}

// 右键菜单
function handleContextMenu(node: TreeNode, event: MouseEvent) {
  contextMenu.value = {
    visible: true,
    x: event.clientX,
    y: event.clientY,
    node,
  };
}

function closeContextMenu() {
  contextMenu.value.visible = false;
}

function onDocumentClick() {
  closeContextMenu();
}

onMounted(() => {
  document.addEventListener("click", onDocumentClick);
});
onUnmounted(() => {
  document.removeEventListener("click", onDocumentClick);
});

// 空白区域右键
function onBlankContextMenu(e: MouseEvent) {
  // 未打开文件夹时不显示右键菜单
  if (!workSpace.value) return;
  e.preventDefault();
  contextMenu.value = {
    visible: true,
    x: e.clientX,
    y: e.clientY,
    node: null,
  };
}

// 菜单操作
function getTargetDir(node: TreeNode | null): string {
  if (!node) return watchedDirPath.value ?? "";
  if (node.isDirectory) return node.path;
  // 文件所在的目录
  return node.path.replace(/[/\\][^/\\]+$/, "");
}

async function handleNewFile() {
  closeContextMenu();
  const dir = getTargetDir(contextMenu.value.node);
  if (!dir) return;
  await createFile(dir);
}

async function handleNewFolder() {
  closeContextMenu();
  const dir = getTargetDir(contextMenu.value.node);
  if (!dir) return;
  await createFolder(dir);
}

async function handleRefresh() {
  closeContextMenu();
  await hardRefreshWorkSpace();
}

function handleRename() {
  closeContextMenu();
  const node = contextMenu.value.node;
  if (!node) return;
  editingNode.value = { path: node.path, isNew: false };
}

function handleDelete() {
  closeContextMenu();
  const node = contextMenu.value.node;
  if (!node) return;
  deleteConfirm.value = { visible: true, node };
}

async function confirmDelete() {
  const node = deleteConfirm.value.node;
  deleteConfirm.value = { visible: false, node: null };
  if (!node) return;
  await deleteFile(node.path);
}

function cancelDelete() {
  deleteConfirm.value = { visible: false, node: null };
}

// 编辑确认/取消
async function handleEditConfirm(node: TreeNode, newName: string) {
  if (!editingNode.value) return;

  if (editingNode.value.isNew) {
    // 新建文件：如果名称不变（用户直接确认），保留文件
    // 如果名称改变，重命名
    if (newName !== node.name) {
      await renameFile(node.path, newName);
    }
  } else {
    // 重命名
    if (newName !== node.name) {
      await renameFile(node.path, newName);
    }
  }
  editingNode.value = null;
}

function handleEditCancel(node: TreeNode) {
  if (editingNode.value?.isNew) {
    // 新建文件取消：删除临时文件
    deleteFile(node.path);
  }
  editingNode.value = null;
}

// 工具栏新建文件
async function toolbarNewFile() {
  const dir = watchedDirPath.value;
  if (!dir) return;
  await createFile(dir);
}

// 排序标签
function getSortLabel() {
  return sortBy.value === "name" ? "按名称" : "按时间";
}
</script>

<template>
  <div class="WorkSpace" @contextmenu.prevent="onBlankContextMenu">
    <!-- 工具栏 -->
    <div v-if="workSpace" class="workspace-toolbar">
      <div class="search-wrapper">
        <input v-model="searchQuery" class="search-input" placeholder="搜索文件..." />
      </div>
      <button class="toolbar-btn" :title="getSortLabel()" @click="toggleSort">
        <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor">
          <path v-if="sortBy === 'name'" d="M1 3.5h14v1H1zm0 4h10v1H1zm0 4h6v1H1z" />
          <path v-else d="M1 3.5h6v1H1zm0 4h10v1H1zm0 4h14v1H1z" />
        </svg>
      </button>
      <button class="toolbar-btn" title="新建文件" @click="toolbarNewFile">
        <span class="iconfont icon-plus"></span>
      </button>
    </div>

    <Tree
      v-if="workSpace"
      :nodes="workSpace"
      :current-node="currentTab ? currentTab.filePath : null"
      :editing-path="editingNode?.path ?? null"
      @node-click="handleNodeClick"
      @node-context-menu="handleContextMenu"
      @edit-confirm="handleEditConfirm"
      @edit-cancel="handleEditCancel"
    />
    <div v-if="workSpace" class="change-folder-bar">
      <button class="change-folder-btn" @click="openFolder">
        <span class="iconfont icon-folder-opened"></span>
        <span>更换文件夹</span>
      </button>
    </div>
    <div v-if="!workSpace" class="empty-state">
      <span class="iconfont icon-folder-opened empty-icon"></span>
      <p>暂无打开的文件夹</p>
      <button class="open-folder-btn" @click="openFolder">选择文件夹</button>
    </div>

    <!-- 右键菜单 -->
    <Teleport to="body">
      <div
        v-if="contextMenu.visible"
        class="context-menu"
        :style="{ left: contextMenu.x + 'px', top: contextMenu.y + 'px' }"
        @click.stop
      >
        <div class="context-menu-item" @click="handleNewFile">
          <span class="iconfont icon-plus"></span>
          <span>新建文件</span>
        </div>
        <div class="context-menu-item" @click="handleNewFolder">
          <span class="iconfont icon-folder-opened"></span>
          <span>新建文件夹</span>
        </div>
        <template v-if="contextMenu.node">
          <div class="context-menu-item" @click="handleRename">
            <span class="iconfont icon-edit"></span>
            <span>重命名</span>
          </div>
          <div class="context-menu-divider" />
          <div class="context-menu-item danger" @click="handleDelete">
            <span class="iconfont icon-close"></span>
            <span>删除</span>
          </div>
        </template>
        <div class="context-menu-divider" />
        <div class="context-menu-item" @click="handleRefresh">
          <svg
            viewBox="0 0 16 16"
            width="13"
            height="13"
            fill="currentColor"
            style="flex-shrink: 0"
          >
            <path
              d="M13.65 2.35A7.96 7.96 0 0 0 8 0C3.58 0 0 3.58 0 8s3.58 8 8 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0 1 8 14 6 6 0 1 1 8 2c1.66 0 3.14.69 4.22 1.78L9 7h7V0l-2.35 2.35z"
              transform="scale(0.8) translate(2,2)"
            />
          </svg>
          <span>刷新</span>
        </div>
      </div>
    </Teleport>

    <!-- 删除确认弹窗 -->
    <Teleport to="body">
      <Transition name="dialog-fade" appear>
        <div v-if="deleteConfirm.visible" class="dialog-overlay" @click.self="cancelDelete">
          <div class="dialog-content">
            <div class="dialog-header">
              <h3>确认删除</h3>
            </div>
            <div class="dialog-body">
              <p>
                确定要删除
                <strong>{{ deleteConfirm.node?.name }}</strong>
                吗？此操作不可恢复。
              </p>
            </div>
            <div class="dialog-footer">
              <button class="btn btn-secondary" @click="cancelDelete">取消</button>
              <button class="btn btn-danger" @click="confirmDelete">确认删除</button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style lang="less" scoped>
.WorkSpace {
  height: 100%;
  overflow: auto;
  position: relative;
  display: flex;
  flex-direction: column;

  // 隐藏滚动条但保持滚动功能
  scrollbar-width: none; // Firefox
  -ms-overflow-style: none; // IE/Edge

  &::-webkit-scrollbar {
    display: none; // Chrome/Safari/Opera
  }

  .workspace-toolbar {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 6px 8px;
    border-bottom: 1px solid var(--border-color-1);
    flex-shrink: 0;

    .search-wrapper {
      flex: 1;
      min-width: 0;
    }

    .search-input {
      width: 100%;
      height: 24px;
      padding: 0 8px;
      border: 1px solid var(--border-color-1);
      border-radius: 4px;
      background: var(--background-color-2);
      color: var(--text-color-1);
      font-size: 12px;
      outline: none;
      transition: border-color 0.2s;
      box-sizing: border-box;

      &::placeholder {
        color: var(--text-color-3);
      }

      &:focus {
        border-color: var(--primary-color);
      }
    }

    .toolbar-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 24px;
      height: 24px;
      border: none;
      border-radius: 4px;
      background: transparent;
      color: var(--text-color-3);
      cursor: pointer;
      flex-shrink: 0;
      font-size: 12px;
      transition: all 0.2s;

      &:hover {
        background: var(--hover-background-color);
        color: var(--text-color-1);
      }

      .iconfont {
        font-size: 14px;
      }
    }
  }

  .change-folder-bar {
    flex-shrink: 0;
    padding: 8px;
    border-top: 1px solid var(--border-color-1);
    margin-top: auto;

    .change-folder-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      width: 100%;
      padding: 6px 0;
      border: 1px solid var(--border-color-1);
      border-radius: 5px;
      cursor: pointer;
      background: var(--background-color-2);
      color: var(--text-color-3);
      font-size: 12px;
      transition: all 0.2s ease;

      .iconfont {
        font-size: 13px;
      }

      &:hover {
        background: var(--hover-background-color);
        color: var(--text-color-1);
        border-color: var(--primary-color);
      }
    }
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    flex: 1;
    gap: 12px;
    padding: 20px;

    .empty-icon {
      font-size: 36px;
      color: var(--text-color-3);
      opacity: 0.5;
    }

    p {
      color: var(--text-color-3);
      font-size: 12px;
      margin: 0;
    }

    .open-folder-btn {
      font-size: 12px;
      line-height: 1;
      padding: 6px 16px;
      border-radius: 5px;
      border: 1px solid var(--border-color-1);
      cursor: pointer;
      background: var(--background-color-2);
      color: var(--text-color-2);
      transition: all 0.2s ease;

      &:hover {
        background: var(--hover-background-color);
        color: var(--text-color-1);
        border-color: var(--primary-color);
      }
    }
  }
}
</style>

<style lang="less">
// 右键菜单（全局样式）
.context-menu {
  position: fixed;
  z-index: 10000;
  min-width: 140px;
  background: var(--background-color-1);
  border: 1px solid var(--border-color-1);
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  padding: 4px 0;
  font-size: 12px;

  .context-menu-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 12px;
    cursor: pointer;
    color: var(--text-color-1);
    transition: background-color 0.15s;

    &:hover {
      background: var(--hover-background-color);
    }

    &.danger {
      color: #f56565;

      &:hover {
        background: rgba(245, 101, 101, 0.1);
      }
    }

    .iconfont {
      font-size: 13px;
    }
  }

  .context-menu-divider {
    height: 1px;
    background: var(--border-color-1);
    margin: 4px 0;
  }
}

// 删除确认弹窗（全局样式）
.dialog-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  backdrop-filter: blur(2px);
}

.dialog-content {
  background: var(--background-color-1);
  border-radius: 8px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
  min-width: 360px;
  max-width: 440px;
  border: 1px solid var(--border-color-1);
}

.dialog-header {
  padding: 20px 24px 0;

  h3 {
    margin: 0;
    font-size: 16px;
    font-weight: 600;
    color: var(--text-color);
  }
}

.dialog-body {
  padding: 16px 24px;

  p {
    margin: 0;
    font-size: 13px;
    color: var(--text-color-2);
    line-height: 1.5;

    strong {
      color: var(--text-color-1);
    }
  }
}

.dialog-footer {
  padding: 0 24px 20px;
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}

.btn {
  padding: 7px 16px;
  border: none;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.btn-secondary {
  background: var(--background-color-2);
  color: var(--text-color-3);
  border: 1px solid var(--border-color-1);

  &:hover {
    background: var(--hover-background-color);
    color: var(--text-color-1);
  }
}

.btn-danger {
  background: #f56565;
  color: white;

  &:hover {
    background: #e53e3e;
  }
}

.dialog-fade-enter-active,
.dialog-fade-leave-active {
  transition: opacity 0.3s ease;

  .dialog-content {
    transition: transform 0.3s ease;
  }
}

.dialog-fade-enter-from,
.dialog-fade-leave-to {
  opacity: 0;

  .dialog-content {
    transform: translateY(-20px) scale(0.95);
  }
}
</style>
