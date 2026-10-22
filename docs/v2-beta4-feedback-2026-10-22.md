# beta.4 用户复测修复

独立分支 `dot/milkup-v2-beta4-feedback`，产品基线 `f40ff18dba33b42754af160739342faa3b4359a2`，起点报告提交 `546d096b6567d90543da180b3adb49506fb7d55b`。作者 LarryZhu-dev；不合并主线、不发布 Release。

## 最终实现

- 卡片开关是宿主启禁入口。一次显式手势在同一生命周期队列中绑定 revision、transaction、generation 和能力指纹，内部批准后受限试运行、提交。后台恢复与公共 `plugin.enable` action 不因此获得自动批准能力。详情移除审批、拒绝、撤销审批和启禁按钮；reload 仅重载已经启用的 active，不提升 pending。
- 卡片直接提供控制面板，更多菜单提供插件命令及宿主动作；统一 Lucide 图标。移除主菜单插件面板分组，保留窄窗、键盘焦点、SVG 点击和异步切换焦点。
- 更新为 About 内置单例，启动前先完成旧 `milkup.updates` 保留数据的退出迁移。旧 ID 隐藏并拒绝重导入；迁移失败不启动新检查。检查失败或未配置不误报最新/不亮红点；取消、晚结果、下载校验和安装前保存保护仍复用既有原生链。没有配置真实发布端点或密钥。
- Windows 使用独立 `milkup.diagrams` 1.2.0 Worker 归档；Linux 保留 1.1.1 官方完整 DOM 引擎。平台库存每次仅选择一个同 ID 归档。Worker 使用可追溯的固定 Mermaid 12.2.0 parser 字节和受限布局，输出现有封闭 typed vector；不执行完整 Mermaid DOM 渲染器，不改 DOM/PDF 门禁。

## 图表和旧安装边界

支持基础 TD/TB/LR 无环流程图、简单时序图；未知语法、循环、跨层边、复杂布局、HTML/Markdown 标签、链接、配置和超额输入明确回退到完整源码。正文最多 8192 UTF-16 字符、128 行、20 节点、32 边、6 参与者、16 消息、24 字符标签，布局最多 4096×4096；输出仍通过宿主验证，既有独立 Worker 2 秒期限不变。静态输出本身不替代生成过程的隔离证明。

旧 beta.3 Diagrams receipt 只按宿主显式历史路径名单识别。卡片 ON 才从闭合随包索引选取更高版本；不替换用户自装 pending、tombstone 或不明来源。原生 prepare 的可选内部 replacement 在同锁、同 revision 下核对旧 transaction、generation、fingerprint、source 后暂存新 sealed 包，再一次保存替换候选。记录真实新来源及旧来源审计，不用旧文件名冒充新包来源。不确定 IPC 结果回读权威，但该次失败手势不继续批准。

损坏旧 sealed 候选安全拒绝；stage/save 失败可留下未引用暂存目录，由已有 GC 回收。用户 data/storage 不删除。没有新增 SDK/插件调用权限或新的 Tauri command。

## 验证记录

红绿日志、像素截图和后续产物记录见 `docs/evidence/v2-beta4-feedback/`。当前代码检查包括：2697 项工作区 Vitest、4 项 DOM bootstrap JS、140 项相关 TS、41 项 native catalog Rust 与 4 项跨进程用例；全仓类型及格式检查。Diagrams 仓库外 public SDK 0.3.8 构建、48 项测试及实际 Chromium Worker RPC/EditorView 通过，入口与归档哈希见证据。

浏览器原批保留失败：开发服务器启动常量仍为 beta.3；一项设置全流程耗尽 30 秒预算；旧 formatting helper 寻找已删除的审批按钮；一次 route.fetch ECONNRESET。对应修正和原预算复验单独记录：shell 原批 54/59，通过修正测试入口后的 5/5 复验；设置/快捷键/工作区/About 原批 36/38，最终 beta.4 服务 About 17 项和原超时设置场景共 18/18 通过。不删除失败，也不将测试入口变化写成产品修复。最终生产二进制与 Windows 构建须独立核验，开发服务器截图不代替安装包证明。

## 交付与未验收

目标为 `2.0.0-beta.4` Windows x64 小型未签名 NSIS，沿用已批准的 Auto-Plugin/milkup Actions artifacts 和对话交付，保留一天；精确源码、EXE/ZIP 哈希、插件清单及实际下载链接将在终态交付记录补齐。手测指南和副本样本位于 `docs/manual-windows-beta4/`、`tests/fixtures/manual-beta4/`。

不执行安装器，不上传到其他目的地。Windows GUI、IME、系统 DPI、实际升级/健康确认/回滚仍须真实验收；Linux Chromium/WebKit 结果不冒充 Windows。当前签名渠道未配置，Windows 独立 DOM/PDF 仍关闭；新版 Worker 不等于完整 Mermaid 支持。
