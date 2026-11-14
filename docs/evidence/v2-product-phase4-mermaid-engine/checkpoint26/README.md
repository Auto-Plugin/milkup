# Checkpoint26：正式 production08 完整自动 UI 通过，视觉限制保留

本次独立授权的 Linux 正式 production08 完整原生 UI 运行，Node/harness **首次 exit 0**，原 completed-run auditor **首次 exit 0**。独立像素复核仍发现明确视觉限制，因此不能称“视觉全部达标”或 P4 全面完成。新的通过结果不解释、不追认修复旧 production08 超时；旧 render_3 的完整输入与原因仍未知。

产品代码、原 harness、官方 catalog、原 auditor 及 2s/10s 预算未改，没有为此次运行重新 build、改包或 retry。固定归档基线为 checkpoint25 commit `adccb2210d6bce10f7b4d17cd8a92fca176ef2f2`；正常 push、远端 SHA 和 GitHub LarryZhu-dev 身份的独立核验另存原文。此前检查点的“当时未推送”记录保持历史原样。

## 自动证据与独立复核

冻结清单覆盖 **1,099 files / 126,079,110 B**，SHA256 `7e93f524527a6752596d065d920ce6170aefd92bcc95f3915e945d8c8b490c42`。独立 request 审计逐项核验全部哈希与字节数。本归档程序只复核所选原字节和跨检查点对象；被排除主体的完整性依据该独立审计与完整冻结清单，未冒充再次全量核验。

记录包含 513 条记录、最后 PASS，ordinary/windowed 各 31 个 catalog 样例；64 个 matrix 组合（每视图 32）、320 个 matrix sample records、40 个 corner records、12 个历史记录和 2 个 selection records。892 张运行截图共 60,248,096 B；清单另外 3 个 PNG 是 profile 插件图标，不计作截图。DOM diagnostics.errors 与 CSP violations 记录为空，不能由此推断无视觉问题。

原 auditor 首次 0 与补充审计历史分开保留：补充脚本第一次因错误要求 windowed 每行重复完整选区而 exit 1；v02 因混入 3 个 profile icons 再 exit 1；修正自身前提的 v03 首次 exit 0。三个版本、原日志和执行记录均未覆盖。没有修改原 auditor，也没有产品重跑。

- [原始 completed-run auditor 与完整 SHA/bytes 审计](raw/research/cold-start-request-review-01/production08-final-review-01/REPORT.txt.txt)
- [ordinary：71 张实际查看](raw/research/ordinary-pixel-review-final-01/REPORT.txt.txt)
- [windowed：73 张实际查看与几何解释](raw/research/production08-windowed-pixel-review-01/REPORT.txt.txt)
- [Root：42 张 source/fallback/selection 实际查看](raw/research/production08-final-root-pixel-review-01/REPORT.txt.txt)
- [Root：另 4 张 Journey 角落补充](raw/research/production08-final-root-pixel-review-01/journey-corner-addendum.json.txt)

## 视觉结论与代表原图

ordinary 的 71 张、windowed 的 73 张、Root 原 42 张及额外 4 张是各自实际查看次数，存在重叠，不能相加当作唯一截图覆盖数。未宣称逐图审完 892 张。原 results 的 `reviewed:false` 未改，独立 inventory 记录真实查看范围。

**Journey 在 ordinary/windowed、light/dark、200% 窄窗的四个 bottom-right 图区域均为空白，仅有滚动条；对应 top-left 又可见图形。** windowed 冻结几何保留 complete/decoded、natural 760×1130、CSS 380×565 的同一图像，scrollLeft 69、scrollTop 413 均到 max，支持“已有解码图像的下部空白滚动区域”这一解释；未确定为何该区域为空。自动角落几何 PASS 不等于图墨迹可见。这个新观察未证明与旧 Journey 1106-pixel 差异是同一问题，也不等于 DOM 卸载或解码失败。

| 场景             | top-left 原图                                                                           | bottom-right 原图                                                                         |
| ---------------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| ordinary / light | [可见上部](images/5f7502c3a951a7b8d43e7506f85d822a0e3ccd5291efc666cf924c906dd7254a.png) | [空白图区域](images/a335409880e1839738d3725b0c2a6cca54222f6e3647103e719958287ca0029d.png) |
| ordinary / dark  | [可见上部](images/08fc6045b00b8963283257fa49ad613aee59a7821c60d3c7e9b9f87acced7676.png) | [空白图区域](images/e6d67ad22d95a486ba9509cf91ac2c0c0900382d161fbc1fc2bbf57a3a8222e8.png) |
| windowed / light | [可见上部](images/29537404cc6bf789effadcc052c89c36e42d07f662e898196902b7e273882a01.png) | [空白图区域](images/a9f7687cd37bc9332f3a0b039bd18d66ca67a7a29583032a83b97d518b89af39.png) |
| windowed / dark  | [可见上部](images/e2e673edba0400f2987ed1f2ccf8dd199b9452b0518e90a68140fcdabc73916e.png) | [空白图区域](images/b829445a578a6aece6a7be275ac94b6af2cbfe150828abfe4f797e11f9597daa.png) |

[完整 Journey 角落原始几何](raw/research/production08-windowed-pixel-review-01/journey-corner-evidence.json.txt) 与相应 16 张原 PNG（四种场景 × 两端点 × WebView/X11）均已归档。

其他已观察限制包括 sequence016 紫色 box 上的深色文字低对比、block 字面 `&nbsp;`、Sankey 标签拥挤/重叠、部分浅色标签对比弱，以及高缩放窄窗的裁切。未测数值对比率、未确定产品/官方样式归因；静态截图不能证明 End 可达、连续滚轮路径、所有标签或无瞬时闪白。低对比原图：[ordinary](images/403b4db1d83881b9e64fa72dfaad1efd7178b4425eb25215abf1f6c21bdd96de.png)、[windowed](images/96af8647a7cd422ba7c73bb36284eebebc408f82951c40ac33f2554a92c5b826.png)。

## 日志、清理与归档边界

完整 driver.log 保留 70 条 GTK critical 和 2 条 inspector address-in-use warnings。独立审计未见 deadline-observed/control-emitted；日志没有完整请求 endpoint ledger 或可靠丢失计数，不能以无 deadline 行证明每个请求都成功，也不能从 render 编号空洞推定失败或恢复未知输入。

冻结 postrun 记录 65 inputs、2,913 source、12 frontend 文件匹配，正式 binary、插件包、原 harness 不变。14 个精确已知身份均 absent、12 个 ancestor reaps；driver launch exit 241 是正常停机 SIGTERM -15 的 wait-only 传播，Node/harness 仍为 0。该清理结论限已知身份，不声称完整进程树覆盖。

此前缓存回收也保留原文：首 assert 发现 1 个硬链接后停止，未删除；随后跳过该文件，按授权只删除 919 个 nlink=1 的旧 task-owned `.rlib/.rmeta`，61 个保护对象保持一致，释放 1,625,853,952 B。归档程序没有执行删除。

本检查点有 **134 个来源别名**，本地 **114 个去重对象 / 12,705,540 B**，跨固定检查点复用 **13 个对象 / 8,025,784 B**。本地含 **36 张原 PNG**，覆盖正常样例及视觉限制；完整 results、四份几何/滚动 JSONL、关键 harness/driver 日志、输入/GO/cleanup/exit、完整 manifest 与全部独立 review 原文均保留。

以下主体仍在外部原位保存，不复制：154 个 profile 文件 / 40,613,276 B；未选的 856 张运行截图 / 58,712,958 B；2 个 work 文件 / 7,851,914 B。非空 work 与已跨检查点复用的 windowed fixture 字节相同。binary/SO/frontend/编译缓存主体也仅保留元数据或固定引用。完整冻结清单与 index 明列选择和排除，原始外部证据没有删除或改写。

[去重索引](index.json) 记录全部来源路径、SHA256、字节数、固定 commit 与存储对象。运行 `python3 verify-index.py` 可在相邻 checkpoint06…25 目录齐备时核验归档；外部 staging 需用 `--checkpointNN` 指定各固定目录。外部最终复核入口为 `checkpoint26-draft/verify-final01.sh`，只核验归档、来源与冻结记录，不运行产品或原 UI auditor。Windows、系统 DPI、全 renderer tree、旧超时根因及无视觉缺陷均不在本次通过结论内。
