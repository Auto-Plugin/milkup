# Checkpoint28：Diagrams 1.1.1 精确请求缓存与原生验证

本次落地 **Diagrams 1.1.1 插件私有成功缓存**，减少已观察到的完整请求相同的 Sankey 重复计算。产品改动限插件六个文件；另有一处生命周期测试分支及两行注释修正。host、SDK、原生产品代码、官方样例、依赖与安全配置、2s/10s 截止和4.5s清理观察界限不变。研究诊断 overlay 不作为产品原生改动交付。

插件127项测试、类型检查、构建和外部独立重建通过；原/后短诊断、正式 production08 plain 与 generic busy 验证分别保留。**历史 render_1037 的完整输入仍未知，不能称超时根因已修复或整体 P4 完成。** checkpoint27 的31/32真实失败通过固定 commit `207ba260e6846793d39a8db20c2f23dc64aff91b` 引用，不删除或改判。

## 具体优化与首次检查历史

缓存键为**完整请求 JSON 精确相等**，最多4个 FIFO条目、key+value保留 UTF-16 payload预算2MiB；只缓存 complete、非空、all-ready 且实际 Mermaid responses 全为 Sankey 的成功结果。错误、取消、partial 和其他图族不缓存。返回值独立解析，重入拒绝先于命中，prepare清空。字体已加载、无外部 stylesheet，Document/FontFaceSet/ready/URL/实际viewport/DPR观察边界一致才允许命中；两个快照不等于通用CSS/系统字体指纹，也不检测两次观察间发生后又恢复的变化。

[插件集成报告](raw/research/renderer-exact-memo-product-integration-01/REPORT.md.txt) · [六文件精确差异](raw/research/renderer-exact-memo-product-integration-01/all-six-files.diff.txt)

保留的首次结果不能混为同一种失败：

- desktop service 受控4项中，完整输入相同但外层窗口变化仍调用两次，得到1项预期优化 RED、3 PASS；使用 inert provider，不能归因 native 超时。
- memo baseline48项为37 PASS/11 FAIL，其中10项是缺少memo的有效RED，1项是 title复制到accessibleText后超预算的错误夹具预期；修正后的单项首次1 PASS、47 skipped。
- candidate01为52 PASS/1 FAIL，仍是预算夹具错误；candidate02实现不变，只修正夹具后53 PASS。两个首败及修正原文保留。
- 集成首 pnpm 命令在 Vitest启动前因自动安装目录 ENOENT失败；禁用该次自动安装后首次实际插件 Vitest为127 PASS（renderer53）。check/build/external各首次0，独立重建逐字一致。依赖审阅刷新是会改配置的写入工具，本轮未运行；保留原依赖profile并由构建严格校验。
- 全仓 typecheck/test/lint各首次0：2,069 Vitest +4 desktop bootstrap Node测试。插件127项属于独立插件检查，不能当作同一套重复计数。全仓检查未执行root build。

新独立封包 `milkup.diagrams-1.1.1.milkup-plugin`：5,728,276 B，SHA256 `2351692438a2083a72bcb8cddce28c7a530a8557734926992a3a2e3120c68a19`。旧1.1.0封包保留；新旧包/JS和App binary主体不复制进docs，proof/hash/外部路径及验证日志入档。

诊断构建首 frontend0/cargo0，但wrapper1：研究frontend未嵌入，首proof失败保留；独立第二次构建修正config后完成三项asset嵌入proof。不能把该首失败写成cargo失败，也不能跳过它称诊断构建首次全过。

## 实际原生请求与像素范围

[原短诊断完整wire审计](raw/research/cold-start-request-review-01/sankey-short-sequence-review-01/REPORT.md.txt) · [候选诊断与跨运行请求比较](raw/research/cold-start-request-review-01/sankey-candidate-review-01/REPORT.md.txt)

原诊断短UI首次0，26 accepted与前端完整值逐项匹配，25严格成功结算+1显式stop，84 frontend jobs闭合。候选短UI首次0，25 accepted为24严格成功+1stop；86 queued jobs中85派发，1 queued-only cancel未到native。两者完整driver集合与capture一致，无deadline/未闭合accepted。原审计入口首次0；候选清单改用相对路径，原入口首次1，独立schema adapter首次0并调用未改的分析函数。原traceback与adapter均保留。

| installed dark/width380 | 同run完全相等请求 | accepted→strict settle（ms）                      |
| ----------------------- | ----------------- | ------------------------------------------------- |
| 原版                    | render_20–23，4次 | 191.932052 / 168.838933 / 220.342534 / 208.886235 |
| 候选1.1.1               | render_21–23，3次 | 166.554793 / 17.030478 / 27.187443                |

每组内部payload完全相等；跨运行递归比较仅 `documentId` 不同，因此**跨run完整payload不相等**，App/instance也不同。候选后续重复的端到端时间在这次观察中更短，不直接证明native cache hit、减少多少engine调用或renderer CPU时间；engine复用依据独立受控测试。前端排队使用前端时钟，不与native相减。原render_22的native cancel在严格结算48.256190ms后到达、未转发，不能从frontend active-cancel推定native仍在执行。

[正式plain完整性与可见ROI比较](raw/research/cold-start-request-review-01/sankey-pixel-plain-review-01/REPORT.md.txt)

正式原 production08 binary +新插件的plain短验证首次0，**20 records /28 PNG**，含windowed source/live历史与公开disable/re-enable/remove；无deadline，13个记录身份均退出。它不是全64组合UI重跑。原/后两edge的同geometry可见ROI合计325,438像素，RGB差异0；诊断候选outer placement分别偏移−17/−65 CSS px，用已记录geometry位移比较重叠image-local区域也为0差异，原位置差异仍保留。没有改图、任意对齐或推断完整SVG/整图/离屏像素相等。首分析因不存在的cleanup旧字段exit1，独立v02 exit0；实际waitOnlyReaps=11单列，不能覆写首败。

原诊断：[bottom-right](images/2a32d99e9bc8602c875a30e3795baade1c4f872156f0a027a230648993631b2b.png) / [top-left](images/1d97a0df117c835c003cffb74953d9a526d4f6b2918746872ffabc4d7e8d1d08.png)。

候选诊断：[bottom-right](images/ce4b82b79a8b8e005366081ca4ed89a93efca2caf223c62e527657d68276aff9.png) / [top-left](images/0905e09a751f738a9e98ca119829bdf7572ba32e157704d231909115e77394df.png)。

正式plain：[bottom-right](images/2a32d99e9bc8602c875a30e3795baade1c4f872156f0a027a230648993631b2b.png) / [top-left](images/1d97a0df117c835c003cffb74953d9a526d4f6b2918746872ffabc4d7e8d1d08.png)。

## Generic busy：保留首败，分别说明最终证明

| 阶段/用例           | 实际结果    | 证明边界                                                                       |
| ------------------- | ----------- | ------------------------------------------------------------------------------ |
| 原timeout           | 首次0       | 原deadline/cleanup-complete/control顺序要求不变                                |
| 原disable           | 首次0       | 原运行通过，未重跑                                                             |
| 原remove            | 首次1       | package/UI/保存/ownedgone已过，但异步cleanup-complete缺失；当时后续两项NOT_RUN |
| 修正后remove        | 新执行首次0 | 复用精确App wait proof；本次也观察到精确ECHILD诊断                             |
| 原待执行wm-close    | 首次0       | 精确App wait proof；本次观察到精确ECHILD诊断                                   |
| 原待执行app-sigkill | 首次0       | guardian自然exit0及wait/reap上界，精确ECHILD timestamp未观察到                 |

[原remove首FAIL完整详情](raw/research/production08-generic-busy-final-01/remove-first-failure-detail.json.txt) · [最小测试proof修正](raw/research/lifecycle-app-wait-proof-fix-01/REPORT.txt.txt) · [三项新运行原始proof](raw/research/production08-generic-busy-proof-fix-01/first-results-summary.json.txt)

原remove失败不只是“晚到一行”：冻结全log确无cleanup-complete，异步bounded logger无退出flush保证；精确App Child.try_wait成功后cleanup-confirmed支持ECHILD完成上界，不是精确发生时刻。修正仅把既有wm-close分支扩至disable/remove、加两行解释，原proof body不变；syntax/format/diff和原失败trace离线proof通过，均不翻案原运行。新三项沿用原4.5s观察界限，分别20/21/21个已知精确身份退出、私有目录与端口清理；不能据此宣称全局完整树扫描或把generic fixture验收等同官方renderer验收。app-sigkill自然guardian退出未发送辅助signal，缺失精确终态诊断需长期保留。

[最后独立busy审计](raw/research/cold-start-request-review-01/generic-busy-final-review-01/REPORT.md.txt) 首次offline0，逐项核验两批共1,523 files /58,198,296 B；精确WebKit PID/birth的busy tick增长为+11/+31/+20/+12/+14/+20，证明通用非合作fixture在干预前执行，不是Mermaid CPU。timeout同App dispatch→deadline为2000.118012ms，未有替换dispatch重置。observer cleanup elapsed从cleanupObserved调用开始，不是action→cleanup延迟。原0/0/1与新0/0/0原样保留。

## 归档与复核

固定cp27内容寻址复用：735个来源别名；本地554对象 /8,046,980 B，跨检查点42对象 /1,050,905 B。本地PNG仅8个唯一原图对象，来源别名中的相同原/后plain帧去重。全部原始外部证据仍保留。

22份完整来源manifest各自保留，其逐项收录/排除统计见 [index](index.json) 的 `manifestCoverage`。1806个来源主体只留hash/bytes/排除原因，包括App/插件包/生成bundle、profile/cache、整长文档/work、整份inputs-repo快照及未选PNG。辅助picker清单和pre-drain重复snapshot未复制；最终完整前端trace、native events/wire、drain、首败上下文和独立审计原文保留。raw diff/log/脚本逐字存为txt，不做Prettier；仅README格式化，索引紧凑序列化以控制大小。

`python3 verify-index.py` 核验本目录对象与固定历史引用；完整来源/清单覆盖/格式复核为 `bash /workspace/milkup-mermaid-engine-evidence/checkpoint28-draft/verify-final01.sh`。此复核不运行产品或重跑原auditor。首次失败、后续修正、受控测试和实际native范围均独立保留；历史1037、Windows独立DOM执行与全P4验收不因本次优化而自动闭合。
