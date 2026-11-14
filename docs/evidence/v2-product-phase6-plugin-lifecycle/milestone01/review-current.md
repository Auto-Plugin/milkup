# P6 当前工作树独立复审

基线 `1388f646703ba19c4ed501b0450d123e70388f9a`；2026-10-19 只读复审。未重复运行测试/UI/Cargo；测试结果引用实施者已保存的日志，不新增通过数。审阅 package、manager preflight/generation、pending core/SDK、RPC验证链、service/collector/output/main 接线、footnotes 及外部构建脚本生产 diff。构建脚本新增变化也已查看。

## 实质发现与处理

1. **发现并已由 root 修正：已完成 provider 的旧结果可越过最终聚合。** 原实现只在每个 renderOne await 后校验 epoch；A先完成、B继续准备时 A 禁用再启用，A旧 fragments 仍可发布。当前 service 的 acceptedRenderers 保存成功验证的 owner，所有异步单元结束后同步重验；collector 对起始 epoch 做跨窗口末尾检查，补上早完成窗口存活过久的问题。root 已保存相应 RED/GREEN；本审阅只确认代码处理路径，没有重跑。
2. **契约必须准确：epoch 改变撤销整次 capture。** service 最后 throw revoked 不经过 collector 内部 render 回调的 warning catch。root 已明确采用整次捕获失败、无输出，而不是自动回退原文。稳定 owner 的永久 incomplete 才走可见源码 fallback。调用方应在稳定插件集合后发起新的捕获，不能把生命周期撤回与“首次索引要重复打印”混为一谈。
3. **发现并已由 root 修正：新增/瞬时 provider 集合变化。** 单纯末尾比较起始 owner 集合漏掉 A→A,C→A 时中间 C 已贡献的片段。当前 `readStableRenderers()` 在 service 的 declaration/active 读取、collector 的派发 lookup、最终发布三处统一比较初始 `(pluginId, rendererId, generation)` Map；发现不一致即 sticky revoked，即使 service 将单 provider rejection 变 incomplete，最终也不会发布。瞬时 C 不会被派发/接纳；观察间隙内发生且没有产生任何结果的变更无需另加监控框架。root 已补对应三窗口 RED/回归；本审阅仅确认最终代码路径，未重跑。

当前审阅发现的发布边界已在源码上处理，无新的阻塞项。rich 收集结束即形成冻结快照；之后资源嵌入/目标选择不追溯重渲染。owner 硬2秒超时会撤销实例/改变集合，因此按新契约可导致整次 capture revoked；稳定 owner 的普通永久 incomplete 或不改变实例的 preparation budget 失败仍保留既有 fallback 语义。这是需要明确说明的产品区别，不能把原先期待 fallback 的测试仅改数值而省掉“2秒停止、只撤回一次、late result 不发布”的严格断言。

## 其余审阅结论

- **pending 合同**：仅允许字面量 true 且 complete=false；closed result schema、原有范围/节点/尺寸检查保留。aggregate copy 复用同一校验；service 对 text/fence 两分支累积 pending。RPC/module/runtime 继续经过 core copy，新增 transport 回归覆盖传递，不需要改变执行协议或硬截止。
- **footnotes**：只有当前 document/version 的索引尚未完成且无永久 partialReason、未取消时发 pending；unknown context、dispose、错误/超限和完成不伪装仍在准备。SDK 0.3.6 与 footnotes 1.0.1/min SDK 同步声明，旧 host 不接收新字段。render 返回快，后台 scan 仍受原有数据预算和取消控制。该方案不声称解决历史 WebKit 2秒冷启动超时。
- **collector**：pending-only 250ms 重试，不把普通 incomplete 当 ready；一份绝对 preparation deadline 和 cancellation promise 跨重试复用，前后时钟检查覆盖延迟 timer 交付；owner 每次执行硬2秒不变。保存已完成其它 provider 的结果是合理优化，但必须保持上述最终发布校验。10秒是 service provide/window 的预算，不是整个大文档的新全局 SLA。
- **preflight**：parsed manifest/allowedHosts/shared registry compatibility 在 installPackage、ensureDataDirectories、registry.install 之前。新不兼容包只生成 install failure；旧 enabled 安装直接更新遭拒时不卸载或改审批。当前 fixed allowedHosts 包含三种已知 host；backend 此平台不可用与 manifest host 非法是不同阶段，不能称安装检查证明 backend 可用。
- **package**：先规范化和校验所有文件再返回 archive；拒绝 absolute/UNC/drive/ADS/control、Windows-invalid/device/trailing aliases、case duplicate、双向 file/directory conflict、保留根 plugin.json。main 在 archive 内必须有内容；独立开发 manifest 未被此规则改变。base64 扫描严格标准 padding/unused bits，不解码分配；空文件合法。没有发现新增解析接受非法 base64 的分支。不是完整 Windows/macOS 文件系统同一性证明（Unicode/case-fold 等平台语义仍不可夸大），也不是 native symlink write 防护。
- **包兼容证据**：已有20份真实档案对照19通过、1份废旧 export-print manifest 两边同拒绝、0新回归；当前 bundled 10份全过，5.7MiB Mermaid 通过。该证据不覆盖任意历史第三方宽松 base64/路径格式；这次严格格式调整是有意兼容边界。
- **独立 SDK 构建**：新 frozen SDK artifact 读取固定四个 tar member，先验证reviewed hash，再限制压缩/解压/member预算、USTAR类型/校验和/路径/重复/尾部，不提取任意路径或链接；installed SDK 所有成员与该 artifact 逐字节核对，记录实际 SDK版本及 tar hash。避免强迫旧 frozen Mermaid closure 使用当前host SDK。legacy 非冻结外部构建没有被包装成完整冻结依赖证明。

## 不能成立的阶段完成声明

P6-01 仍无通用安装 byte/file-count/depth quota；本轮按授权避免任意小上限破坏 Mermaid。P6-03 写入/启动失败回退未做；reload 仍会在读取候选前先卸载旧实例。权限 origins scope delta、install/approve 生命周期串行、删除失败恢复、损坏 registry 半恢复、普通 Worker crash/cleanup failure 仍是前次审计中的开放项。现有测试通过或本次 preflight 不能将这些标为完成。

安全边界沿用既有声明：Worker broker/执行隔离不等于任意恶意 JS 的完整沙箱；sidecar 是显式批准的原生代码，直接 child kill 不等于全部后代清理。Linux 路径检查单测不是 Windows 运行验收；P5 PDF文字/长块分页/历史超时不因 pending 修复而结案。

后续方案见同目录 `transaction-options.md`。此审阅没有产品修改。
