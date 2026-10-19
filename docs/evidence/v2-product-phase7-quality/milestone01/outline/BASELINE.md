# P7 大纲性能与键盘基线

2026-10-19；产品基线 `fa530b399a5ebbd020f9bfa7ca039378604c8282`，独立大纲 1.3.1。测量脚本 `tests/performance/p7-outline-baseline.mjs`；原始执行版本另存 `baseline-script-01.mjs`，每份结果含实现及脚本 SHA256。原有 24 项大纲测试通过，详见 `existing-tests-01.log`。

## 测量范围

`index-baseline-01/results.json` 是 Node 24.19.0 中真实 OutlineIndex 算法与内存模拟临时存储，不包含宿主扫描、Worker RPC、IndexedDB 落盘、主线程渲染或原生输入。每种夹具 3 次，依次执行；不是隔离 CPU 基准，不报告 p95、峰值内存或原生延迟。标题层级/位置由确定夹具生成；每次完整遍历逐标题比较文本、ordinal、UTF16位置和行号。含重复标题、中文、组合字符及 emoji，另有 512 个长标题。未改变产品标题上限或全文语义。

操作时序固定：完整追加→全部标题验证→全部折叠重置→折叠首批呈现→全部展开首批呈现→尾部→中部→首根局部折叠/展开→尾行查询。此处“首批”最大 160 行。缓存经过前序操作；不得标为系统冷缓存。

| 负载 | 完整追加 min/median/max ms | 已存页/字节 | 折叠重置读/写 | 折叠后呈现读取次数 | 折叠后呈现 min/median/max ms |
| --- | --- | --- | --- | --- | --- |
| 8 标题 | 0.24 / 0.35 / 3.11 | 3 / 707 | 0 / 0 | 0 | 0.01 / 0.05 / 0.10 |
| 8,775 标题 | 129.29 / 131.60 / 138.32 | 177 / 942,593 | 0 / 0 | 18 | 1.43 / 1.87 / 3.22 |
| 18,000 标题 | 214.42 / 217.39 / 316.21 | 359 / 2,009,512 | 0 / 0 | 36 | 2.42 / 2.91 / 3.13 |
| 512 长标题 | 68.30 / 70.09 / 73.71 | 66 / 3,722,210 | 0 / 0 | 3 | 0.23 / 0.26 / 0.46 |

18,000 标题尾部、中部 160 行读取各 6 次；首根局部折叠含呈现 7 读/1 写，展开 2 读/1 写。序列所有页≤64KiB、批次≤256KiB/32keys。此页数是存储页数，不是内存驻留页数；产品共享 LRU 上限仍为 24 页。

## 当前热点与候选

1. `OutlineIndex.rows` 每 16 行逐次调用 visibility.select；折叠后稀疏根落在不同叶页，叶页串行 get 再加元数据/标题批读，共 36 次。应优先研究有界叶页批量选择，而非重写零 I/O 的 reset，也不能用根标题副本或无界缓存规避完整索引。
2. 插件每 128 条扫描结果串行 append，同一队列还处理导航、折叠、刷新；临时页刷写与宿主传输应由新原生数据区分。纯内存 217ms 不能解释历史完整扫描 17s 的全部来源。
3. 宿主 virtual-list 有 160ms 滚动去抖，插件版本变化启动有 120ms 去抖；这些是源码观察，不是已经证实需删除的延迟。滚动、输入频率、资源界限须一起验证。
4. 旧历史原生报告中 18k 完整索引中位17,400ms、全部折叠891ms、导航434–453ms，提示目标未达；这些是旧产品/旧夹具数据，不能充当当前 fa530 原生结果。

## 键盘可复现失败及窄修复

`keyboard-red-01` 使用实际 outline plugin 的公开 SDK 输出、宿主真实 decorateControlledTrees 和 JSDOM。8 标题输出 span treeitem 包含折叠与导航按钮，原宿主只识别 button treeitem；ArrowDown 不消费、不移动，树内14个Tab停靠点。完整 HTML及结果保存，退出1的 RED日志未删除。

`controller-red-01.log` 新回归经实际 keydown 再现。后续 generic host 小修只识别具有唯一 aria-current 导航按钮、且分支有与外层 aria-expanded 精确匹配的独立折叠按钮的行；将 treeitem语义放到导航按钮，方向键折叠派发到独立toggle，鼠标仍可用。无插件ID/命令名特判，无新增SDK字段。`controller-green-01.log` 5项通过；`keyboard-green-01` 实际plugin同脚本复跑 ArrowDown移动且唯一Tab停靠。

以上是DOM协议回归，不是系统读屏或原生键盘验收。当前generic controller Home/End只覆盖已呈现slice；跨虚拟窗口键盘仍需独立RED/宿主接线，不得把本次局部绿色当成全文键盘完成。旧legacy任意双按钮wrapper保持原行为，避免误猜动作。

## 验收预算与后续原生条件

采用当前P7清单：暖态导航呈现代理p95≤200ms并报告≤100ms比例；首次远距≤500ms；局部/全部折叠稳定可见≤250ms；长索引首批≤1s且能取消/继续输入。至少20可比较样本才报nearest-rank p95，否则min/median/max。完整索引仍必须精确覆盖全部标题，不能降低文档规模/标题上限达标。

当前旧 `tests/native/tauri-outline-performance.mjs` 包含8775/18000真实夹具、IndexedDB/Worker观察与局部/全局/首尾导航，但安装流程早于native catalog，不能原样宣称可运行。需要按P6正常UI详情/候选审批与启用，冻结独立archive哈希，记录实际源SHA/version/目标行。root独占并协调display；本审计未启动UI、Cargo或任何安装。

重跑离线命令（每次使用新证据子目录，结果文件拒绝覆盖）：

```sh
node tests/performance/p7-outline-baseline.mjs index /workspace/milkup-p7-quality-evidence/milestone01/outline/index-NEW
node tests/performance/p7-outline-baseline.mjs keyboard /workspace/milkup-p7-quality-evidence/milestone01/outline/keyboard-NEW
node node_modules/vitest/vitest.mjs run --config scripts/ci/outline-tests.config.ts
```
