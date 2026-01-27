// 使用 electron-updater 的 IPC 接口
export async function checkUpdate() {
  const result = await window.electronAPI.checkForUpdates();
  // result.updateInfo 包含版本信息
  if (result && result.updateInfo) {
    return {
      version: result.updateInfo.version,
      url: result.updateInfo.url, // 自定义下载逻辑需要 URL（或者主进程自己管理，但这里回传也没事）
      notes: result.updateInfo.notes || "",
      releasePageUrl: result.updateInfo.releasePageUrl || "",
      date: result.updateInfo.date,
    };
  }
  return null;
}

export async function downloadUpdate() {
  return await window.electronAPI.downloadUpdate();
}

export async function cancelUpdate() {
  return await window.electronAPI.cancelUpdate();
}

export async function quitAndInstall() {
  return await window.electronAPI.quitAndInstall();
}
