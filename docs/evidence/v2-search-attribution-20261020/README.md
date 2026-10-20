# 首次搜索归因证据

**没有性能修复，原 500 ms 门槛仍开放。** [完整报告](../../v2-search-attribution-2026-10-20.md)。精确基线 `67cab4650973e4fba3fd26950b6b68ae5d09dc11`，隔离分支 `dot/milkup-v2-search-attribution`。

新增两轮保持原夹具、20 次编辑、查询 `A`、150 ms 防抖和 keydown→DOM→两次 rAF 边界：Source **491 ms**，Live **595 ms（失败）**。286 条观察、242 条真实键盘计时、8 个精确历史保存态、12 项成功原生功能检查；首轮观察器时序错误及其 exit 1 完整保留。不是 p95、冷 OS/磁盘或 Windows 验证。

[evidence.zip](evidence.zip)：656,216 字节，137 个成员，SHA256 `595339735aa15c544bcef9eb9cd98e9caee05b44f82b8b97bd0d9590a4abdbad`。逐成员哈希见 [manifest.json](manifest.json)。包括阶段原始记录、源文件/补丁、构建证明、全部样本/失败/截图、全仓检查和进程清理。未包含 ELF、安装器、依赖或插件包。

```sh
python3 docs/evidence/v2-search-attribution-20261020/verify.py
python3 docs/evidence/v2-search-attribution-20261020/verify.py --performance
```

第一条校验证据自洽，成功退出 0；第二条保持原性能失败，预期退出 1。不要将 harness 正常结束或归档完整性通过解释为性能预算通过。

原始观察可按归档中的 `analyze.py` 重新计算；与旧 858 条样本的关联保存在 `preparation/baseline-reference.json`，原归档仍在[上一检查点](../v2-p7-input-search-20261020/README.md)。实验只进行了预先列出的两次计时，没有择优重跑。

诊断重放须在**独立、干净且精确为 67cab465 的 checkout** 中进行：应用 `preparation/tracked-diagnostic.patch`，再从 `diagnostic-source/apps/desktop/src/` 复制新增的 `search-diagnostics.ts` 与 `search-diagnostics.test.ts`。以 `MILKUP_SEARCH_DIAGNOSTICS=1` 使用现有离线构建环境构建 Tauri `--no-bundle --ci`。归档中的运行脚本含本执行器绝对路径和冻结 ELF 哈希，迁移时必须重新冻结实际构建并记录新证明，不能假用旧 SHA。最终分支没有保留这些产品诊断改动。

普通回归脚本新增结果前后导航与有界观测；`MILKUP_SEARCH_DOCUMENT_SWITCH_CHECK=1` 是需要上述诊断构建的可选跨文档原生测试，不应对普通构建开启。确定性迟到结果测试无需诊断开关。

已直接查看的实际 PNG：[Source 最终保存态](source-final.png)、[Live 搜索 1/4](live-search.png)。副本与 ZIP 原图逐字节相同；只是状态证据，不是性能截图或像素修复证明。

全仓测试、类型、构建、格式检查通过，最终默认前端无诊断标记。产品、公共 SDK、插件/大纲、依赖和系统设置未改；无合并、Release 或 Windows 安装器操作。
