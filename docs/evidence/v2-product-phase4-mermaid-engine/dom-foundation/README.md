# DOM host 基础实现与 transport 检查点证据

本目录用于审阅 TypeScript 基础实现及 mock transport，**不代表 native 命令、独立 DOM 安全边界或产品端到端已经交付**。没有在本次归档中运行测试，也没有修改产品、主报告或原始证据。

## 原始红测与修复顺序

1. 首次新 host 红测：plugin 为 **28 失败、10 通过（3 文件）**，desktop 为 **9 失败（1 文件）**，两条命令退出码均为 1。正向 manifest/package/registry/manager 都遇到 `Unknown plugin host: dom`；负向 manifest 缺少预期的 DOM 专属 main/contribution/origin 错误。没有 import/transform 错误；manager 生命周期断言当时尚未越过 manifest 安装门禁，所以不能把它描述成已经独立复现了 lease 生命周期失败。
2. 实现后 plugin 新旧 focused 为 **114 通过（6 文件）**。desktop 随包安装新增回归为 **3 失败、47 通过（3 文件）**：旧的 Worker-only distribution guard 阻止 DOM 安装，后续 `Unknown plugin registry record` 是未安装的级联结果。
3. 将严格 DOM profile 纳入通用随包安装后，desktop 新旧 manager 与 bundled 回归 **50/50 通过（3 文件）**。覆盖首装批准并启用、用户已有版本不覆盖、卸载不重装、缺 native backend 时应用 startup 不被拒绝，以及非只读 DOM 包不安装/批准；没有插件 ID 特判。
4. 首次 plugin 类型检查退出 2：`it.each` 的权限数组行被当作位置参数展开，出现 TS2345。此前运行通过的相关负向例并未忠实传入预期的权限数组，因此不能拿先前的 114 通过掩盖这个夹具问题。只将参数行改为 `{ permissions }`，保留原断言；随后 manifest **32/32 通过**，plugin 类型检查通过。其他 focused 测试未因该夹具修正改变。
5. desktop 类型检查通过；九个基础实现/测试文件的局部 Prettier write 与 check 通过。所有首次失败和最后通过日志均保留；这里不是全仓测试、浏览器或原生验收。
6. transport owner 补充：DOM mock transport **15 项**加既有 sidecar **9 项**，共 **24/24 通过（2 文件）**；desktop 类型检查通过。它们验证 mock invoke/listen、可信 envelope/实例代次等适配行为，不执行真实 native DOM 命令，也不能证明 sandbox、网络/资源边界或真实两秒硬终止。

完整命令、开始/结束时间和退出码见 [首次红测 execution](dom-host-red-run/execution.json.txt) 与 [实现检查 execution](dom-host-implementation-run/execution.json.txt)。transport 的[执行元数据](dom-host-implementation-run/transport-execution.json.txt)由 owner 补录原命令、工具完成记录及确认的退出码 0，不是重新运行。原始日志本身没有完整 shell 命令/退出码；缺失的 shell 开始/结束时间保留为 null，未反向补造。focused 日志仅记录 Vitest 的 Start at 和 duration。

## 范围与保留边界

基础实现涉及严格 `host:dom`、包内 UTF-8 main、只有 documentRenderers/document:read、host 审批隔离、host 变更不沿用 enabled 状态、native opaque lease 判别、DOM loader 直连和 callbacks-only。manager 的启用路径及 PluginRuntime broker providers 均对 DOM 阻断 broker 创建；不经 Worker 中转，也不修改两秒预算。

main/transport 接线本次纳入源文件摘要，但 native 命令与完整安装/渲染/故障恢复链仍由后续交付验证。原始红测没有被改写成通过。原始日志、execution、分析及汇总统一追加 `.txt` 保存，避免格式化改变文本；`index.json` 列出源位置、字节数与原始/存储 SHA256。

## 本检查点源文件 SHA256

以下为归档时工作区文件的 SHA256，不表示这些变更已提交；当前 Git HEAD 记录于 index。

- `packages/plugin/src/manifest.ts`：`0ffa744290d463937ca727b8b6be615ff629db3c16ea052f7251865c6aca4c38`（35630 bytes）。
- `packages/plugin/src/package.ts`：`c8631b2fe2e91797e9493e24ed15fc36330a7996b5f887925da33bf43f16f2d1`（4750 bytes）。
- `packages/plugin/src/registry.ts`：`9e1ac9d598822f0bd35bcfb1e70eb4f8268c078646f1c9f84d8174254f09490d`（20599 bytes）。
- `packages/plugin/src/manifest-dom.test.ts`：`5139cb56bb096183d4359d03f87c9faf573a4f6316a9977f67ecbb81ae0ec5b7`（4285 bytes）。
- `packages/plugin/src/package-dom.test.ts`：`683b533bf1c6d2c36f7db96ec67ee46ae3ac5875c6e8f39f5071a7fd713ad411`（1762 bytes）。
- `packages/plugin/src/registry-dom.test.ts`：`19795e752d286620e8373d07a1525b907ee26d8bc762f9e7b1cccc6a75990503`（2224 bytes）。
- `apps/desktop/src/desktop-plugin-manager.ts`：`ad9441d56e45455e49cba8a354b3538bd53f76bc0cf18f332eb40390543f96dd`（73121 bytes）。
- `apps/desktop/src/desktop-plugin-manager-dom.test.ts`：`c23fc8c9bcb3be9761d9c332b9540d38e1b4b7ab6b2eb0d564b1b94d65023365`（9594 bytes）。
- `apps/desktop/src/bundled-plugins.test.ts`：`18eb20813e01d0b4cd9b8a22816739721df906f65be070e13d97904a461d6ab2`（10633 bytes）。
- `apps/desktop/src/main.ts`：`826a7a485a0d1117d1f08a625ac4f17672f31b86a404cce6bc57f890d81ed571`（191146 bytes）。
- `apps/desktop/src/plugin-dom.ts`：`0f46f362aa14ef4c79bd46412ede7dac4d557be2ef12eadb6370e6756771f663`（10111 bytes）。
- `apps/desktop/src/plugin-dom.test.ts`：`2dd453265d5f7841a79f076768040e4dad060b047bb7fbbd01a6b796d4fa3181`（18025 bytes）。

[完整证据索引](index.json)含 18 份原始文本副本及 12 个源文件摘要。
