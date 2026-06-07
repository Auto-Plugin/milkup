// wslWatch.ts
// WSL/远程文件监听第二层：路径分流 + WSL 9P 轮询路线。
// 设计约束：本模块【不依赖 electron】，所有外部副作用(广播/窗口)由回调注入，便于 node:test 单测。
// 依据 docs/spec-wsl-file-watching-layer2.md，§0 前置实测已 PASS（2026-06-06）。
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import path from "node:path";

// ============================================================
// 纯函数（§4.0 路径判定 / 快照）
// ============================================================

/**
 * 归一化路径前缀：
 *  - `\\?\UNC\server\share\..` -> `\\server\share\..`
 *  - `\\?\C:\..`               -> `C:\..`
 * 否则原样返回。防止 `\\?\UNC\wsl.localhost\` 被误判为本地而重开 EISDIR（§4.0）。
 */
export function normalizeWatchPath(p: string): string {
  if (!p) return p;
  if (/^\\\\\?\\UNC\\/i.test(p)) return "\\\\" + p.slice(8); // 去掉 `\\?\UNC\`(8 字符)
  if (/^\\\\\?\\[a-zA-Z]:\\/.test(p)) return p.slice(4); // 去掉 `\\?\`(4 字符)
  return p;
}

export type WatchKind = "wsl" | "chokidar";

/**
 * 仅 `\\wsl.localhost\` / `\\wsl$\` 归一化后判为 "wsl"（走轮询）；
 * 其余（本地盘符、SMB `\\server\share`、`Z:\` 映射、posix）一律 "chokidar"。
 */
export function classifyWatchTarget(p: string): WatchKind {
  const n = normalizeWatchPath(p || "");
  return /^\\\\wsl(?:\$|\.localhost)\\/i.test(n) ? "wsl" : "chokidar";
}

/** 把混合路径列表按来源分流，保证不重叠、无遗漏（§4.2 partition）。 */
export function partitionPaths(paths: string[]): { wsl: string[]; chokidar: string[] } {
  const wsl: string[] = [];
  const chokidar: string[] = [];
  for (const p of paths) {
    if (classifyWatchTarget(p) === "wsl") wsl.push(p);
    else chokidar.push(p);
  }
  return { wsl, chokidar };
}

/** 快照单元值：mtime 取整(避免浮点抖动) + size（§4.1 快照键 path+mtime+size）。 */
export function snapshotEntry(mtimeMs: number, size: number): string {
  return `${Math.trunc(mtimeMs)}:${size}`;
}

/** 两个快照(Map<path, "mtime:size">)是否有差异。 */
export function snapshotChanged(prev: Map<string, string>, curr: Map<string, string>): boolean {
  if (prev.size !== curr.size) return true;
  for (const [k, v] of curr) {
    if (prev.get(k) !== v) return true;
  }
  return false;
}

// ============================================================
// 目录遍历（树构建 + 快照），与 chokidar 路径共用同一截断常量（§4.1 截断一致性）
// ============================================================

export const MAX_DEPTH = 10;
export const MAX_FILES_PER_DIR = 100;

const IGNORE_PATTERNS = [
  /^\.git$/,
  /^\.vscode$/,
  /^\.idea$/,
  /^node_modules$/,
  /^\.next$/,
  /^\.nuxt$/,
  /^dist$/,
  /^build$/,
  /^coverage$/,
  /^\.DS_Store$/,
  /^Thumbs\.db$/,
];

export function shouldIgnoreDirectory(name: string): boolean {
  return IGNORE_PATTERNS.some((p) => p.test(name));
}

export function isSupportedWorkspaceFile(name: string): boolean {
  return /\.(?:md|markdown|png|jpe?g|gif|webp|svg|bmp)$/i.test(name);
}

export interface WorkspaceNode {
  name: string;
  path: string;
  isDirectory: boolean;
  isSymlink?: boolean;
  mtime: number;
  children?: WorkspaceNode[];
}

async function getMtimeMsSafe(p: string): Promise<number> {
  try {
    return (await fsp.stat(p)).mtimeMs;
  } catch {
    return 0;
  }
}

/**
 * 构建文件树（替代原 ipcBridge 内联 scanDirectory）。
 * symlink 处理按来源分流（§4.3，依 §0-A 实测缩范围）：
 *  - 本地 / SMB：symlink 可 stat，受支持扩展名的 symlink 作为 inert 文件节点进树并标记；
 *  - WSL 远程：symlink 从 Windows 侧读不透(lstat/stat 皆失败) → 丢弃，不进树。
 * 不解引用递归（避免环；WSL 下更是平台强制 stat ENOENT）。
 */
export async function scanDirectory(
  dirPath: string,
  opts: { isWslRemote: boolean },
  depth = 0
): Promise<WorkspaceNode[]> {
  if (depth > MAX_DEPTH) return [];

  let items: fs.Dirent[];
  try {
    items = await fsp.readdir(dirPath, { withFileTypes: true });
  } catch {
    return [];
  }

  if (items.length > MAX_FILES_PER_DIR) items.splice(MAX_FILES_PER_DIR);

  const directories: WorkspaceNode[] = [];
  const files: WorkspaceNode[] = [];

  for (const item of items) {
    const itemPath = path.join(dirPath, item.name);

    if (item.isSymbolicLink()) {
      // WSL：读不透，丢弃。本地/SMB：仅支持的扩展名作为 inert 节点进树。
      if (opts.isWslRemote) continue;
      if (!isSupportedWorkspaceFile(item.name)) continue;
      const mtime = await getMtimeMsSafe(itemPath);
      files.push({ name: item.name, path: itemPath, isDirectory: false, isSymlink: true, mtime });
      continue;
    }

    if (item.isDirectory()) {
      if (shouldIgnoreDirectory(item.name)) continue;
      const children = await scanDirectory(itemPath, opts, depth + 1);
      const mtime = await getMtimeMsSafe(itemPath);
      directories.push({ name: item.name, path: itemPath, isDirectory: true, mtime, children });
    } else if (item.isFile() && isSupportedWorkspaceFile(item.name)) {
      const mtime = await getMtimeMsSafe(itemPath);
      files.push({ name: item.name, path: itemPath, isDirectory: false, mtime });
    }
  }

  directories.sort((a, b) => a.name.localeCompare(b.name));
  files.sort((a, b) => a.name.localeCompare(b.name));
  return [...directories, ...files];
}

/** 目录快照（用于变更检测）：path -> "mtime:size"。symlink 跳过（WSL 读不透）。 */
export async function snapshotDirectory(dirPath: string): Promise<Map<string, string>> {
  const snap = new Map<string, string>();

  async function walk(cur: string, depth: number): Promise<void> {
    if (depth > MAX_DEPTH) return;
    let items: fs.Dirent[];
    try {
      items = await fsp.readdir(cur, { withFileTypes: true });
    } catch {
      return;
    }
    if (items.length > MAX_FILES_PER_DIR) items.splice(MAX_FILES_PER_DIR);
    for (const it of items) {
      if (it.isSymbolicLink()) continue;
      const ip = path.join(cur, it.name);
      if (it.isDirectory()) {
        if (shouldIgnoreDirectory(it.name)) continue;
        try {
          const st = await fsp.stat(ip);
          snap.set(ip, snapshotEntry(st.mtimeMs, st.size));
        } catch {
          /* 跳过 */
        }
        await walk(ip, depth + 1);
      } else if (it.isFile() && isSupportedWorkspaceFile(it.name)) {
        try {
          const st = await fsp.stat(ip);
          snap.set(ip, snapshotEntry(st.mtimeMs, st.size));
        } catch {
          /* 跳过 */
        }
      }
    }
  }

  await walk(dirPath, 0);
  return snap;
}

// ============================================================
// WSL 目录轮询（§4.1）
// ============================================================

export interface WslDirWatcherOptions {
  intervalMs?: number; // 远程文件树轮询间隔，默认 4000（§5）
  debounceMs?: number; // 广播去抖，默认 300（对齐本地）
  snapshot?: (dirPath: string) => Promise<Map<string, string>>;
  exists?: (dirPath: string) => boolean | Promise<boolean>; // 可达性判别
  onChanged: () => void; // 广播 workspace:directory-changed（已内部去抖）
}

interface DirState {
  timer: ReturnType<typeof setInterval> | null;
  epoch: number;
  inFlight: boolean;
  snapshot: Map<string, string> | null;
  debounceTimer: ReturnType<typeof setTimeout> | null;
}

export class WslDirectoryWatcher {
  private dirs = new Map<string, DirState>();
  private intervalMs: number;
  private debounceMs: number;
  private snapshotFn: (dirPath: string) => Promise<Map<string, string>>;
  private existsFn: (dirPath: string) => boolean | Promise<boolean>;
  private onChanged: () => void;

  constructor(opts: WslDirWatcherOptions) {
    this.intervalMs = opts.intervalMs ?? 4000;
    this.debounceMs = opts.debounceMs ?? 300;
    this.snapshotFn = opts.snapshot ?? snapshotDirectory;
    this.existsFn =
      opts.exists ??
      (async (p: string) => {
        try {
          await fsp.access(p);
          return true;
        } catch {
          return false;
        }
      });
    this.onChanged = opts.onChanged;
  }

  /** 监听某 WSL 目录。入口先自清旧 interval（对称 chokidar close），再建新的并立即建立基线快照。 */
  watch(dirPath: string): void {
    this.unwatch(dirPath);
    const state: DirState = {
      timer: null,
      epoch: 0,
      inFlight: false,
      snapshot: null,
      debounceTimer: null,
    };
    this.dirs.set(dirPath, state);
    state.timer = setInterval(() => void this.tick(dirPath), this.intervalMs);
    void this.tick(dirPath, true); // 基线：建立首个快照，不广播
  }

  private async tick(dirPath: string, baseline = false): Promise<void> {
    const state = this.dirs.get(dirPath);
    if (!state) return;
    if (state.inFlight) return; // in-flight guard：上一轮未完跳过本轮
    state.inFlight = true;
    const epoch = state.epoch;
    try {
      const reachable = await this.existsFn(dirPath);
      let curr: Map<string, string>;
      try {
        curr = await this.snapshotFn(dirPath);
      } catch {
        return; // 扫描整体失败：保持旧快照，不广播
      }
      // 迟到结果丢弃：unwatch/重建后此 state 已失效
      if (this.dirs.get(dirPath) !== state || epoch !== state.epoch) return;
      // 不可达判别：上次快照非空 + 现在不可达且扫不到东西 -> 保持快照，不广播全删（§4.1）
      if (!reachable && state.snapshot && state.snapshot.size > 0 && curr.size === 0) return;
      const prev = state.snapshot;
      state.snapshot = curr;
      if (!baseline && prev && snapshotChanged(prev, curr)) {
        this.scheduleBroadcast(state);
      }
    } finally {
      state.inFlight = false;
    }
  }

  private scheduleBroadcast(state: DirState): void {
    if (state.debounceTimer) clearTimeout(state.debounceTimer);
    state.debounceTimer = setTimeout(() => {
      state.debounceTimer = null;
      this.onChanged();
    }, this.debounceMs);
  }

  unwatch(dirPath: string): void {
    const state = this.dirs.get(dirPath);
    if (!state) return;
    state.epoch++; // 作废可能在途的迟到回调
    if (state.timer) clearInterval(state.timer);
    if (state.debounceTimer) clearTimeout(state.debounceTimer);
    this.dirs.delete(dirPath);
  }

  unwatchAll(): void {
    // 遍历时删除当前 key 在 JS Map 上是安全的（已访问/当前项删除不影响后续）
    for (const k of this.dirs.keys()) this.unwatch(k);
  }

  get size(): number {
    return this.dirs.size;
  }
}

// ============================================================
// WSL 已打开文件监听（§4.2 / §4.4）
// ============================================================

type StatLite = { mtimeMs: number; size: number };

export interface WslFileWatcherOptions {
  intervalMs?: number; // 单文件 mtime 轮询间隔，默认 1500（§5）
  onChanged: (filePath: string) => void; // 广播 file:changed
  watchFile?: (
    file: string,
    opts: { interval: number },
    cb: (curr: fs.Stats, prev: fs.Stats) => void
  ) => void;
  unwatchFile?: (file: string, cb: (curr: fs.Stats, prev: fs.Stats) => void) => void;
  stat?: (file: string) => Promise<StatLite | null>;
}

interface FileEntry {
  cb: (curr: fs.Stats, prev: fs.Stats) => void;
  last: string; // 上次已知 "mtime:size"
}

export class WslFileWatcher {
  private byWindow = new Map<number, Set<string>>();
  private watching = new Map<string, FileEntry>();
  private intervalMs: number;
  private onChanged: (filePath: string) => void;
  private watchFileFn: NonNullable<WslFileWatcherOptions["watchFile"]>;
  private unwatchFileFn: NonNullable<WslFileWatcherOptions["unwatchFile"]>;
  private statFn: NonNullable<WslFileWatcherOptions["stat"]>;

  constructor(opts: WslFileWatcherOptions) {
    this.intervalMs = opts.intervalMs ?? 1500;
    this.onChanged = opts.onChanged;
    this.watchFileFn = opts.watchFile ?? ((f, o, cb) => fs.watchFile(f, o, cb));
    this.unwatchFileFn = opts.unwatchFile ?? ((f, cb) => fs.unwatchFile(f, cb));
    this.statFn =
      opts.stat ??
      (async (f: string) => {
        try {
          const st = await fsp.stat(f);
          return { mtimeMs: st.mtimeMs, size: st.size };
        } catch {
          return null;
        }
      });
  }

  /** 某窗口当前打开的 WSL 文件全集（替换式）。多窗口经 union 做引用计数。 */
  setWindowFiles(windowId: number, wslPaths: string[]): void {
    this.byWindow.set(windowId, new Set(wslPaths));
    this.reconcile();
  }

  removeWindow(windowId: number): void {
    if (this.byWindow.delete(windowId)) this.reconcile();
  }

  private union(): Set<string> {
    const u = new Set<string>();
    for (const s of this.byWindow.values()) for (const p of s) u.add(p);
    return u;
  }

  private reconcile(): void {
    const u = this.union();
    for (const p of u) if (!this.watching.has(p)) this.startWatch(p);
    // 遍历时删除当前 key 在 JS Map 上安全
    for (const p of this.watching.keys()) if (!u.has(p)) this.stopWatch(p);
  }

  private startWatch(p: string): void {
    const entry: FileEntry = { cb: () => {}, last: "" };
    entry.cb = (curr: fs.Stats) => {
      // mtime=0 => 文件消失：不广播（renderer 读会失败）；等重建后(mtime>0)再正常报（§4.2）
      if (!curr || curr.mtimeMs === 0) {
        entry.last = "";
        return;
      }
      const key = snapshotEntry(curr.mtimeMs, curr.size);
      if (key === entry.last) return;
      entry.last = key;
      this.onChanged(p);
    };
    this.watching.set(p, entry);
    this.watchFileFn(p, { interval: this.intervalMs }, entry.cb);
    void this.seed(p, entry); // 建立基线，避免 focus 兜底首次误报
  }

  private async seed(p: string, entry: FileEntry): Promise<void> {
    try {
      const st = await this.statFn(p);
      if (st && st.mtimeMs !== 0 && entry.last === "") {
        entry.last = snapshotEntry(st.mtimeMs, st.size);
      }
    } catch {
      /* 忽略 */
    }
  }

  private stopWatch(p: string): void {
    const e = this.watching.get(p);
    if (!e) return;
    this.unwatchFileFn(p, e.cb);
    this.watching.delete(p);
  }

  /** §4.4 focus 兜底：窗口获得焦点时主动 stat 该窗口的 WSL 文件，变化即报。 */
  async checkWindow(windowId: number): Promise<void> {
    const set = this.byWindow.get(windowId);
    if (!set) return;
    for (const p of set) {
      const e = this.watching.get(p);
      if (!e) continue;
      const st = await this.statFn(p);
      if (!st || st.mtimeMs === 0) continue;
      const key = snapshotEntry(st.mtimeMs, st.size);
      if (key !== e.last) {
        e.last = key;
        this.onChanged(p);
      }
    }
  }

  /** 退出清理：StatWatcher 是 ref 句柄，残留会阻止进程退出（§4.2）。 */
  dispose(): void {
    for (const [p, e] of this.watching) this.unwatchFileFn(p, e.cb);
    this.watching.clear();
    this.byWindow.clear();
  }

  get size(): number {
    return this.watching.size;
  }
}
