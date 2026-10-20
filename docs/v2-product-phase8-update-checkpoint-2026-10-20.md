# P8 更新清单检查点

工作基线为 `5b62eb75615170f8a9cd8eede5fa42f275850ca7`，隔离分支为 `dot/milkup-v2-update-checkpoint`，功能候选为 `b2f0efaf6f1689cd709c49985e616c0c6a15957e`。本轮只推进更新链及 WFP 只读评估，未合并其他分支，未生成安装器、上传构建 artifact、设置正式渠道或执行安装。

## 修复与边界

原实现仅验证包字节的 minisign，HTTPS 清单中的版本没有独立签名；同一旧签名包可以被无签名清单标为新版本。清单完整 JSON 在解析前也没有正文大小上限。基线上的两项真实断言均失败，原始日志保留。

现在宿主要求签名 envelope，先验证精确 payload 字节，再读取 product、channel、规范 SemVer、平台 URL 和包签名。下载与安装都核对已认证字段，安装前再次验签。独立 updates 插件仍只取得不透明候选标识和状态，不能指定信任根、渠道、URL 或包字节。公开 SDK、插件实现及依赖锁文件未改；新增 Rust builder API 仅在已审查的本地 updater 补丁内。

清单累计正文限制为 256 KiB，包为 256 MiB，均在追加缓冲区前检查实际字节；Content-Length 是提前拒绝条件，不能替代实际读取计数。清单只接受 200/204，包只接受 200；拒绝全部重定向。检查具有总计 20 秒截止及 generation 撤销：先保留请求，再启动网络，取消和结果发布共用状态锁，旧结果不能复活或清除新请求。下载继续保留既有独立 epoch 和同候选重试语义。

**R05 部分修复，不是正式升级验收完成。** 这里认证的是发布者声明与下载字节的对应关系，尚未独立读取安装器内部的应用版本；签名者签错版本仍需发行构建门禁防止。没有持久化已见最高版本、服务器冻结检测或自动应用回滚。正文预算也不是整个进程 RSS 上限，同步有界验签/解析不具备指令级强制抢占。精确格式与合同见[更新清单协议](v2-update-manifest-protocol.md)。

## 本地验证

| 验证                    | 结果及范围                                                                                            |
| ----------------------- | ----------------------------------------------------------------------------------------------------- |
| 修复前行为回归          | 基线 2 项真实失败：超限清单被接受；旧签名包被无签名版本声明重标                                       |
| Rust 全库               | 199 通过、0 失败、5 忽略，包含最终 22 项更新测试；忽略项包含原生 GUI/PDF 与性能专用夹具，不能视为通过 |
| Rust 全目标检查         | `cargo check --offline --locked --all-targets` 通过                                                   |
| 全仓测试                | 2565 项 Vitest 和 4 项 desktop Node VM 测试通过；首次 Worker 截止失败另列下文                         |
| 宿主与文档转换定向测试  | 19 + 39 项通过                                                                                        |
| CI 合同及 vendor 完整性 | 61 项通过，包含补丁出处、31 个文件哈希及闭包检查                                                      |
| 类型、构建、格式        | 全 workspace typecheck/build 和全仓 Prettier 通过；既有大 chunk 及 Rust unused import 警告保留        |

浏览器更新交互的 14 项现有回归也通过，使用已有系统 Chromium 作为测试工具，实际运行独立 Worker 和公开 SDK；原生 transport 由 fixture 替代，因此不冒充 Tauri IPC、Windows GUI 或真实安装验收。这没有增加产品引擎依赖。

测试使用公开确定性的合成 minisign 材料和不可执行包字节，不含正式密钥。HTTP fixture 只解析到临时 loopback listener，不联系实际发布服务。覆盖被修改签名/正文、错误 key/product/channel、旧包替换、同版本/降级、字段突变、精确上限、chunked、虚报长度、截断、301/302/307/308 目的地零请求、取消/超时及迟到结果。

保留三个修复过程中的失败，不把重跑改写成首次通过：

- 新测试初版使用 `unwrap_err`，因 `Update` 没有 Debug 而编译失败；修正测试表达式后通过。
- 初次 pnpm wrapper 触发自动依赖安装，因用户目录权限在编译前失败。本地改用已有的固定 pnpm 11.7.0 并关闭隐式安装；没有改清单或 lock。
- 首次全仓测试在既有 `worker-supervisor-real.test.ts` 的主线程阻塞场景失败，kill timestamp 为 0；当时另有编译/格式任务，但未证实因果。未改 Worker 实现、夹具或 2 秒预算，随后同一全仓命令通过。该尾延迟风险继续开放。

## 平台与发行边界

同一功能候选的 [Windows CI01 / run 39373808628](https://github.com/Auto-Plugin/milkup/actions/runs/39373808628) 首次执行通过，15/15 阶段全部成功：冻结 workspace 还原、vendor/CI 合同、公开 SDK、11 个独立插件构建与类型、bundle staging、全仓测试/类型/构建、desktop 全目标检查、安装器启动失败回归、完整 Rust 库测试和生产 exe 链接。Windows 全仓同样为 2565 项 Vitest + 4 项 Node VM；Rust 185 通过、0 失败、3 忽略，另有 2 项 updater Windows 启动回归通过。所有阶段命令退出码为 0，检出源码未变。

生产 exe 的 SHA-256 为 `CA8ED97C15C40877CE2A907FB6F47C3E098B85BBBCF7526EF5E17F4F1A810DC2`，只保留链接及 manifest 证明，没有归档或上传 exe；Actions artifact 数为 0。工具链为 Node 24.19.0、pnpm 11.7.0、Rust 1.99.0，标准 Windows runner 的 OS 报告为 10.0.26100。十个 Worker 插件沿用已有独立构建的 legacy/non-frozen 边界，diagrams 保持既有审查过的冻结 SDK 0.3.4；本轮未将它们升级或改称全部冻结。

[冻结证据与离线校验器](evidence/v2-p8-update-checkpoint-20261020/README.md)包含原始 Actions 日志 ZIP、无改写解压日志、逐阶段 JSON、精确候选源码、远端提交身份及全部本地失败/通过记录。后续文档提交只增加报告和证据；实际完整受测源码是上列 `b2f0efaf…`。源码编译、单元测试和生产 exe 链接不等于已安装应用的 GUI、升级或回滚验证。

版本仍为 `2.0.0-beta.1`，SDK `0.3.7`、outline `1.3.3` 不变。正式 endpoint/publicKey 仍为空。R04、R07、R08 不因此关闭。Linux 保持现有依赖和 WebKit 补丁方向，未引入 Chromium 产品依赖。

[WFP 部署评估](v2-windows-wfp-deployment-assessment-2026-10-20.md)建议不把特权网络策略作为轻量普通用户版的默认 DOM/PDF 解法。本轮未运行新的 UDP 实验、写 WFP/防火墙、提权或安装服务；原生重复 UDP 反例和 Windows DOM/PDF 关闭状态保持不变。
