import { isWindows } from "./platform";

export function isAbsoluteLocalPath(pathValue: string): boolean {
  if (!pathValue) return false;

  if (isWindows) {
    return /^[a-zA-Z]:[\\/]/.test(pathValue);
  }

  return pathValue.startsWith("/");
}

// 注意：本模块在渲染进程执行（nodeIntegration:false），渲染进程里 process.platform 不可用，
// platform.ts 的 isWindows 会恒为 false。因此这里【不能】用 isWindows 做前置短路，否则本防护
// 会永远失效——曾导致打开 WSL 文件时仍自动加载工作区，进而对 \\wsl.localhost\ 下的 Linux 软链接
// （如 librockchip_mpp.so.0）lstat 触发 EISDIR，使主进程未捕获异常崩溃。
// UNC 路径（\\wsl.localhost\、\\wsl$\、\\server\share）本身是 Windows 专有写法，不会出现在其他
// 平台的合法路径里，无需平台判断即可安全识别为远程路径。
export function isRemoteWorkspacePath(pathValue: string): boolean {
  if (!pathValue) return false;

  return /^\\\\wsl(?:\$|\.localhost)\\/i.test(pathValue) || /^\\\\(?![?.]\\)/.test(pathValue);
}

// 第二层（layer2）：§0-A 实测证明 WSL/远程目录建树路径安全（readdir d_type 分类 + 真实
// dir/file stat 正常，不再 EISDIR），故撤销第一层的"远程跳过"——远程也自动加载文件树。
// 监听方式（本地/SMB 走 chokidar、WSL 走轮询）由 main 进程按路径分流，见 src/main/wslWatch.ts。
// isRemoteWorkspacePath 保留作远程路径判定工具（仍可被其他逻辑复用）。
export function shouldAutoLoadWorkspace(pathValue: string): boolean {
  return Boolean(pathValue);
}
