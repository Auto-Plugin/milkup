import toast from "autotoast.js";
import { computed, onUnmounted, ref, watch } from "vue";
import { useConfig } from "./useConfig";
import useTab from "./useTab";

const { tabs, currentTab } = useTab();
const { config, setConf } = useConfig();

let isLoadWorkSpace = false; // 是否已经加载文件目录 标识
const isLoading = ref(false); // 文件目录加载中

interface WorkSpace {
  name: string;
  path: string;
  isDirectory: boolean;
  mtime?: number;
  children?: WorkSpace[];
}

const workSpace = ref<WorkSpace[] | null>(null);
const watchedDirPath = ref<string | null>(null);

// 搜索
const searchQuery = ref("");

// 编辑状态
const editingNode = ref<{ path: string; isNew: boolean } | null>(null);

// 排序方式
const sortBy = computed(() => config.value.workspace?.sortBy ?? "name");

function toggleSort() {
  const next = sortBy.value === "name" ? "mtime" : "name";
  setConf("workspace", { sortBy: next });
}

// 排序函数
function sortNodes(nodes: WorkSpace[]): WorkSpace[] {
  const dirs = nodes.filter((n) => n.isDirectory);
  const files = nodes.filter((n) => !n.isDirectory);

  const sorter = (a: WorkSpace, b: WorkSpace) => {
    if (sortBy.value === "mtime") {
      return (b.mtime ?? 0) - (a.mtime ?? 0); // 最新在前
    }
    return a.name.localeCompare(b.name);
  };

  dirs.sort(sorter);
  files.sort(sorter);

  // 递归排序子节点
  for (const dir of dirs) {
    if (dir.children) {
      dir.children = sortNodes(dir.children);
    }
  }

  return [...dirs, ...files];
}

// 搜索过滤函数
function filterNodes(nodes: WorkSpace[], query: string): WorkSpace[] {
  if (!query) return nodes;
  const lower = query.toLowerCase();
  return nodes.filter((node) => {
    if (node.isDirectory) return true; // 目录始终显示
    return node.name.toLowerCase().includes(lower);
  });
}

// 处理后的节点（排序 + 搜索）
const processedWorkSpace = computed(() => {
  if (!workSpace.value) return null;
  let result = sortNodes([...workSpace.value]);
  result = filterNodes(result, searchQuery.value);
  return result;
});

// 获取文件夹
async function getWorkSpace() {
  if (isLoadWorkSpace) return;
  if (isLoading.value) return;

  // 是否有真实path得文件
  const realFile = tabs.value.find((tab) => tab.filePath);

  if (!realFile || !realFile.filePath) return;

  // 获取文件所在的目录路径
  const directoryPath = realFile.filePath.replace(/[^/\\]+$/, "");

  try {
    isLoading.value = true;

    const result = await window.electronAPI.getDirectoryFiles(directoryPath);

    if (!result) return;
    if (!result.length) return;

    // 已加载
    isLoadWorkSpace = true;
    // 更新文件夹信息
    workSpace.value = result;
    // 开始监听目录
    startWatching(directoryPath);
  } catch {
    toast.show("获取目录文件失败:", "error");
  } finally {
    isLoading.value = false;
  }
}

// 打开选择文件夹对话框
async function openWorkSpaceByPath(selectedPath: string) {
  try {
    if (!selectedPath) return false;

    isLoadWorkSpace = false;
    workSpace.value = null;

    const directoryFiles = await window.electronAPI.getDirectoryFiles(selectedPath);

    if (!directoryFiles) return false;

    workSpace.value = directoryFiles;
    isLoadWorkSpace = true;
    startWatching(selectedPath);
    return true;
  } catch {
    return false;
  }
}

async function setWorkSpace() {
  try {
    const result = await window.electronAPI.showOpenDialog({
      properties: ["openDirectory"],
      title: "选择文件夹",
    });

    if (result && !result.canceled && result.filePaths.length > 0) {
      const selectedPath = result.filePaths[0];
      await openWorkSpaceByPath(selectedPath);
    }
  } catch {
    toast.show("获取目录文件失败:", "error");
  }
}

// 开始监听目录
function startWatching(dirPath: string) {
  if (watchedDirPath.value) {
    window.electronAPI.unwatchDirectory();
  }
  watchedDirPath.value = dirPath;
  window.electronAPI.watchDirectory(dirPath);
}

// 停止监听
function stopWatching() {
  if (watchedDirPath.value) {
    window.electronAPI.unwatchDirectory();
    watchedDirPath.value = null;
  }
}

// 刷新文件列表
async function refreshWorkSpace() {
  if (!watchedDirPath.value) return;
  try {
    const result = await window.electronAPI.getDirectoryFiles(watchedDirPath.value);
    if (result) {
      workSpace.value = result;
    }
  } catch {
    // 静默失败
  }
}

// 手动刷新：先清空列表再重新加载，让用户感知到刷新
async function hardRefreshWorkSpace() {
  if (!watchedDirPath.value) return;
  workSpace.value = null;
  try {
    const result = await window.electronAPI.getDirectoryFiles(watchedDirPath.value);
    if (result) {
      workSpace.value = result;
    }
  } catch {
    // 静默失败
  }
}

// 监听目录变化
const onDirectoryChanged = () => {
  refreshWorkSpace();
};
window.electronAPI.on?.("workspace:directory-changed", onDirectoryChanged);

// 文件操作
async function createFile(targetDirPath: string): Promise<string | null> {
  // 生成不冲突的文件名
  let fileName = "Untitled.md";
  let counter = 1;
  const existingNames = new Set<string>();

  // 收集目标目录下的文件名
  function collectNames(nodes: WorkSpace[], dirPath: string) {
    for (const node of nodes) {
      const nodeDir = node.path.replace(/[^/\\]+$/, "").replace(/[/\\]$/, "");
      const targetDir = dirPath.replace(/[/\\]$/, "");
      if (nodeDir === targetDir) {
        existingNames.add(node.name);
      }
      if (node.children) {
        collectNames(node.children, dirPath);
      }
    }
  }
  if (workSpace.value) {
    collectNames(workSpace.value, targetDirPath);
  }

  while (existingNames.has(fileName)) {
    fileName = `Untitled ${counter}.md`;
    counter++;
  }

  const filePath = await window.electronAPI.createFile(targetDirPath, fileName);
  if (filePath) {
    // 等待目录监听刷新
    await refreshWorkSpace();
    // 进入编辑状态
    editingNode.value = { path: filePath, isNew: true };
  }
  return filePath;
}

async function createFolder(targetDirPath: string): Promise<string | null> {
  // 生成不冲突的文件夹名
  let folderName = "新建文件夹";
  let counter = 1;
  const existingNames = new Set<string>();

  // 收集目标目录下的名称
  function collectNames(nodes: WorkSpace[], dirPath: string) {
    for (const node of nodes) {
      const nodeDir = node.path.replace(/[^/\\]+$/, "").replace(/[/\\]$/, "");
      const targetDir = dirPath.replace(/[/\\]$/, "");
      if (nodeDir === targetDir) {
        existingNames.add(node.name);
      }
      if (node.children) {
        collectNames(node.children, dirPath);
      }
    }
  }
  if (workSpace.value) {
    collectNames(workSpace.value, targetDirPath);
  }

  while (existingNames.has(folderName)) {
    folderName = `新建文件夹 ${counter}`;
    counter++;
  }

  const folderPath = await window.electronAPI.createFolder(targetDirPath, folderName);
  if (folderPath) {
    await refreshWorkSpace();
    // 进入编辑状态（重命名）
    editingNode.value = { path: folderPath, isNew: true };
  }
  return folderPath;
}

async function deleteFile(filePath: string): Promise<boolean> {
  const result = await window.electronAPI.deleteFile(filePath);
  if (result) {
    await refreshWorkSpace();
  }
  return result;
}

async function renameFile(oldPath: string, newName: string): Promise<string | null> {
  const newPath = await window.electronAPI.renameFile(oldPath, newName);
  if (newPath) {
    // 更新打开的 tab
    const { tabs: allTabs } = useTab();
    for (const tab of allTabs.value) {
      if (tab.filePath === oldPath) {
        tab.filePath = newPath;
        tab.name = newName;
        break;
      }
    }
    await refreshWorkSpace();
  }
  return newPath;
}

// 监听tabs
watch(
  () => tabs.value,
  (newTabs) => {
    // 只有在从无到有时才重新加载文件夹
    const hasRealFile = newTabs.some((tab) => tab.filePath);
    if (hasRealFile && !isLoadWorkSpace) {
      getWorkSpace();
    }
  },
  {
    deep: true,
  }
);

// 监听当前选中得tab
watch(
  () => currentTab.value,
  () => {}
);

// 组件销毁时停止监听
onUnmounted(() => {
  stopWatching();
  window.electronAPI.removeListener?.("workspace:directory-changed", onDirectoryChanged);
});

function useWorkSpace() {
  return {
    workSpace: processedWorkSpace,
    rawWorkSpace: workSpace,
    setWorkSpace,
    searchQuery,
    sortBy,
    toggleSort,
    editingNode,
    createFile,
    createFolder,
    deleteFile,
    renameFile,
    refreshWorkSpace,
    hardRefreshWorkSpace,
    openWorkSpaceByPath,
    watchedDirPath,
  };
}

export default useWorkSpace;
