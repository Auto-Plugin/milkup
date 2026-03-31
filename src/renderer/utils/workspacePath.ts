import { isWindows } from "./platform";

export function isAbsoluteLocalPath(pathValue: string): boolean {
  if (!pathValue) return false;

  if (isWindows) {
    return /^[a-zA-Z]:[\\/]/.test(pathValue);
  }

  return pathValue.startsWith("/");
}

export function isRemoteWorkspacePath(pathValue: string): boolean {
  if (!pathValue || !isWindows) return false;

  return /^\\\\wsl(?:\$|\.localhost)\\/i.test(pathValue) || /^\\\\(?![?.]\\)/.test(pathValue);
}

export function shouldAutoLoadWorkspace(pathValue: string): boolean {
  return Boolean(pathValue) && !isRemoteWorkspacePath(pathValue);
}
