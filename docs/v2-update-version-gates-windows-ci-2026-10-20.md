# 更新版本门禁：Windows 原生 CI 补验（2026-10-20）

本轮针对隔离分支 `dot/milkup-v2-update-version-gates`，补验产品候选 `e63aa104682a3133050c793ec48549100b5bbf35` 的 Windows 编译和原生单元测试。最终受测源码为 `edca2e7d00c7d3e2db32248473f24e2d2b964b27`。后续文档/证据提交与受测源码分开标识，不能将报告提交 SHA 当作已运行 CI 的 SHA。

## 变更和授权范围

用户明确批准当前分支加入既有 Windows CI 允许名单；`bdf2c8a0a5c740836bcf080a4087957f56ae33bd` 仅修改工作流、来源校验脚本和对应合同测试。保留原 `windows-2025`、60 分钟上限、`contents: read`、精确 SHA checkout、祖先/提交标记门禁、零 Actions artifact 和既有检查阶段。未运行安装器、未上传构建产物、未配置真实端点/密钥或接受新许可；没有合并或发布。

首轮 [39401465787](https://github.com/Auto-Plugin/milkup/actions/runs/39401465787) 使用 bdf2c8a0，15 阶段中 14 通过。Windows 全库单测为 **200 通过、1 失败、3 项既有忽略**；失败是 `checkpoint_signed_manifest_and_artifact_verify_end_to_end_without_installing`，错误为“Windows 更新包的版本资源缺失、损坏或不受支持”。旧正向测试下载的是纯文本样本，新资源门禁正确拒绝了该样本。Windows 生产程序编译链接已通过。

`edca2e7d` 仅将该正向测试换为已存在、真实测试签名的惰性 PE 样本，并显式使用 `windows-x86_64`，让 Linux 也执行相同资源验证。样本没有可运行代码/入口点，测试从未执行它。没有跳过测试、绕过资源校验或修改产品逻辑。修复后 Linux 更新模块 39 项通过、Rust 格式检查通过。

## 第二轮精确提交验证

[39404325605](https://github.com/Auto-Plugin/milkup/actions/runs/39404325605)，受测提交 **edca2e7d00c7d3e2db32248473f24e2d2b964b27**，15 阶段全部通过；API 核验 Actions artifacts 数量为 **0**。GitHub author/committer 均为 LarryZhu-dev，提交邮箱为 larryzhu@foxmail.com。

| 检查                         | 结果                                                                                                          |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Windows 全库 Rust 原生单测   | **201 通过、0 失败、3 项既有忽略**，cargo exit 0；原始测试可执行文件的 Common Controls 6 清单核验通过         |
| Windows updater 启动错误回归 | 2 通过，先检查测试枚举非空；未执行真实安装器                                                                  |
| 全目标 Rust 检查             | `cargo check --locked --all-targets` 通过                                                                     |
| Windows 生产程序             | release `milkup-desktop` + `tauri/custom-protocol` 编译链接通过；原始 EXE 资源清单核验通过，读取前后 SHA 一致 |
| 工作区测试、类型、构建       | 2,565 Vitest + 4 Node 通过；typecheck/build 通过                                                              |
| 11 个独立公开插件            | 构建、测试、类型和临时暂存全部通过；updates 1.0.1 使用 SDK 0.3.7，19 测试通过                                 |
| 工作流、来源和 vendor 合同   | 通过；最终 tracked source 未改变                                                                              |
| 上传与安装边界               | 0 Actions artifacts；未打包或运行真实安装器，未上传 EXE                                                       |

生产编译输出 SHA-256：`8a1f4b402385aa79a541347313716656c511ee1d77f1a04f0d813871dcac1782`。该 hash 标识本轮编译结果，不是安装验收或可复现构建证明。唯一 GitHub warning 是既有 pinned Actions 的 Node 20 声明被平台切换至 Node 24；未改 Actions 版本。

既有 3 个忽略项为 picker 子进程夹具、Windows ownership 子进程夹具和显式搜索性能基线；前两个由对应实际协议测试调用，后一个不在本轮性能范围内。本轮没有新增忽略项。

CI 里的生产 EXE 仅编译、链接及只读资源检查；没有启动完整应用。WebView2 文件存在性探测不代表 GUI、受限令牌、安装或 Runtime 执行验证。十个 Worker 独立构建继续沿用明确标记的 legacy/non-frozen 流程；diagrams 使用既有冻结 SDK 0.3.4，未借本轮更改依赖策略。

## 兼容性、重试与恢复复核

| 项目                   | 结论与边界                                                                                                                                                                                           |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 旧客户端读取新签名清单 | schema=1 签名解码逻辑与 cf7d407d 相同，release JSON 可包含新增 freshness 字段；旧客户端不会因此获得有效期/水位强制策略。                                                                             |
| 新客户端读取旧清单     | 配置渠道后明确拒绝缺失 sequence/issuedAt/expiresAt 的清单；HTTP 204 不作为可信“无更新”结论。发布端应先提供新签名字段，再启用新宿主策略。本轮渠道仍为空。                                             |
| 水位与失败重试         | 已接受记录支持重开、同声明重试、过期后的新签名续期。锁争用解除可重试；提交失败清除检查保留位，取消/迟到检查不会提交水位。提交失败重试使用受控错误回调；未完成磁盘满/断电矩阵。                       |
| 损坏状态恢复           | 截断、超限或范围错误的状态保留原文件并拒绝更新，不会自动删除水位。人工恢复/重新信任流程尚未实现；不能宣称损坏状态可自行修复。账户所有者删除或篡改历史状态不在保护范围内。                            |
| 签名撤回               | 更高序号和正确 rollbackFrom 可以撤回最高候选，最高已见版本不下降；已授权较低候选可重试、续期。宿主仍拒绝已安装应用降级，因此这不是已安装二进制回滚。                                                 |
| updates 1.0.1          | host 2.0.0-beta.1、SDK 0.3.7 满足声明范围。仓库外仅用公开打包 SDK 四个文件和既有工具验证：19 测试、类型、构建通过；之前 SDK 0.2.0 结果保留。                                                         |
| 既有预装包             | `apps/desktop/src/bundled-plugins/milkup.updates-1.0.0.milkup-plugin` 保持不变，SHA-256 `54787d509ff204a295476f29c7376017f739b0512d8291366cf000c0a0e8b010`。CI 临时暂存 1.0.1 不等于已替换发行资源。 |

## 证据与仍开放事项

归档：[v2-update-version-gates-windows-ci-20261020.zip](./evidence/v2-update-version-gates-windows-ci-20261020.zip)，491,389 bytes，SHA-256 `1ac283f403097d36bd63cfb633498b09fdf7bc768c6fa81f0799b12e7431526e`。共 42 个成员，`index.json` 对其余 41 个成员逐项记录并复核 hash。归档保留首轮真实失败、第二轮完整日志、API 元数据、15 阶段记录、精确源码差异和独立 SDK 兼容结果。没有 Actions artifact 上传或安装器；[旧版本门禁原始 RED/GREEN 归档](./evidence/v2-update-version-gates-20261020.zip)保持原样。

Windows 源码编译和原生单测不能替代真实安装升级、GUI/IME 或健康回滚。外层 PE 资源一致性不是 NSIS 压缩载荷内应用版本证明。Linux/macOS 包内版本、发布端签名时序、损坏状态人工恢复、实际健康确认和二进制回滚仍待补齐。DOM/PDF、P7、未接受的大纲候选均不在本轮修改范围内。
