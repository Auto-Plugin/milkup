import autotoast from "autotoast.js";
import { onMounted, ref } from "vue";

export type UpdateStatus = "idle" | "downloading" | "downloaded" | "error";

export function useUpdateDialog() {
  const isDialogVisible = ref(false);
  const updateStatus = ref<UpdateStatus>("idle");
  const downloadProgress = ref(0);

  function showDialog() {
    isDialogVisible.value = true;
  }
  function hideDialog() {
    isDialogVisible.value = false;
  }

  async function handleCancel() {
    if (updateStatus.value === "downloading") {
      console.log("[UpdateDialog] Cancelling download...");
      try {
        await window.electronAPI.cancelUpdate();
        console.log("[UpdateDialog] Download cancelled successfully");
        // 等待状态更新事件
        // 使用 Promise 等待状态变为 idle
        await new Promise<void>((resolve) => {
          const checkStatus = () => {
            if (updateStatus.value === "idle") {
              console.log("[UpdateDialog] Status confirmed as idle");
              resolve();
            } else {
              setTimeout(checkStatus, 50);
            }
          };
          checkStatus();
          // 设置超时，最多等待 2 秒
          setTimeout(() => {
            console.warn("[UpdateDialog] Timeout waiting for status update, forcing close");
            resolve();
          }, 2000);
        });
        autotoast.show("下载已取消", "info");
      } catch (error) {
        console.error("[UpdateDialog] Cancel failed:", error);
        autotoast.show("取消下载失败", "error");
      }
    }
    hideDialog();
  }
  function handleIgnore() {
    const updateInfo = JSON.parse(localStorage.getItem("updateInfo") || "{}");
    const version = updateInfo.version || "";
    hideDialog();
    localStorage.setItem("ignoredVersion", version);
  }

  // 开始更新（下载）
  async function handleUpdate() {
    updateStatus.value = "downloading";
    try {
      await window.electronAPI.downloadUpdate();
    } catch (error) {
      console.error("Download failed:", error);
      autotoast.show("下载失败", "error");
      updateStatus.value = "error";
    }
  }

  // 安装并重启
  function handleInstall() {
    window.electronAPI.quitAndInstall();
  }

  function handleLater() {
    hideDialog();
  }

  function handleMinimize() {
    // Just hide dialog but keep status
    isDialogVisible.value = false;
  }

  function handleRestore() {
    isDialogVisible.value = true;
  }

  // 监听下载进度
  const onProgress = (progressObj: any) => {
    // progressObj 格式: percent, total, transferred
    if (progressObj && progressObj.percent) {
      downloadProgress.value = Math.floor(progressObj.percent);
    }
  };

  const onUpdateStatus = (statusObj: any) => {
    console.log("[UpdateDialog] Status update:", statusObj);
    if (statusObj.status === "downloaded") {
      updateStatus.value = "downloaded";
    } else if (statusObj.status === "error") {
      updateStatus.value = "error";
      autotoast.show(`更新出错: ${statusObj.error}`, "error");
    } else if (statusObj.status === "idle") {
      updateStatus.value = "idle";
      downloadProgress.value = 0;
      console.log("[UpdateDialog] Status reset to idle, progress reset to 0");
    }
  };

  onMounted(() => {
    window.electronAPI.onDownloadProgress(onProgress);
    window.electronAPI.onUpdateStatus(onUpdateStatus);
  });

  // ... (remove onUnmounted block if needed or keep)

  return {
    isDialogVisible,
    updateStatus,
    downloadProgress,
    showDialog,
    hideDialog,
    handleIgnore,
    handleUpdate,
    handleInstall,
    handleLater,
    handleMinimize,
    handleRestore,
    handleCancel,
  };
}
