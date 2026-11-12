# 候选分发与可信更新验收

本入口基于当前 beta.10 产品源码，不复用仅允许旧分支/旧插件库存的交付授权。
**新增打包入口不等于正式发行、实际安装验收或更新服务已经上线。**

## 三种明确的候选包

`.github/workflows/distribution-candidate.yml` 仅手动触发，必须指定与工作流 ref
一致的完整 `expected_sha`。三个独立 x64 runner 顺序执行：

| 变体             | 包                   | Web 引擎策略                                                                          |
| ---------------- | -------------------- | ------------------------------------------------------------------------------------- |
| windows-standard | 当前用户 NSIS        | 缺少 Evergreen WebView2 时下载官方 bootstrapper，需要网络                             |
| windows-offline  | 当前用户 NSIS        | 内嵌官方 Evergreen offline installer，安装时不依赖下载 Runtime；可能弹出 Runtime 提权 |
| linux-deb        | Debian/Ubuntu `.deb` | 系统 WebKitGTK 4.1、GTK 3；不代表所有 Linux 发行版                                    |

Linux PNG 图标是现有 ICO 内的 256×256 PNG 原字节，无重绘、无新图标。
所有变体使用相同源提交、锁定依赖、当前插件库存和正式前端生产构建。
每包单独记录 SHA-256、大小、源版本、Runtime 策略、渠道配置状态及未验证项。
脚本拒绝脏源、错误平台、错误 SHA、已有输出目录和显式签名凭据。
它不启用 updater 签名产物，不使用签名密钥，不推送 tag、Release 或部署。
`upload_candidates` 默认关闭；开启会额外占用存储，特别是离线包可能超过 200 MiB，
不是过去 50 MiB 试用包预算的延续授权。产物只保留一天，不能充当正式更新 CDN。

本地准备好锁定构建工具、系统依赖与插件构建输入后：

```sh
node scripts/release/build-candidate.mjs linux-deb /tmp/new-candidate "$(git rev-parse HEAD)"
```

Windows 应在已有的隔离 Windows 构建环境中运行对应变体。不要在用户原实例上
卸载系统 WebView2 来模拟缺失引擎。缺 Runtime、断网以及标准/管理员双账户验收应使用
可丢弃 VM；仅内嵌 Runtime 不能证明这些场景成功。当前入口不宣称安装验收。

## 更新通道发布门禁

`release/update-channel.json` 仍为空端点/null 公钥。关于窗口已有更新入口，但正式
更新不可用；不能填入假域名或公开测试 key 来显示“已配置”。

```sh
node scripts/release/update-readiness.mjs --candidate
node scripts/release/update-readiness.mjs --production
node scripts/release/update-readiness.mjs --verify envelope.json installer.exe windows-x86_64
```

第一条允许明确记录未配置；第二条在渠道为空时失败。第三条只读本地文件，以产品配置的
公钥独立验证清单及精确安装器字节的 minisign 签名（包括 trusted comment）、源版本、
渠道、平台、有效期与体积限制。拒绝 HTTP、凭据、fragment、占位地址和仓库公开测试 key。
不会创建密钥、写入产品配置、签名或联网。它是离线发布预检，不替代宿主版本/防回放
检查、线上 TLS/重定向/续期验收、PE 内版本校验或真实安装。

正式启用尚需：

1. 所有者确认最终直达 HTTPS 更新端点和包存储，安排最长七天清单有效期内持续续期，
   不使用 GitHub 下载重定向 URL 直接充当宿主下载地址。
2. 所有者提供并确认真实 minisign 公钥，私钥通过批准的签名流程保管；代码签名证书与
   更新签名是两件事。不要将私钥提交到仓库或发到聊天。
3. 同一公钥签署精确清单与安装器，单调增加 sequence；冻结/撤回策略见
   [更新合同](v2-update-manifest-protocol.md)。先做测试渠道端到端升级。
4. 对准确候选验证检查→下载→取消/重试→文档保存→原生确认→安装→重启→版本核对，
   以及坏签名、过期、断网、权限拒绝、安装中断、首次启动失败、用户数据保持。
5. Windows 标准/离线双包分别验收；Linux `.deb` 验证安装、升级、重装、卸载与文档保持。
   `.deb` 不属于当前内建 AppImage 自动替换路径，不得以此声称 Linux 应用内自动升级已完成。

## 恢复策略：当前不能声称自动回滚

应用目前没有安装事务/新版本健康握手/可验证旧程序恢复。候选 `rollbackFrom` 只允许
撤回尚未安装的候选，不会回退已安装应用。不要把“安装器启动成功”写为“更新成功”。

正式版前必须在隔离目标系统验证以下人工恢复路径，或实现并验收自动恢复后替换此约束：

- 发布者保留已验签且有明确版本/哈希的前一稳定安装包及离线说明。
- 更新失败时先备份用户配置和恢复数据，不删除或覆盖用户文档，不清空 update-trust。
- 首先重装同一已验签版本；确需旧版本时使用经批准的独立安装器并明确提示数据格式兼容风险。
- 在恢复后的程序中打开既有文档、恢复未保存副本、保存新副本，核验内容与插件配置。
- 记录故障、恢复版本、实际安装位置和文件摘要。未经此实际验证，恢复项保持未通过。

此文档是可执行验收清单，不是“恢复已完成”的证明。
