import { app, BrowserWindow, ipcMain, shell, net } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";

import { createWriteStream } from "node:fs";

/**
 * 解析版本号字符串
 * 支持格式：
 * - v1.0.0
 * - 1.0.0
 * - Beta-v0.6.0-milkupcore
 * - v1.0.0-alpha.1
 * - 2.0.0-rc.1
 */
interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  prerelease: string | null;
  prereleaseNumber: number;
  build: string | null;
}

function parseVersion(version: string): ParsedVersion | null {
  try {
    // 移除前缀（如 Beta-v, v, Alpha-v 等）
    let cleaned = version.replace(/^(Beta-|Alpha-|RC-)?v?/i, "");

    // 分离构建元数据（如 -milkupcore）
    let build: string | null = null;
    const buildMatch = cleaned.match(/[-+]([a-zA-Z][a-zA-Z0-9-]*?)$/);
    if (buildMatch && !buildMatch[1].match(/^\d/)) {
      build = buildMatch[1];
      cleaned = cleaned.replace(/[-+][a-zA-Z][a-zA-Z0-9-]*?$/, "");
    }

    // 分离预发布版本（如 -alpha.1, -beta.2, -rc.1）
    let prerelease: string | null = null;
    let prereleaseNumber = 0;
    const prereleaseMatch = cleaned.match(/-(alpha|beta|rc)\.?(\d+)?$/i);
    if (prereleaseMatch) {
      prerelease = prereleaseMatch[1].toLowerCase();
      prereleaseNumber = prereleaseMatch[2] ? parseInt(prereleaseMatch[2], 10) : 0;
      cleaned = cleaned.replace(/-(alpha|beta|rc)\.?\d*$/i, "");
    }

    // 解析主版本号
    const parts = cleaned.split(".").map((p) => parseInt(p, 10));
    if (parts.length < 1 || parts.some(isNaN)) {
      console.warn(`[parseVersion] Invalid version format: ${version}`);
      return null;
    }

    return {
      major: parts[0] || 0,
      minor: parts[1] || 0,
      patch: parts[2] || 0,
      prerelease,
      prereleaseNumber,
      build,
    };
  } catch (error) {
    console.error(`[parseVersion] Failed to parse version: ${version}`, error);
    return null;
  }
}

/**
 * 比较两个版本号
 * @returns true 如果 latest > current
 */
function isNewerVersion(latest: string, current: string): boolean {
  console.log(`[isNewerVersion] Comparing: ${latest} vs ${current}`);

  const latestParsed = parseVersion(latest);
  const currentParsed = parseVersion(current);

  if (!latestParsed || !currentParsed) {
    console.warn("[isNewerVersion] Failed to parse versions, falling back to string comparison");
    return latest > current;
  }

  console.log("[isNewerVersion] Parsed latest:", latestParsed);
  console.log("[isNewerVersion] Parsed current:", currentParsed);

  // 比较主版本号
  if (latestParsed.major !== currentParsed.major) {
    return latestParsed.major > currentParsed.major;
  }

  // 比较次版本号
  if (latestParsed.minor !== currentParsed.minor) {
    return latestParsed.minor > currentParsed.minor;
  }

  // 比较修订号
  if (latestParsed.patch !== currentParsed.patch) {
    return latestParsed.patch > currentParsed.patch;
  }

  // 如果版本号相同，比较预发布版本
  // 规则：正式版 > rc > beta > alpha
  // 如果都是预发布版本，比较预发布号
  const prereleaseOrder: Record<string, number> = {
    alpha: 1,
    beta: 2,
    rc: 3,
  };

  const latestPrereleaseOrder = latestParsed.prerelease
    ? prereleaseOrder[latestParsed.prerelease] || 0
    : 999; // 正式版最大
  const currentPrereleaseOrder = currentParsed.prerelease
    ? prereleaseOrder[currentParsed.prerelease] || 0
    : 999;

  if (latestPrereleaseOrder !== currentPrereleaseOrder) {
    return latestPrereleaseOrder > currentPrereleaseOrder;
  }

  // 如果预发布类型相同，比较预发布号
  if (latestParsed.prerelease && currentParsed.prerelease) {
    return latestParsed.prereleaseNumber > currentParsed.prereleaseNumber;
  }

  // 版本完全相同
  return false;
}

// 获取当前平台的安装包后缀
function getPlatformExtension() {
  switch (process.platform) {
    case "win32":
      return ".exe";
    case "darwin":
      return ".dmg";
    case "linux":
      return ".AppImage";
    default:
      return null;
  }
}

let currentUpdateInfo: { url: string; filename: string; version: string; size?: number } | null =
  null;
let downloadedFilePath: string | null = null;
let downloadAbortController: AbortController | null = null;

export function setupUpdateHandlers(win: BrowserWindow) {
  // 1. 检查更新
  ipcMain.handle("update:check", async () => {
    try {
      console.log("[Main] Starting update check...");
      win.webContents.send("update:status", { status: "checking" });

      const api = "https://api.github.com/repos/auto-plugin/milkup/releases/latest";
      console.log("[Main] Fetching from GitHub API:", api);
      const response = await net.fetch(api);

      if (!response.ok) {
        console.error("[Main] GitHub API Error:", response.status, response.statusText);
        throw new Error(`GitHub API Error: ${response.status}`);
      }

      const data = await response.json();
      const latestVersion = data.tag_name;
      const currentVersion = app.getVersion();
      console.log("[Main] Latest version:", latestVersion, "Current version:", currentVersion);

      // 无论是否是新版本，都尝试寻找对应资源，方便调试（或者逻辑上只在新版本时找）
      const isNew = isNewerVersion(latestVersion, currentVersion);
      console.log("[Main] Is new version available:", isNew);

      if (isNew) {
        // 寻找对应平台的资源
        const ext = getPlatformExtension();
        if (!ext) {
          console.error("[Main] Unsupported platform:", process.platform);
          throw new Error("Unsupported platform");
        }

        let asset: any = null;

        if (process.platform === "win32") {
          // Windows: 优先匹配包含 Setup 且对应后缀的文件
          asset = data.assets.find((a: any) => a.name.endsWith(ext) && a.name.includes("Setup"));
          if (!asset) {
            asset = data.assets.find((a: any) => a.name.endsWith(ext));
          }
        } else if (process.platform === "darwin") {
          // macOS: 区分 arm64 和 x64
          const arch = process.arch; // 'arm64' or 'x64'

          // 1. 优先寻找包含当前架构名称的包 (如 milkup-1.0.0-arm64.dmg)
          asset = data.assets.find((a: any) => a.name.endsWith(ext) && a.name.includes(arch));

          if (!asset) {
            // 2. 如果当前是 arm64，尝试寻找 universal (不含 arm64 也不含 x64, 或者含 universal)
            //    或者实在找不到，允许回退到 x64 (Rosetta 转译)
            if (arch === "arm64") {
              asset =
                data.assets.find((a: any) => a.name.endsWith(ext) && !a.name.includes("x64")) ||
                data.assets.find((a: any) => a.name.endsWith(ext)); // Fallback to any dmg (likely x64)
            } else {
              // 3. 如果当前是 x64，坚决不能用 arm64
              asset = data.assets.find(
                (a: any) => a.name.endsWith(ext) && !a.name.includes("arm64")
              );
            }
          }
        } else {
          // Linux / Others
          asset = data.assets.find((a: any) => a.name.endsWith(ext));
        }

        if (asset) {
          console.log("[Main] Found asset:", asset.name);
          const updateInfo = {
            version: latestVersion,
            notes: data.body,
            date: data.published_at,
            url: asset.browser_download_url,
            filename: asset.name,
            size: asset.size,
            // GitHub API usually provides html_url for the release page
            releasePageUrl: data.html_url,
          };

          currentUpdateInfo = updateInfo; // 缓存 update info 供下载使用

          win.webContents.send("update:status", { status: "available", info: updateInfo });
          console.log("[Main] Update available, returning info");
          return { updateInfo };
        } else {
          console.warn("[Main] No suitable asset found for platform:", process.platform);
          win.webContents.send("update:status", {
            status: "not-available",
            info: { reason: "no-asset" },
          });
          return null;
        }
      } else {
        console.log("[Main] Already on latest version");
        win.webContents.send("update:status", { status: "not-available" });
        return null;
      }
    } catch (error: any) {
      console.error("[Main] Check update failed:", error);
      win.webContents.send("update:status", { status: "error", error: error.message });
      throw error;
    }
  });

  // 2. 下载更新
  ipcMain.handle("update:download", async () => {
    if (!currentUpdateInfo) {
      throw new Error("No update check info found");
    }

    // 如果已经在下载中，先取消之前的
    if (downloadAbortController) {
      downloadAbortController.abort();
    }
    downloadAbortController = new AbortController();

    const { url, filename } = currentUpdateInfo;

    try {
      if (!currentUpdateInfo) throw new Error("No update check info found");

      const userDataPath = app.getPath("userData");
      const updateDir = path.join(userDataPath, "updates");
      if (!fs.existsSync(updateDir)) {
        fs.mkdirSync(updateDir, { recursive: true });
      }

      downloadedFilePath = path.join(updateDir, filename);

      const expectedSize = currentUpdateInfo.size || 0;
      let startByte = 0;
      let openFlags = "w";
      let headers: Record<string, string> = {};

      // Check if we can resume or skip
      if (fs.existsSync(downloadedFilePath)) {
        const stats = fs.statSync(downloadedFilePath);
        const currentSize = stats.size;

        if (expectedSize > 0 && currentSize === expectedSize) {
          // Exact match, assume already downloaded
          // Note: Could verify hash if available, but size match is decent optimization
          win.webContents.send("update:status", { status: "downloaded", info: currentUpdateInfo });
          win.webContents.send("update:download-progress", {
            percent: 100,
            total: expectedSize,
            transferred: expectedSize,
          });
          return downloadedFilePath;
        }

        if (expectedSize > 0 && currentSize < expectedSize) {
          // Partial file, try to resume
          startByte = currentSize;
          openFlags = "a";
          headers["Range"] = `bytes=${startByte}-`;
          console.log(`[Main] Resuming download from byte ${startByte}`);
        } else {
          // Larger than expected or unknown state, restart
          // fs.unlinkSync(downloadedFilePath) // open with 'w' will truncate it anyway
          console.log("[Main] Existing file size mismatch, restarting download");
        }
      }

      const response = await net.fetch(url, {
        signal: downloadAbortController.signal,
        headers: headers,
      });

      if (!response.ok) {
        // If range not satisfiable (e.g. file changed on server), might return 416
        if (response.status === 416) {
          // Fallback to full download
          // But we need to make a new request without range...
          // Simplest approach: just throw for now or retry logic (omitting complexity for this step)
          throw new Error(`Download failed with status ${response.status} (Range unsatisfied?)`);
        }
        throw new Error(`Download failed: ${response.statusText}`);
      }

      if (!response.body) throw new Error("Response body is null");

      // Check if server accepted range
      if (startByte > 0 && response.status === 200) {
        // Server ignored Range header, full content sent
        startByte = 0;
        openFlags = "w";
        console.log("[Main] Server ignored Range header, restarting download");
      }

      const totalBytes = Number(response.headers.get("content-length") || 0) + startByte;
      let downloadedBytes = startByte;

      // Note: fs.createWriteStream 'flags' option
      const fileStream = createWriteStream(downloadedFilePath, { flags: openFlags });
      const reader = response.body.getReader();

      const abortHandler = () => {
        reader.cancel();
        fileStream.destroy();
        // Do NOT delete file on abort, so we can resume later
      };
      downloadAbortController.signal.addEventListener("abort", abortHandler);

      try {
        await new Promise<void>(async (resolve, reject) => {
          fileStream.on("error", reject);
          fileStream.on("finish", resolve);

          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;

              downloadedBytes += value.length;
              const canWrite = fileStream.write(value);
              if (!canWrite) {
                await new Promise<void>((r) => fileStream.once("drain", () => r()));
              }

              // Send progress
              if (totalBytes > 0) {
                const percent = (downloadedBytes / totalBytes) * 100;
                // Throttle progress updates to avoid IPC flooding?
                // For now just send every chunk or maybe every 1%?
                // Let's keep it simple as before, but maybe check if % changed significantly if needed.
                // Existing logic sent every chunk.
                win.webContents.send("update:download-progress", {
                  percent,
                  total: totalBytes,
                  transferred: downloadedBytes,
                });
              }
            }
            fileStream.end();
          } catch (err) {
            reject(err);
          }
        });
      } finally {
        downloadAbortController.signal.removeEventListener("abort", abortHandler);
      }

      downloadAbortController = null;

      win.webContents.send("update:status", { status: "downloaded", info: currentUpdateInfo });

      return downloadedFilePath;
    } catch (error: any) {
      if (error.name === "AbortError") {
        console.log("[Main] Download aborted by user");
        win.webContents.send("update:status", { status: "idle" });
        return;
      }
      console.error("[Main] Download error:", error);
      win.webContents.send("update:status", { status: "error", error: error.message });
      downloadAbortController = null;

      // On error, we generally keep the partial file for resume, UNLESS it's a critical write error?
      // Default: keep it.
      throw error;
    }
  });

  // 4. 取消下载
  ipcMain.handle("update:cancel", () => {
    console.log("[Main] Cancelling download...");
    if (downloadAbortController) {
      downloadAbortController.abort();
      downloadAbortController = null;
      console.log("[Main] Download cancelled, status will be updated by download handler");
      // 不在这里发送状态更新，让下载函数的 catch 块处理
      // 这样可以避免重复发送事件
    } else {
      console.log("[Main] No active download to cancel");
      // 如果没有活动的下载，确保状态是 idle
      win.webContents.send("update:status", { status: "idle" });
    }
  });

  // 3. 退出并安装
  ipcMain.handle("update:install", () => {
    if (!downloadedFilePath || !fs.existsSync(downloadedFilePath)) {
      console.error("[Main] Installer not found");
      return;
    }

    // 打开安装包
    shell.openPath(downloadedFilePath).then(() => {
      // 稍等片刻让安装程序启动，然后退出当前应用
      setTimeout(() => {
        app.quit();
      }, 1000);
    });
  });
}
