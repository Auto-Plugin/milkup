# P6：插件安装预检与首次输出准备（2026-10-19）

状态：**首个可验收检查点；P6 尚未完成，P5 未完成项继续开放。** 基线 `1388f646703ba19c4ed501b0450d123e70388f9a`，隔离分支 `dot/milkup-v2-product-phase6-plugin-lifecycle`。实现前已建立[完整验收清单](v2-product-phase6-plugin-lifecycle-checklist.md)。本轮没有合并质量分支、main 或 v2，也没有上传/发布运行时或安装包。

证据目录为 [milestone01](evidence/v2-product-phase6-plugin-lifecycle/milestone01/README.md)。原始失败、修后日志、真实 UI 截图及输出产物按原字节归档；ELF、SDK tar 和插件包仅记录本地交付路径及 SHA，不随 Git 提交。中间报告保留当时结论，最终状态以本报告和各次实际运行的完成/退出记录为准。

## 已实现的行为

**安装包在写盘前拒绝结构不合法和不兼容候选。** 增补绝对路径、UNC/盘符、控制字符、Windows ADS/保留名/尾点空格、不区分大小写冲突、文件与目录前缀冲突、保留 manifest 路径及严格 base64 校验；原有安全的相对路径规范化保持。应用/SDK/执行 host 兼容性复用 registry 的纯校验函数，在 native 安装写入前执行，避免不兼容升级先覆盖旧包。59 项包校验和 49 项 registry 回归通过，真实 Linux 拒绝四类候选后旧记录、安装文件和文档字节不变。没有新增任意包大小配额；这些校验不等于任意恶意插件代码的安全沙箱。

**首次输出区分“正在准备”和“永久不完整”。** Core 与公开 SDK 0.3.6 增加严格的 `pending?: true`，仅允许与 `complete:false` 一起使用。独立 footnotes 1.0.1 在当前文档版本的索引仍在运行时返回该字段。宿主只重试明确 pending 的 provider，每 250ms 一次，使用原有每 Markdown window 的绝对 10 秒准备截止；永久 incomplete 仍立即保留源码并说明原因。原生 owner 从 dispatch 开始的 2 秒执行截止不变。取消、过期版本、迟到结果及原有大小预算继续生效。

**输出绑定完整 renderer 集合与激活代次。** 捕获期间观察到 provider 增删或重新激活，即永久标记该 capture 失效；即使集合后来恢复相同，也不能发布混合结果。每个已接受 owner 在最终聚合发布前再次检查，覆盖先完成 A、等待 B 时 A 已被替换的情况。presentation revoked 在输出层解释为 snapshot stale，而不是误报输出插件权限被撤回。真实 desktop 的 screen/output 两条路径均传入可信 manager generation；通用可选 callback 缺省不能检测同 ID 重启。本轮未改变生命周期 epoch 的原有递增语义，因此不能由这些检查推断兼容直接升级或 reload 已有完整事务保障。

以上修复有修前失败与修后断言：[准备链说明](evidence/v2-product-phase6-plugin-lifecycle/milestone01/readiness/README.md)、[包校验证据](evidence/v2-product-phase6-plugin-lifecycle/milestone01/package-validation/README.md)、[安装预检](evidence/v2-product-phase6-plugin-lifecycle/milestone01/preflight/README.md)。取消和 owner 变更的证明来自本轮确定性 RPC/服务测试；本轮没有新的原生取消运行，不借用历史 P5 结果冒充本轮验收。

## 独立公开 SDK 消费

脚注 1.0.1 与官方大纲 1.3.1 均在仓库外只使用公开 SDK 0.3.6 构建，分别通过 29 和 24 项测试、类型与依赖闭包检查。大纲功能源码未改，没有宿主插件 ID 特判；README 更新了独立安装示例。只读 document Worker 沿用现有最小权限策略，不伪造一个并不存在的额外审批按钮。

修复构建工具把冻结插件的 SDK 版本误要求与当前宿主版本相同的问题。已审查的 vendor SDK tar 按各插件指纹选择，使用有界内存 tar 解析和完整成员字节验证；不解压链接、不从宿主源码补类型。23 项构建合同回归通过，十个内置包 staging 成功，diagrams 保持 1.1.1 / SDK 0.3.4 的原审核字节。全体插件的外部独立安装验证器没有重新全跑；不能把十包 staging 当成十包外部安装验收。

| 本地交付                                        | SHA-256                                                            |
| ----------------------------------------------- | ------------------------------------------------------------------ |
| SDK `milkup-plugin-sdk-0.3.6.tgz`               | `2043b0586c73579c06821c76a20eb0d7a852ffd7c7e8181ea555433a0c506cec` |
| 独立脚注 `milkup.footnotes-1.0.1.milkup-plugin` | `cf495f6bdf22dc6b24143a06fc34fdce8d2b2ecab90b8296b85fb49773b692a2` |
| 独立大纲 `milkup.outline-1.3.1.milkup-plugin`   | `7eea6ffb5bba53155b3c256c6e35d95b04a93199ebbbd04636ee9c7ec5f6f712` |
| 正式 Linux ELF                                  | `58652f2cea9361b6ee562a65f7405259f2320f9ac170bf9598a798e58905789e` |

完整路径和构建来源在证据索引中。独立脚注包与仓库 staging 包因构建路径注释字节不同，不声称二者 SHA 一致。此前两份正式构建未用于最终 UI 验收，保留为 superseded 记录。

## 真实 Linux 检查点

原生 UI 使用上述正式 ELF、真实安装的独立包、新建配置和原生 WebKit；保留现有命名空间沙盒。冷输出没有显式预热或重复打印。这里“首次输出”不等于“该 renderer 首次执行”，编辑器可能先请求 screen 呈现。

| 场景                                  | 实际结果与界限                                                                                                                                                                                                                                |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `p6-outline-03`                       | 独立大纲安装、启用、禁用、重启用、卸载通过；禁用/卸载后编辑、撤销和保存 SHA 精确。实际截图是 source 模式；历史文件名 `outline-live.png` 不算 live 覆盖。没有独立 Worker OS PID，不能据此证明全部内部资源清理。                                |
| `p6-reject-01`                        | 损坏 JSON、文件/目录冲突、非法 base64、不兼容 SDK 均明确拒绝；旧记录、包文件哈希及源文档不变，随后编辑/撤销/保存通过。                                                                                                                        |
| `p6-matrix-01`                        | 16 个列表单元（明暗 × 100/125/150/200 × 1280×900/760×520）及 8 个窄窗详情单元通过；保留焦点与实际像素；DOM 聚焦/命中检查不等于完整 Tab 遍历。原生 WebKit 内容缩放不等于操作系统 DPI。失败安装仍显示全局错误区，最终“错误只在详情”目标未完成。 |
| `p6-all-off-01`                       | 全部插件停用后，source/live 输入→撤销保存→重做保存→恢复原文保存，精确字节校验通过。                                                                                                                                                           |
| `p6-all-off-windowed-01`              | 2,101,585 字节、1,381,002 UTF-16、180,060 行文档，真实 native windowed 状态与 Ctrl-End 全文偏移成立；两种模式的输入/历史/保存完整性通过。                                                                                                     |
| `p6-cold-html-02`                     | 首次 HTML 与真实编辑后 r2 均通过；104 个正文标记各一次，真实 SVG 几何、两段 MathML、本地 PNG 原字节、脚注双向锚点通过；版本 0→1，r2 保存 SHA 精确且无旧标签。仅两条夹具预期图片警告，无 incomplete。                                          |
| `p6-cold-a4-01` / `p6-cold-letter-01` | 首次 A4 7 页、Letter 横向 10 页；实际图表、公式及脚注编号/返回引用可见，正文标记完整；仅两条图片警告。PDF 文本精确复制/搜索仍失败；Letter 警告独占第 10 页，分页问题未关闭。                                                                  |
| `p6-cold-print-02`                    | 全新配置首次 GTK Print-to-File 输出通过，7 页 PDF 留存；不依赖先打印一次，物理打印机未验。逐页视觉结论见独立审阅。                                                                                                                            |

首次驱动运行的父目录创建错误、大纲只读 Worker 审批按钮假设，HTML 将 aria-label 摘要误计为重复正文，以及 GTK 关闭文件选择框时 X11 枚举遇到 BadWindow 的失败均保留；修复驱动后使用新的运行目录，不覆盖失败产物。HTML 原件实际含一次脚注正文和一次辅助摘要，不能把原始 HTML 字符串出现两次当成可见正文重复。打印失败轮尚未产生 PDF；BadWindow 修订只重试观察，不把查询失败当作窗口已关闭。该失败轮 guardian 最终为 state=Z、parent=1，已不运行但未完全 reap；保留记录，不记为全部资源清理通过。

最终全仓检查：2,298 项 Vitest 与 4 项 Node 通过，全仓类型、版本核对、构建及 Rust 格式检查通过；最终构建产物与正式原生 ELF 的输入指纹一致。构建合同专项 23 项通过。全仓格式检查通过；证据完整性由冻结索引逐文件验证。既有 Vite chunk-size 警告保留，未改构建阈值。

完整[独立产物审阅](evidence/v2-product-phase6-plugin-lifecycle/milestone01/native-ui/review/readiness-comparison.md)记录 HTML 实际点击与 24 页 PDF 目检。实际像素对照：[P5 首次打印第 2 页](evidence/v2-product-phase5-export-print/milestone06/native/p5-m06-product-print-02/first.pdf.page-2.png) → [P6 首次打印第 2 页](evidence/v2-product-phase6-plugin-lifecycle/milestone01/native-ui/runs/p6-cold-print-02/cold-first.pdf.page-2.png)。同一原文中，旧版显示 `[^p5]` 源码，新版显示编号和返回引用。输出耗时记录只从 native dispatch 到 owner accepted；缺少 enqueue 时间，不能由这些成功样本推断队列等待、pending 重试次数或历史超时根因。

## 仍需父线程推进的 P6 工作

当前不兼容 preflight 不能代替兼容升级事务。安装仍逐文件覆盖，失败没有完整回滚；reload 仍可能先卸载旧实例；权限/host/network origin 变化尚未实现完整差异再审批；异常 Worker、启动失败和部分卸载路径的清理/恢复仍需故障注入及原生验收。普通管理卡片的已测布局通过，但全局失败错误详情迁移和独立管理扩展尚未实现。全停用保存验证不覆盖新的 I/O 故障或进程崩溃恢复。

[架构交接](evidence/v2-product-phase6-plugin-lifecycle/milestone01/architecture-handoff.md)与[两种事务方案](evidence/v2-product-phase6-plugin-lifecycle/milestone01/transaction-options.md)建议 A：由 native catalog 持有安装/审批/启用事实，使用不可变包代次和明确提交点，localStorage 为可重建镜像。替代 B 必须做完整 native WAL、决议与恢复，不能仅给升级加半套 journal。父线程需确定持久权威、候选激活的设置/副作用保护和回退保留策略，再冻结跨 native/前端合同。本检查点未擅自选择并实施这一迁移。

P5 的 PDF Unicode 精确复制/搜索、长块分页、历史 Print04 原生 2 秒超时仍开放；本轮首次 ready 修复不能关闭它们。遵照用户决定，产品保留现有 WebKit 依赖，不改用 Chromium 输出，也没有下载 Runtime。PDF 中本轮只证明脚注编号与返回引用可见；文件没有 link annotations，不宣称 PDF 内点击跳转。HTML 锚点解析与双向目标已单独核验。物理打印机、Windows/macOS 和系统 DPI 矩阵未验。

提交沿用仓库已记录的单次 `SKIP_SIMPLE_GIT_HOOKS=1`：遗留 hooks 仍调用 v2 未配置的 `npx lint-staged` 和不存在的 `scripts/verify-commit.js`。本轮实际 v2 全仓测试、类型、构建、格式及专项检查均已执行；未修改 hooks 或全局 Git 配置。
