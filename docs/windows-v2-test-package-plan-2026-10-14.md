# Windows x64 测试包：未启用流程与安装验收草稿

> 后续执行更新：用户已明确接受公开 Actions 日志／测试产物和未签名安装包。组织 billing usage／summary 只读接口均返回 403，无法证明免费存储余额；Actions runs 列表读取成功，管理查询 403 不等同于执行被拒绝。现准备启用 **validation-only-no-artifacts**：标准公开 Windows runner，无 upload-artifact、无 Actions cache，只在日志记录有界 JSON／错误诊断。`storageBudgetVerified` 保持 false，不将公开产物授权当作额外费用授权。`.github/workflows/v2-windows-test-package.yml` 与 scripts 下的规范副本一致；此次运行不交付安装包。以下原草稿与静态证据保留为历史记录。

> 取包后续路径：在父线程核实免费额度或明确批准 GitHub artifact 存储预算后，再单独提交有字节上限、1 天保留的上传步骤并重新构建／验收。当前临时 VM 文件不会在无上传运行结束后提供下载；不通过日志编码二进制、仓库提交安装包、额外服务或新凭据绕过这一边界。GitHub 当前共享存储单价为 $0.25/GiB/月；未来可将一次上传总量硬限为 256 MiB、保留 1 天，按最短 28 天月份计算存储费约 $0.00224，建议授权上限 $0.01（税费另计）。实际包大小需 Windows 构建后记录；上传 ZIP 与元数据必须计入上限。尚未获得该费用授权，也未上传。[计费依据](https://docs.github.com/en/billing/concepts/product-billing/github-actions)

当前基线是已推送的 `a73131e4b46f88fa85f2f59f1c4ae3f75d16d778`，本轮只准备打包流程与验收脚本，不继续性能阶段。未运行 Windows 构建、未上传产物、未创建标签或 Release。下面的静态通过不能代替 Windows 实测。

## 可审阅补丁

| 文件                                         | 作用                                                                                                                         |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `scripts/ci/windows-v2-test-package.yml`     | 放在 Actions 不扫描的目录中的未启用模板；标准 `windows-2025` x64、45 分钟上限、只读仓库权限、固定 action SHA。               |
| `scripts/ci/windows-v2-package-request.json` | 执行请求；公开产物、未签名测试包、存储预算和 enabled 四个开关目前均为 false。                                                |
| `scripts/ci/build-windows-v2-package.ps1`    | 固定源码 SHA、锁文件安装、workspace 测试／类型检查、Rust 测试、MSVC release NSIS 构建；记录签名、哈希、平台和安装验收结果。  |
| `scripts/ci/test-windows-v2-installed.ps1`   | 在新建临时目录安装，校验安装后 PE x64 和二进制哈希，记录文件关联前后状态，运行安装后应用。                                   |
| `tests/windows/installed-package-smoke.mjs`  | 使用 tauri-driver 与 Edge WebDriver 驱动安装后的生产程序，验证打开、输入、保存、撤销／重做、关闭会话、重新启动和全文件字节。 |

没有更改应用功能、NSIS 配置、产品标识、main 或已有发布流程。此草稿没有 Linux 交叉构建伪装的 Windows 验收。

## 最小启用方案（当前未执行）

父线程收到用户对公开 Actions 日志／可下载测试产物、未签名安装包的确认，并核实 Actions 权限与存储预算后：

1. 在原工作分支将模板复制到 `.github/workflows/v2-windows-test-package.yml`；保留模板注释，明确这是本次测试包流程。
2. 只按实际确认结果更新 request JSON 的开关及唯一 requestId。保留已审阅 baseline SHA。
3. 静态复检后正常提交／推送该分支，提交信息含 `[windows-v2-test-package]`。使用仓库身份 `LarryZhu-dev <larryzhu@foxmail.com>`；不强推。
4. 仅该分支的 push 且改动 workflow 或 request 文件才匹配；job 另外核验仓库、完整 ref 和提交标记。源码 checkout 使用事件的精确 `github.sha`，随后检查 HEAD 和基线祖先关系。流程脚本修改本身不会请求第二次构建；后续需要构建时必须另行更新 requestId 并带提交标记。
5. 首跑单个 Windows job。出现编译、驱动、安装、安全提示或字节错误就保留证据并调查，不盲目重试矩阵。通过后下载安装包与 manifest，再独立核验 SHA-256、工作流 head SHA 及 GitHub author／committer 关联。

`push` 可使用推送分支里的 workflow，不要求合并 main；`workflow_dispatch` 要求 workflow 已存在于默认分支，因此本方案不用它。分支与路径过滤必须同时匹配。以上是官方事件合同与静态检查结果，尚未在本仓库触发证明。[GitHub 事件文档](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows)

仅验收成功才建立 `deliverable` 并上传安装包；失败时只允许上传已获确认请求产生的诊断。两个 artifact 保留 7 天，不启用 Actions cache、不创建 Release、不调用第三方存储、不新增 token 或签名凭据。未批准 request 会在工具安装／构建前失败，证据上传也不会执行。

## 安装与验收边界

使用每个 GitHub-hosted job 的全新 VM 及其已有 runner 用户，安装目录在新 GUID 临时目录内。NSIS 当前是 `currentUser`：安装会写该 runner 用户的应用／卸载信息及 `.md`、`.markdown`、`.mdown`、`.mkd` 关联，已有 hook 会写 `Markdown Document\DefaultIcon`。脚本记录相关 HKCU 默认值前后状态；这不是完整注册表审计。不会在真实用户桌面覆盖既有安装。完成后由 VM 生命周期隔离副作用，不修改其他用户数据或永久删除历史证据。[Tauri Windows 安装文档](https://v2.tauri.app/distribute/windows-installer/)

官方 Windows runner 默认以管理员账户运行且 UAC 关闭，这是供应商镜像默认，不是脚本改动。静默 `/S` 安装只验证此 VM 安装路径；不能据此宣称普通桌面 SmartScreen／UAC 或交互安装体验通过。脚本不提升权限、不取消文件阻止、不改 Defender／SmartScreen／UAC，不自动点击或绕过安全提示。[GitHub runner 文档](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)

验收包含普通文档与至少 1 MiB 文档各自的 source／live 四例；原始内容带 CRLF、中文与 emoji，文件名带中文。通过真实 WebDriver 键盘 actions 输入 ASCII 标记，检查 `isTrusted`，每次保存都比较完整预期字节，并在安装后的程序中重开。保存后关闭使用 WebDriver 删除会话，不冒充未保存关闭对话框、真实 IME 或原生文件选择器的人工验收。

WebView2 使用 runner 已有 Evergreen runtime；从微软地址下载其精确版本 EdgeDriver，并验证 Microsoft Authenticode 签名及版本。不存在 runtime、版本下载不可用或签名不符时明确失败，不安装另一套浏览器或放宽系统安全策略。精确版本下载可能成为首跑环境阻塞，届时根据证据处理；官方通常允许前三段版本匹配，本草稿采用更严格的精确匹配。[Tauri WebDriver](https://v2.tauri.app/develop/tests/webdriver/manual-setup/)、[Microsoft WebDriver](https://learn.microsoft.com/en-us/microsoft-edge/webdriver/)

真实 IME、Word 2016、辅助技术、DPI／多屏、macOS、普通 Windows 用户交互安装、未保存退出与断电恢复仍单列待验。现有 Linux 结果不会填充这些勾选。

## 费用、权限与剩余阻塞

官方当前说明：公开仓库使用标准 GitHub-hosted runner 的运行分钟免费；larger runner 即使公开仓库也收费。本流程只选标准 `windows-2025`，不新增付费 runner。artifact 存储按账户配额和计费政策管理，不能从“公开仓库标准 runner 免费”推出产物存储无限免费。预算／共享存储用量本环境不可见，需父线程在启用前核实。[GitHub Actions 计费](https://docs.github.com/en/billing/concepts/product-billing/github-actions)

只读 `GET /repos/Auto-Plugin/milkup/actions/permissions` 返回 HTTP 403：`Resource not accessible by integration`。因此尚不能证明本仓库 Actions 已启用、固定官方 actions 被允许、当前凭据可新增 workflow 文件、或实际可下载运行产物。没有为探测写权限推送活跃 workflow，也没有索取扩大权限的凭据。这些是执行前的具体权限缺口，不是源码或 Linux 构建失败。

## 本地验证

- 官方发布 SHA-256 校验后的 actionlint 1.7.12：整个 workflow 模板通过。
- 官方发布 SHA-256 校验后的 PowerShell 7.6.7：两个 `.ps1` 及 workflow 内嵌 PowerShell 块 AST 解析通过；只做语法检查，没有在 Linux 模拟安装通过。
- Node 24.19.0 `--check`、Prettier、JSON／YAML 触发与权限合同检查通过。
- HEAD 和本仓库提交身份保持上述基线；`.github/workflows` 没有激活文件，request 开关全关。

静态日志与哈希记录位于容器 `/workspace/.milkup-v2-windows-prep/`，可复核摘要位于 `docs/evidence/windows-v2-package-prep/static-validation.json`。Windows 编译、安装与四例验收均尚未运行；本轮没有安装包可交付。
