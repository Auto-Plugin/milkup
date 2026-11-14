# beta.6 Windows 菜单与浮层测试包交付

已交付候选 `6b3eeebad7ec433c6420bf5bbfadcf6a6710d20f`，版本 `2.0.0-beta.6`，独立分支 `dot/milkup-v2-beta6-ui-candidate`，作者 LarryZhu-dev `<larryzhu@foxmail.com>`（GitHub ID 40397402）。基线为已完成 Linux 生产验收的 `7cc4edc6747abf5fbc31b60cccf4bd73174af6f8`；本次候选相对该基线只调整版本、打包流程、契约检查和手测材料。

**完整官方 Mermaid 尚未完成，原型未进入此包。** 临时标准账户方案仍待用户批准，没有创建账户、凭据或更改令牌/系统设置。Windows 沿用受限 Worker Diagrams 1.2.0，DOM/PDF 门禁保持关闭。

## 下载身份

- [成功 CI 39896049662](https://github.com/Auto-Plugin/milkup/actions/runs/39896049662)，首次执行，一次成功，无重跑。
- [唯一 Actions 产物 12477447032](https://github.com/Auto-Plugin/milkup/actions/runs/39896049662/artifacts/12477447032)，需 GitHub 相应访问权限；到期 **2026-10-24 03:52:37 UTC**。
- EXE：`milkup-2.0.0-beta.6-windows-x64-6b3eeebad7ec-setup.exe`，4,410,746 字节。
- EXE SHA-256：`15360f904f4967f926d1268236d4cf6b32c29348758fac80b75b932195b8838f`。
- ZIP：4,699,062 字节；SHA-256 `98190f24d7280cc93eb68a778348f8f5d477574995d37b5a47ed7130b51f526c`。

只上传到已批准的本仓库 Actions，保留一天；未发布 Release、合并 main、执行安装器或增加 Runtime。小包依赖现有 WebView2，未签名；遇系统安全提示应保留原文，不绕过。安装可能复用旧数据或覆盖旧安装，不以换路径冒充数据隔离。

## 实际产物回读

通过授权 GitHub connector 下载实际 ZIP，匹配 GitHub 官方大小/摘要后检查 18 个文件 CRC、17 项 SHA、十个插件 manifest 与精确提交一致、完整 15 阶段 Windows 证据、包内 EXE 版本/摘要。独立父线程下载得到相同 EXE 摘要。

在 Linux 只读提取真实 NSIS 应用和 12 个内嵌前端资源，不执行任何 Windows 代码。应用映像 17,252,352 字节，SHA-256 `20ffb3e27e745d80fa99c2bb2a64e2527221156973c913ee13192662ab39e776`。逆转唯一 `NSS→UNK` 三字节后，精确等于编译映像摘要 `131463397fb67722a50d8ce45d8cb9e6870a66071d822828d1a3fffb27d84d7a`；没有将这两个映像说成逐字节相同。

实际 `index.html` 指向 `/assets/index-C-wt850v.js`，其中 beta.6 标记 1 次、beta.3/4/5 标记均为 0，包含 `data-editor-context-menu`、`hostContextCommand`、`floating-document-toolbar`，并保留一键开关、内置 About 更新及隐藏围栏标记。这证明打包内容，**不等同 Windows GUI 行为验收**。

三份手测文件在 ZIP 中均严格只有 LF→CRLF 转换：README 增加 44 字节、FEEDBACK 增加 41 字节、basic 增加 106 字节，源文件无 CR，交付内容完全等于逐个 LF 替换为 CRLF。初始新增的逐字节相等断言失败已保留；两侧摘要、独立字节复核与验证器最小差异均归档。只接受完全一致或上述精确转换，不忽略其它空白/内容，不改变包内 SHA 或源码门禁。未为手册换行重复构建。

## 检查与耗时

- Windows：2,888 项 Vitest 加 4 项 Node，共 **2,892 项全仓测试**；14 项目类型检查、全仓构建通过。十个独立插件共 358 项测试及各自类型检查通过。前置打包 22 项、源码契约 81 项通过。
- Rust：全 targets 检查通过；库测试 215 通过、0 失败、3 忽略。两个私有 fixture 分别由实际 picker/ownership 测试调用，另一个是显式旧搜索性能基线，不把忽略项算通过。更新启动测试 2 通过，另 3 项被该测试过滤器排除。
- 总 job **14 分 41 秒**；全源码步骤 11 分 40 秒；NSIS/解包 1 分 53 秒。源码内主要耗时：release 编译链接 5 分 18 秒、all-targets 2 分 05 秒、更新测试编译/运行 59 秒、Rust 库编译/测试 31 秒；全仓测试 66 秒、类型 22 秒、构建 21 秒，独立插件构建/测试 41 秒。
- 本地打包回归 29 项、版本同步、修改文件格式及 diff 检查通过。初次默认执行器限制导致临时 `git` 子进程 `EPERM`，原断言未变，在允许子进程的执行环境重跑通过；失败保留。PowerShell 本地不可用，实际 Windows 前置解析通过。
- 保留原四种生成 schema 的受限变化校验，没有放宽为任意工作树变化，也不声称所有文件逐字节未变。

产品交互、失败回归、截图及 Linux 原生连续步骤见[UI 检查点](v2-beta6-context-checkpoint-2026-10-23.md)。该检查点的历史“未构建 Windows 包”状态由本报告更新。Linux 原生已证明真实复制/剪切和文件字节；粘贴仅证明平台读取失败时准确报错且不修改文档，不能写成粘贴成功。

## 手测与未验边界

包内含中文 README、FEEDBACK、basic 与 larger 样例。[指南](manual-windows-beta6/README.md)覆盖无插件宿主右键、插入子菜单、SVG/键盘、最多三个插件项、表格浮层不占位、切文档/模式/即时卸载、稳定卡片、隐藏围栏与保存字节。建议先确认 About 为 beta.6，再用两个全新样例副本检查宿主右键与表格浮层，最后验证停用插件后的宿主菜单仍可用。

十插件：Diagrams 1.2.0、Footnotes 1.0.1、Formatting 1.0.1、Images 1.0.0、Management 1.0.0、Math 1.0.0、Outline 1.3.3、Preferences 1.0.0、Shortcuts 1.0.0、Workspace 1.0.1；SDK 0.3.8。Updates 是内置 About 功能，旧插件数据保留，生产更新渠道尚未配置。

真实 Windows GUI/IME、系统剪贴板、系统 DPI、用户安装及实际更新/回滚仍未验；Linux/浏览器证据不替代它们。完整 Mermaid 原型因当前 runner 令牌不符合非提升门禁而未进入渲染，不能称机制失败或语法通过。此次收尾不触发第二次构建或追加上传。

[非二进制证据目录](evidence/v2-beta6-windows-delivery/README.md)保存终态、全日志、两次本地验证失败、产物清单、摘要、提取证明、验证器及差异。EXE、ZIP 和插件归档只在已批准 Actions 产物内交付，不另上传到报告仓库。
