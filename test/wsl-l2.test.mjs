// WSL/远程文件监听第二层 —— 纯函数单元测试
// 运行: node --experimental-strip-types --test test/wsl-l2.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeWatchPath,
  classifyWatchTarget,
  partitionPaths,
  snapshotEntry,
  snapshotChanged,
} from "../src/main/wslWatch.ts";

test("normalizeWatchPath: 还原 \\\\?\\UNC\\ 前缀为 \\\\", () => {
  assert.equal(
    normalizeWatchPath("\\\\?\\UNC\\wsl.localhost\\Debian11\\tmp\\x"),
    "\\\\wsl.localhost\\Debian11\\tmp\\x"
  );
  assert.equal(normalizeWatchPath("\\\\?\\UNC\\server\\share\\a"), "\\\\server\\share\\a");
});

test("normalizeWatchPath: 还原 \\\\?\\C:\\ 前缀为盘符", () => {
  assert.equal(normalizeWatchPath("\\\\?\\C:\\Users\\x"), "C:\\Users\\x");
});

test("normalizeWatchPath: 普通路径原样返回", () => {
  assert.equal(normalizeWatchPath("C:\\Users\\x"), "C:\\Users\\x");
  assert.equal(
    normalizeWatchPath("\\\\wsl.localhost\\Debian11\\a"),
    "\\\\wsl.localhost\\Debian11\\a"
  );
  assert.equal(normalizeWatchPath("/home/user/a"), "/home/user/a");
  assert.equal(normalizeWatchPath(""), "");
});

test("classifyWatchTarget: WSL UNC -> wsl", () => {
  assert.equal(classifyWatchTarget("\\\\wsl.localhost\\Debian11\\tmp"), "wsl");
  assert.equal(classifyWatchTarget("\\\\wsl$\\Ubuntu-22.04\\home"), "wsl");
});

test("classifyWatchTarget: 大小写不敏感", () => {
  assert.equal(classifyWatchTarget("\\\\WSL.LOCALHOST\\Debian11\\x"), "wsl");
  assert.equal(classifyWatchTarget("\\\\WSL$\\Ubuntu\\x"), "wsl");
});

test("classifyWatchTarget: \\\\?\\UNC\\wsl 归一化后仍判 wsl(防重开 EISDIR)", () => {
  assert.equal(classifyWatchTarget("\\\\?\\UNC\\wsl.localhost\\Debian11\\x"), "wsl");
});

test("classifyWatchTarget: SMB / 本地盘符 / Z: 映射 / posix -> chokidar", () => {
  assert.equal(classifyWatchTarget("\\\\server\\share\\a"), "chokidar"); // SMB
  assert.equal(classifyWatchTarget("C:\\Users\\x"), "chokidar"); // 本地盘符
  assert.equal(classifyWatchTarget("Z:\\foo"), "chokidar"); // 已知漏判: net use 映射的 WSL
  assert.equal(classifyWatchTarget("/home/user/a"), "chokidar"); // posix
  assert.equal(classifyWatchTarget(""), "chokidar");
});

test("classifyWatchTarget: 名字里含 wsl 的 SMB 主机不应误判", () => {
  // \\wslserver\share 不是 \\wsl.localhost / \\wsl$ , 应判 chokidar
  assert.equal(classifyWatchTarget("\\\\wslserver\\share\\a"), "chokidar");
});

test("partitionPaths: 混合列表正确分流且不重叠不遗漏", () => {
  const input = [
    "C:\\a.md",
    "\\\\wsl.localhost\\Debian11\\a.md",
    "\\\\server\\share\\b.md",
    "\\\\wsl$\\Ubuntu\\c.md",
  ];
  const { wsl, chokidar } = partitionPaths(input);
  assert.deepEqual(wsl, ["\\\\wsl.localhost\\Debian11\\a.md", "\\\\wsl$\\Ubuntu\\c.md"]);
  assert.deepEqual(chokidar, ["C:\\a.md", "\\\\server\\share\\b.md"]);
  assert.equal(wsl.length + chokidar.length, input.length);
});

test("snapshotEntry: mtime 取整 + 拼 size", () => {
  assert.equal(snapshotEntry(1591394766000.7, 25), "1591394766000:25");
});

test("snapshotChanged: 同集合 -> false", () => {
  const a = new Map([
    ["/x", "100:10"],
    ["/y", "200:20"],
  ]);
  const b = new Map([
    ["/x", "100:10"],
    ["/y", "200:20"],
  ]);
  assert.equal(snapshotChanged(a, b), false);
});

test("snapshotChanged: mtime 变 -> true", () => {
  const a = new Map([["/x", "100:10"]]);
  const b = new Map([["/x", "999:10"]]);
  assert.equal(snapshotChanged(a, b), true);
});

test("snapshotChanged: 同 mtime 仅 size 变 -> true(对齐 §0-B)", () => {
  const a = new Map([["/x", "100:10"]]);
  const b = new Map([["/x", "100:25"]]);
  assert.equal(snapshotChanged(a, b), true);
});

test("snapshotChanged: 新增/删除 key -> true", () => {
  assert.equal(
    snapshotChanged(
      new Map([["/x", "1:1"]]),
      new Map([
        ["/x", "1:1"],
        ["/y", "2:2"],
      ])
    ),
    true
  );
  assert.equal(
    snapshotChanged(
      new Map([
        ["/x", "1:1"],
        ["/y", "2:2"],
      ]),
      new Map([["/x", "1:1"]])
    ),
    true
  );
});
