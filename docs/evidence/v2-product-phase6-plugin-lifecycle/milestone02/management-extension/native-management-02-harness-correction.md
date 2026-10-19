# management-02：诊断投影断言修正

原始失败运行 `../native-ui/runs/p6-m02-management-02/` 保持不变。production05 已完成候选拒绝步骤；随后旧 harness 错误地要求公开管理 modal 包含两条原始 native 诊断。实际 modal 已显示两条 `catalog-diagnostic` 与 `Plugin lifecycle needs attention. Open host details for the full diagnostic.`，符合故意不泄漏原始 native 消息/路径的公开合同。这次失败归类为 **harness expectation**，不是移除诊断验证，也不是产品修复。

仅修改 `tests/native/tauri-p6-management.mjs`：

- 保留 native 两条 `Candidate aborted; old installation retained` 的精确断言。
- 公开 modal 必须有准确两条通用 code/message，并且不包含原始 native 消息及 profile/output/dataRoot/storageRoot/packageRoot/sourcePath。
- 通过真实 trusted command 导航宿主详情；现有 navigate 函数仍断言整个 native catalog 前后相等。
- 在可信宿主 `.plugin-detail .plugin-errors` 核对原始诊断准确出现两次，并再次核对该 entry 不变，保存 projection JSON 与截图观察。

Prettier与`node --check`通过；未启动UI、未改产品。冻结脚本 SHA256：`9a0b651539bf3740a335971e8e9f7b619772ff9b4c9158747bb96d1aa21a1984`。后续management03结果由Root执行后记录，不将02失败改记通过。
