# 规约：WSL/远程文件监听第二层（轮询路线）

状态：草案 v2（已合入 2026-06-04 code review），待实施
前置条件：等第一层 PR #236 合入/有结论后再动手 + 完成 §0 前置实测
关联：上游 issue #172、PR #236（第一层修复）

---

## 0. 前置实测（动手前必须先做，否则方案不成立）

第一层之所以"跳过 WSL 工作区加载"，是因为加载会崩 EISDIR。第二层要撤销跳过，**必须先用实测证明完整建树路径全程不踩 EISDIR**，否则等于重开第一层堵住的崩溃口。

- [前置实测 A] **完整建树路径无 EISDIR**：在一个含 `普通文件 / 子目录 / 指向文件的 symlink / 指向目录的 symlink / dangling symlink / >100 文件的大目录 / >10 层深目录` 的真实 WSL 目录上，跑 `scanDirectory` 等价递归（readdir withFileTypes + 对 dir 递归 + 对 file stat），断言：全程 0 次 EISDIR / 0 uncaughtException / 0 unhandledRejection。重点验证"递归进 symlink 指向的目录"和"对 dirent 做 stat 而非 lstat"两条路径。
- [前置实测 B] **fs.watchFile 在 9P 的可靠性边界**：已初步实测可检测 `echo >>` 追加（mtime 推进）。补测：原子替换（写临时文件 + rename 覆盖、`cp -p` 保留 mtime、`mv` 保留时间戳）、删除后重建、9P 同秒内多次写。记录哪些能检测、哪些漏报——漏报项必须由 §4.4 的 size/focus 兜底覆盖。

两项任一失败，则对应设计分支需改方案或缩小范围，不得按本规约直接实现。

## 1. 背景

第一层（PR #236）已止血：打开 WSL 文件不再因 `EISDIR` 崩溃。代价是 WSL 路径被 `shouldAutoLoadWorkspace` 跳过——WSL 文件没有左侧文件树，也不提示外部变更。

第二层目标：让 WSL/远程文件也能 (1) 显示左侧文件树；(2) 外部进程修改文件时弹"重新加载"提示。

## 2. 实测依据（决定技术选型）

在 `\\wsl.localhost\` 路径下，从 **WSL 内部进程**修改文件，实测结果：

| 方式                                   | 结果        | 用途             |
|----------------------------------------|-------------|------------------|
| `fs.watch`（事件，chokidar 底层）      | 启动即 EISDIR | 不可用           |
| `fs.watchFile`（Node 内置轮询）        | 检测到追加写 | 监听已打开文件（边界见 §0-B） |
| 轮询 `fs.statSync().mtimeMs`           | 检测到追加写 | 文件树快照源     |
| `fs.readdir({withFileTypes:true})`     | 正常        | 构建文件树       |

结论：**事件式监听在 WSL 9P 上不支持；轮询路径可行。**

关键澄清（评审修正）：
- `readdir({withFileTypes:true})` 本身不对 symlink 单独 lstat，故 readdir 不踩 EISDIR；但**这不等于 symlink 会进文件树**——分类逻辑见 §4.1（必须显式加 `isSymbolicLink()` 分支，否则 symlink 被丢弃）。
- "轮询用普通文件 stat 安全"只覆盖单文件场景。文件树轮询/建树处理对象含目录与 symlink，安全性由 §0-A 实测背书，不由该单点结论背书。
- CudaText(FPC) 走轮询仅作旁证，不构成 Node `fs.watchFile`/`setInterval` 在 Electron 主进程 + 9P 下可靠的证据；可靠性以 §0-B 实测为准。

## 3. 目标、非目标与范围边界

目标：WSL/远程 = 文件树(静态) + 文件树自动刷新(轮询) + 已打开文件外部变更提示(轮询 + size/focus 兜底)；本地保持 chokidar 实时，不退化。

非目标：不追求 WSL 实时(轮询秒级延迟可接受)；不改本地事件监听逻辑。

范围边界（评审修正，明确写死）：
- **仅 `\\wsl.localhost\` / `\\wsl$\` 走轮询。** 普通 SMB(`\\server\share`) 第二层**沿用 chokidar**（SMB 上 fs.watch 通常可用），不一刀切降级；是否对 SMB 也轮询，待单独实测后另行决定（见 §8 defer）。
- **本地工作区内嵌指向 WSL 的 junction/symlink** 是已知盲区：分流按顶层 `dirPath` 判定，无法拦截本地树内的远程子路径，chokidar 递归到它仍会 EISDIR。该场景**只能靠第一层 error handler 吞错兜底**（不崩，但该子树不工作），第二层不解决，文档化为已知局限。
- **已知漏判路径**（见 §4.0）：`Z:\` 之类把 WSL 映射成盘符的情况，第二层不识别为远程；文档化告知用户用 UNC 形式打开。

## 4. 设计：按路径分流

核心：仅 WSL 走轮询，其余（本地 + SMB）走 chokidar。

### 4.0 路径判定（评审修正）

判定函数放在 **main 进程**（有真实 `process.platform`），输入先做前缀归一化再匹配：

1. 归一化：把 `\\?\UNC\server\share\...` 还原为 `\\server\share\...`；`\\?\C:\...` 还原为 `C:\...`（否则 `\\?\UNC\wsl.localhost\` 会被旧正则的 `(?![?.]\\)` 误判为本地，重开 EISDIR）。
2. 仅当归一化后匹配 `^\\\\wsl(?:\$|\.localhost)\\` 时判为"WSL 远程，走轮询"。
3. 其余（本地盘符、SMB UNC、`Z:\` 映射）一律走 chokidar。

已知漏判（文档化，不在本层解决）：WSL 被 `net use` 映射成 `Z:\` 时归一化后是盘符形式，判为本地→chokidar 递归会 EISDIR→由 error handler 兜底。提示用户以 `\\wsl.localhost\` 形式打开。

### 4.1 main：`workspace:watchDirectory`（远程分支）

- 本地/SMB：现状不变（chokidar，`depth:10`，已有 300ms debounce）。
- WSL 远程：不创建 chokidar，改用 `setInterval` 定时重扫。要求：
  - **per-dirPath 维护 interval 句柄**（不可单例，否则多窗口/多工作区互相覆盖泄漏）。入口先清掉本 dirPath 旧 interval 再建（对称于 chokidar 分支的 `close()` 自清），不只依赖 `unwatchDirectory`。
  - **in-flight guard**：上一轮 `scanDirectory` 未完成则跳过本轮 tick（9P readdir 可能 >间隔）。`clearInterval` 后到达的迟到 readdir 结果**丢弃不广播**（用一个 generation/epoch 标记，回调完成时校验仍是当前代）。
  - **快照对比用 `path + mtimeMs + size` 集合**（评审修正：仅 mtime 漏掉原子替换/保留 mtime/重命名互换；加 size 显著降低漏报，仍非 100%，但配合内容读取后比对可接受）。差异即调 §4.1-broadcast。
  - **后端不可达判别**：`existsSync(dirPath)` 为 false 时，区分"WSL 整体不可达(shutdown/断开)"与"目录真被删"——不可达时**保持上次快照、不广播全删**（避免树被清空又重建）。判别可用：上次快照非空且本次 readdir 抛 ENOENT/超时 → 视为不可达，跳过本轮。
  - **截断一致性**：复用 `scanDirectory` 的 `MAX_FILES_PER_DIR(100)` / `MAX_DEPTH(10)` 截断意味着被砍部分的变更检测不到。需在文档/UI 标注"大目录/深层不保证刷新"，或为远程轮询单独放宽/分页（取舍见 §5），避免 §6 验收对大目录假成立。
- **广播去抖**：远程分支也要 300ms debounce（对齐本地），且 `directory-changed` 触发的 renderer `refreshWorkSpace` 需与下一轮 interval **互斥**（refresh 进行中不叠加新 refresh）。

### 4.2 main：`file:watch`（远程分支）

- 本地/SMB 文件：现状不变（chokidar `watcher.add`）。
- WSL 远程文件：`fs.watchFile(file,{interval},cb)`，要求：
  - **partition 规则**：对收到的混合 `newFilePaths`，按 §4.0 判定逐个分到 chokidar 集合 / 远程 watchFile 集合，保证不重叠、无遗漏；一个文件路径规范化后归属改变时，先从旧集合移除再加新集合。
  - **引用计数**（评审修正）：远程文件用 `Map<path, refCount>` 而非裸 Set。多窗口/多 tab 打开同一文件 refCount++；关闭 refCount--，**归零才 `unwatchFile`**（否则关一个 tab 误伤仍开着的另一窗口）。注：本地 chokidar 路径继承现有全局单例同类竞态，本规约不回头修，但远程新代码不得复制该缺陷。
  - **退出清理**：`app.on('before-quit')` 遍历远程 Map 全部 `unwatchFile`（StatWatcher 是 ref 句柄，残留会阻止进程退出）。
  - **mtime=0（文件消失）处理**：cb 收到 `curr.mtimeMs===0` 表示文件不存在——不要当普通变更广播给 renderer 去读（会读失败）；改为发"文件已删除"语义或静默,等重建后(mtime>0)再正常报。原子替换(unlink+新 inode)后能否继续跟踪由 §0-B 实测确认。
  - **size 兜底**：cb 里同时比对 `size`，覆盖 mtime 不变但内容变的情况（与 §4.1 快照同理）。

### 4.3 renderer：`getWorkSpace`

- 撤销第一层对 WSL 的"完全跳过"：WSL 也调 `getDirectoryFiles` 建树（建树安全性由 §0-A 背书）。下游监听由 main 按 §4.0 自动分流。
- **`scanDirectory` 分类修正**（评审修正，核心）：现 `isDirectory()/isFile()` 二分会丢弃 symlink（两者皆 false）。必须加 `isSymbolicLink()` 分支：symlink 进树并标记类型；其 mtime 进快照（否则 symlink 出现/消失/重指向不刷新）。是否解引用递归由策略决定（默认不解引用，避免环 + 避免对 symlink 指向目录的额外 stat 风险）。
- **空树与一次性锁**：远程首扫慢/超时/全 symlink 时 `getDirectoryFiles` 可能返回 `[]`，现逻辑 `!result.length` 在置 `isLoadWorkSpace` 前早返回→锁不置位→tabs 变化反复整树重扫慢 9P。修正：远程返回空时也置位（或加"远程已尝试加载"独立标志），避免反复重扫；远程的周期刷新由 §4.1 interval 负责，不依赖 tabs watch 重触发。

### 4.4 已打开文件的 mtime 兜底（一期交付，非二期）

评审修正：focus 兜底是 watchFile 漏报（保留 mtime 类修改）的唯一补救，**下放到一期**：
- 窗口 `focus` 时，对当前打开的远程文件主动 `stat` 一次，比对 `mtime+size`，变化即触发重载提示。
- 低频 `fs.watchFile` 作为后台兜底。两者结合覆盖"用户切回窗口"和"窗口在前台时被改"两种时机。

## 5. 关键参数（评审修正：阈值与延迟解耦）

| 项                         | 建议值      | 说明                                   |
|----------------------------|-------------|----------------------------------------|
| 远程文件树轮询间隔         | 4000ms      | 实际刷新延迟 ≈ 间隔 + scan耗时,非"间隔=延迟" |
| 远程单文件 mtime 轮询间隔  | 1500ms      | 检测延迟最坏 ≈ 间隔 + 读文件 + IPC      |
| 广播 debounce             | 300ms       | 对齐本地 chokidar                       |
| in-flight guard           | 启用        | scan 未完跳过本轮 tick                  |
| 大目录降级阈值            | 待 §0-A 实测定 | 超阈值放宽间隔/分页/标注不保证刷新     |

参数须由 §0 实测的 9P stat/readdir 实耗校准；下表 §6 阈值由这些间隔 **加处理余量**推出，不得反向用阈值倒推间隔（消除循环论证）。

## 6. 验收标准（评审修正）

1. **本地不退化（可量化）**：本地工作区文件树构建时间、外部变更提示延迟，与改动前基线相比差异 ≤ 基线的 10%（同机同目录对比，各 5 次取中位数）。SMB 工作区同样保持 chokidar 实时（变更后 < 1s 提示）。
2. **WSL 文件**：
   - 出现文件树，且**含 symlink 项**（验证 §4.3 分类修正）；
   - WSL 内 `echo x >> file` 后，检测延迟 ≤ (单文件间隔 1500ms + 处理余量 1000ms) = **2.5s**；
   - 原子替换（保留 mtime）后，由 size 兜底或 focus 兜底检测到（验证 §4.4）；
   - 新建/删除文件后 ≤ (树间隔 4000ms + 余量 1500ms) = **5.5s**（目录 ≤100 项、≤10 层；超规模按降级策略另定，不在本条）；
   - 全程无 EISDIR / uncaughtException / unhandledRejection。
3. **不可达不误清**：轮询中 `wsl --shutdown`，文件树**不被清空**；WSL 重启后恢复（验证 §4.1 不可达判别）。
4. **多窗口引用计数**：两窗口打开同一 WSL 文件，关其一，另一窗口仍能收到该文件外部变更（验证 §4.2 refCount）。
5. **无泄漏**：反复开关远程工作区/文件 N 次后，per-dir interval 句柄数、远程 watchFile Map 大小回到基线；`before-quit` 后进程能正常退出（验证句柄已清）。
6. **混合工作区**：同窗口同时打开本地与 WSL 文件，两者各自的变更提示都工作，无双广播/漏监听（验证 §4.2 partition）。

## 7. 风险与权衡

- 9P readdir/stat 慢：间隔不能太短；大目录需降级策略（§4.1/§5）。
- 轮询 + size 仍非 100%（同 mtime 同 size 内容变罕见但可能）：由读取后内容比对 / focus 兜底进一步覆盖；可接受。
- 本地树内嵌 WSL symlink、`Z:\` 映射：已知盲区，error handler 兜底 + 文档告知（§3/§4.0）。

## 8. 与第一层的关系 + 暂缓项

- 第一层（PR #236）：止血。error handler 兜底 + WSL 跳过加载。**保留 error handler**（防御纵深；也是 §3 已知盲区的兜底）。
- 第二层（本规约）：恢复功能。撤销"跳过加载"、按路径分流到轮询。作为**独立后续 PR**，commit 引用本规约。

暂缓（defer，#236 合入后再定）：
- **SMB 是否也轮询**：第二层暂对 SMB 沿用 chokidar；待 SMB 上 fs.watch 可靠性单独实测后决定。
- **对 #236 接口的契约假设 + 过渡态**：第二层 §4.3 撤销跳过的落点依赖 #236 的实现形态；半启用态（有树无提示/有提示树旧）待 #236 合入后据实际接口细化。

---

## 评审 findings（code review 2026-06-04，Blind Hunter + Edge Case Hunter）

> v2 已将 13 条 patch 全部并入正文（下方勾选标注落点）。2 条 defer 见 §8。

### 已解决（并入正文）
- [x] [Patch] mtime 唯一真相 → §0-B 实测边界 + §4.1 快照加 size + §4.2 size 兜底 + §4.4 focus 兜底提到一期
- [x] [Patch] 判定漏判重开 EISDIR → §4.0 前缀归一化 + §3/§4.0 文档化 Z:\ 与本地内嵌 symlink 盲区 + error handler 兜底
- [x] [Patch] symlink 被分类丢弃 → §4.3 scanDirectory 加 isSymbolicLink() 分支 + §6.2 验收"树含 symlink 项"
- [x] [Patch] 撤销跳过 EISDIR 证据不足 → §0-A 前置实测（完整建树路径无 EISDIR）
- [x] [Patch] 定时器生命周期三洞 → §4.1 per-dirPath interval + 入口自清 + in-flight guard + epoch 丢弃迟到结果
- [x] [Patch] fs.watchFile 泄漏与误伤 → §4.2 refCount + before-quit 清理
- [x] [Patch] 验收时序不自洽 → §5 阈值=间隔+余量(禁倒推) + §6.2 显式换算
- [x] [Patch] WSL 不可达误清空树 → §4.1 不可达判别(不广播全删) + §6.3 验收
- [x] [Patch] 目录截断漏变更 → §4.1 截断一致性说明 + §5 大目录降级阈值 + §6.2 规模限定
- [x] [Patch] 广播无防抖+refresh 无护栏 → §4.1 远程 300ms debounce + refresh 互斥
- [x] [Patch] 混合列表 partition → §4.2 partition 规则 + §6.6 验收
- [x] [Patch] isLoadWorkSpace 锁 vs 远程空树 → §4.3 空树也置位/独立标志 + 远程刷新归 interval
- [x] [Patch] 无退化无定义 → §6.1 量化(≤基线 10%，5 次中位数)

### 暂缓（defer，见 §8）
- [x] [Defer] SMB 一刀切降级无实测 → §3 改为 SMB 沿用 chokidar；是否轮询待 SMB 实测
- [x] [Defer] 前置绑死 #236 + 过渡态 → §8 暂缓项，#236 合入后细化

### 已驳回（dismiss，1 条）
- CudaText 类比谬误：已有独立 Node `fs.watchFile` 实测覆盖，CudaText 仅旁证，措辞问题非缺陷。
