// WslFileWatcher / WslDirectoryWatcher 行为测试（注入假依赖，不依赖 electron）
// 运行: node --experimental-strip-types --test test/wsl-watchers.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { WslFileWatcher, WslDirectoryWatcher } from "../src/main/wslWatch.ts";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function makeFileHarness() {
  const cbs = new Map(); // path -> cb
  const watched = new Set();
  const changes = [];
  const w = new WslFileWatcher({
    intervalMs: 1,
    onChanged: (p) => changes.push(p),
    watchFile: (f, _o, cb) => {
      cbs.set(f, cb);
      watched.add(f);
    },
    unwatchFile: (f) => {
      cbs.delete(f);
      watched.delete(f);
    },
    stat: async () => null, // seed 不干扰（last 保持 ""）
  });
  return { w, cbs, watched, changes };
}

test("WslFileWatcher: setWindowFiles 启停监听", () => {
  const { w, watched } = makeFileHarness();
  w.setWindowFiles(1, ["\\\\wsl.localhost\\D\\a.md", "\\\\wsl.localhost\\D\\b.md"]);
  assert.equal(watched.size, 2);
  w.setWindowFiles(1, ["\\\\wsl.localhost\\D\\a.md"]);
  assert.equal(watched.size, 1);
  assert.ok(watched.has("\\\\wsl.localhost\\D\\a.md"));
});

test("WslFileWatcher: 多窗口同文件 union 引用计数，归零才 unwatch", () => {
  const { w, watched } = makeFileHarness();
  const f = "\\\\wsl.localhost\\D\\shared.md";
  w.setWindowFiles(1, [f]);
  w.setWindowFiles(2, [f]);
  assert.equal(watched.size, 1); // 同一文件只监听一次
  w.removeWindow(1);
  assert.ok(watched.has(f)); // 窗口2 还开着 -> 不 unwatch
  w.removeWindow(2);
  assert.equal(watched.size, 0); // 归零才 unwatch
});

test("WslFileWatcher: 变更触发 onChanged，同 key 不重复，mtime=0 不报", () => {
  const { w, cbs, changes } = makeFileHarness();
  const f = "\\\\wsl.localhost\\D\\a.md";
  w.setWindowFiles(1, [f]);
  const cb = cbs.get(f);
  cb({ mtimeMs: 100, size: 10 }); // 首次变更
  cb({ mtimeMs: 100, size: 10 }); // 同 key -> 不重复
  cb({ mtimeMs: 200, size: 10 }); // mtime 变
  cb({ mtimeMs: 0, size: 0 }); // 删除 -> 不报
  cb({ mtimeMs: 300, size: 5 }); // 重建后再报
  assert.deepEqual(changes, [f, f, f]);
});

test("WslFileWatcher: checkWindow(focus) 比对 stat 变化即报", async () => {
  const cbs = new Map();
  const changes = [];
  let statVal = { mtimeMs: 100, size: 10 };
  const w = new WslFileWatcher({
    intervalMs: 1,
    onChanged: (p) => changes.push(p),
    watchFile: (f, _o, cb) => cbs.set(f, cb),
    unwatchFile: (f) => cbs.delete(f),
    stat: async () => statVal,
  });
  const f = "\\\\wsl.localhost\\D\\a.md";
  w.setWindowFiles(1, [f]);
  await sleep(5); // 等 seed 完成，last = "100:10"
  await w.checkWindow(1); // 无变化 -> 不报
  assert.equal(changes.length, 0);
  statVal = { mtimeMs: 100, size: 25 }; // 同 mtime 改 size
  await w.checkWindow(1);
  assert.deepEqual(changes, [f]);
});

test("WslFileWatcher: dispose 清空所有监听", () => {
  const { w, watched } = makeFileHarness();
  w.setWindowFiles(1, ["\\\\wsl.localhost\\D\\a.md", "\\\\wsl.localhost\\D\\b.md"]);
  assert.equal(watched.size, 2);
  w.dispose();
  assert.equal(watched.size, 0);
  assert.equal(w.size, 0);
});

test("WslDirectoryWatcher: 快照变化触发 onChanged(去抖后)", async () => {
  let snap = new Map([["/x", "1:1"]]);
  let calls = 0;
  const w = new WslDirectoryWatcher({
    intervalMs: 15,
    debounceMs: 5,
    snapshot: async () => new Map(snap),
    exists: async () => true,
    onChanged: () => calls++,
  });
  w.watch("\\\\wsl.localhost\\D\\dir");
  await sleep(40); // 基线 + 若干 tick，无变化
  assert.equal(calls, 0);
  snap = new Map([
    ["/x", "1:1"],
    ["/y", "2:2"],
  ]); // 新增文件
  await sleep(60);
  assert.ok(calls >= 1, `期望 onChanged 至少 1 次, 实际 ${calls}`);
  w.unwatchAll();
});

test("WslDirectoryWatcher: 不可达(exists=false)且扫空时不广播全删", async () => {
  let snap = new Map([
    ["/x", "1:1"],
    ["/y", "2:2"],
  ]);
  let reachable = true;
  let calls = 0;
  const w = new WslDirectoryWatcher({
    intervalMs: 15,
    debounceMs: 5,
    snapshot: async () => new Map(snap),
    exists: async () => reachable,
    onChanged: () => calls++,
  });
  w.watch("\\\\wsl.localhost\\D\\dir");
  await sleep(40); // 基线建立(快照非空)
  reachable = false; // WSL shutdown
  snap = new Map(); // readdir 扫不到
  await sleep(60);
  assert.equal(calls, 0, "不可达时不应广播全删");
  w.unwatchAll();
});

test("WslDirectoryWatcher: unwatch 后停止；size 归零", async () => {
  const w = new WslDirectoryWatcher({
    intervalMs: 15,
    debounceMs: 5,
    snapshot: async () => new Map(),
    exists: async () => true,
    onChanged: () => {},
  });
  w.watch("\\\\wsl.localhost\\D\\dir");
  assert.equal(w.size, 1);
  w.unwatch("\\\\wsl.localhost\\D\\dir");
  assert.equal(w.size, 0);
});
