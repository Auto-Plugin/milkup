# beta6 冻结候选的检查与构建记录

最初的全仓记录对应产品提交 `b3962099939149abe930d42b8c57f0a79ba009ce`，显示版本仍为 `2.0.0-beta.5`。这些全仓结果早于后续原生验证发现的 Source → Live 浮层问题及其修复，不能套用为修复后的全仓结果。修复提交的补充检查另列如下。

| 项目               | 原始结果                                                              | 归档                                                                               |
| ------------------ | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| 全仓测试初跑       | 前 11 个包通过；桌面包加载 Vite 配置时 `spawnSync node EPERM`，退出 1 | [final-tests.log.txt](./final-tests.log.txt)                                       |
| 剩余 3 包测试      | 自动审阅批准后，仅补跑 desktop、playground、cli；退出 0               | [final-tests-remaining-reviewed.log.txt](./final-tests-remaining-reviewed.log.txt) |
| 全仓类型检查       | 14 个包通过，包含 SDK contract 检查；退出 0                           | [final-typecheck.log.txt](./final-typecheck.log.txt)                               |
| 全仓格式检查       | `prettier --check .` 通过；退出 0                                     | [final-format.log.txt](./final-format.log.txt)                                     |
| 桌面前端构建初跑   | Vite 配置的版本检查被默认沙箱 `spawnSync node EPERM` 阻断             | [frontend-build.log.txt](./frontend-build.log.txt)                                 |
| 桌面前端构建补跑   | 自动审阅批准后完成；保留大 chunk 提示                                 | [frontend-build-reviewed.log.txt](./frontend-build-reviewed.log.txt)               |
| Linux release 构建 | 完成；保留未使用函数警告                                              | [release.log.txt](./release.log.txt)                                               |

两段测试日志合计 205 个 Vitest 文件、2,886 项 Vitest 测试和 4 项 Node 测试通过，共 2,890 项。Playground 使用 `--passWithNoTests`，没有测试文件。准确命令、退出码和原始日志 SHA-256 见 [final-verification.json.txt](./final-verification.json.txt)。本轮使用已有的 pnpm 11.25.0 fallback，项目声明仍为 pnpm 11.7.0；没有下载依赖。

原生构建的命令、567 项输入、无输入漂移记录和二进制摘要见 [native/attempt1/proof.json.txt](../native/attempt1/proof.json.txt)。原生两轮均未完整通过，不能把构建成功或本目录检查成功写成原生验证成功。

## Mode 修复后的补充检查

产品提交 `b7f9cdecfc02c2f0710fc9d6b71c12419364e644` 的[桌面测试日志](./final-mode-desktop-tests.log.txt)记录 65 个 Vitest 文件、891 项 Vitest 测试和 4 项 Node 测试通过，共 895 项。这是桌面包补验，不能将前述 2,890 项数字当作这个提交的全仓复跑结果。

[modefix-frontend-build.log.txt](./modefix-frontend-build.log.txt)和[modefix-release.log.txt](./modefix-release.log.txt)保留该提交的前端与 Linux release 构建结果。对应[构建 proof](../native/attempt3/proof.json.txt)记录退出码 0、567 项输入和无输入漂移，二进制 SHA-256 为 `ce34e8222bec1cf4bcf24d494291e00b670221f24dc5855945692908cdfd3a16`。第三、四轮及定点补验的准确完成范围见 [native README](../native/README.md)。

所有 JSON 和日志仅追加 `.txt` 后缀，保留原始字节。来源、大小和摘要列于 [source-map.json.txt](./source-map.json.txt)，本目录完整性清单为 [SHA256SUMS](./SHA256SUMS)。在本目录运行 `sha256sum -c SHA256SUMS` 可校验归档；原始 `/tmp` 文件保留。
