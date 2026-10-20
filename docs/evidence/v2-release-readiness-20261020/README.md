# 发布就绪只读审计

[简短总览](../../v2-release-readiness-summary-2026-10-20.md) · [准确技术附录](../../v2-release-readiness-technical-appendix-2026-10-20.md)

基线 `31e05d2cd7f5f53a027c32309a7e451488339a41`，报告分支 `dot/milkup-v2-release-readiness-summary`。本次仅读取既有 Git 对象、报告、清单及 GitHub 元数据，没有产品修改、新实验、测试运行、构建、安装器/Runtime 下载或 artifact 上传。

| 记录                                                                                                                                | 内容                                                                                        |
| ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| [remote-heads.txt](remote-heads.txt) / [branch-audit.json](branch-audit.json)                                                       | 当次实际远端 HEAD；祖先关系和限定应用源码范围的差异，不是未来分支不变的承诺                 |
| [code-equivalence.json](code-equivalence.json)                                                                                      | b2→cf7、W1→W0报告、cf7→证据线的精确差异；不把源码等同二进制                                 |
| [github-artifacts-runs.json](github-artifacts-runs.json)                                                                            | 2026-10-20 08:17 UTC 只读 API 原结果：最早包未过期，后两包 404；当前关键 Windows run 成功   |
| [run-39373808628-artifacts.json](run-39373808628-artifacts.json) / [run-39362396405-artifacts.json](run-39362396405-artifacts.json) | 最新更新/W1源码检查均未上传 artifact                                                        |
| [package-source-matrix.json](package-source-matrix.json)                                                                            | 三份旧包源码与各功能提交的 Git 祖先关系，根 package/Tauri/实际安装器版本分开                |
| [plugin-inventory.json](plugin-inventory.json)                                                                                      | 12份源码 manifest、11份既有暂存包与版本/哈希；export-print 单独列出；不是新增构建或安装验证 |
| [checkpoint-archives.json](checkpoint-archives.json)                                                                                | 从已有 Git blob 读取六份关键 archive，SHA与各自原索引一致；没有重跑实验                     |
| [audit-scope.json](audit-scope.json)                                                                                                | 本轮范围、身份配置、三项上传请求 disabled/consumed 与原文件哈希                             |

`branch-audit.json` 的 `runtimeDifferencesExcludingTests` 是指定 apps/packages/plugins/vendor/release/根清单范围排除测试后的文件差异，仍可能包含该范围内的 README/manifest；它不是执行语义证明。候选分支的四项差异在技术附录逐项列明。

只读核对脚本最初假设源码包数等于11预装包，在写入清单前断言失败；查阅配置后正确区分12源码/11预装，记录已保留于 inventory。两处索引文件名/字段读取假设也在按实际文件结构读取后纠正；它们不是产品测试或实验结果。

所有 JSON 为本次观察的格式化副本，无正文/凭据。历史安装器 SHA 来自已有 manifest，本轮没有重新下载核验其字节；Library 只有历史回执引用，未声称本次验证可下载。缺陷、未验和权限边界以报告列明的时点为准。
