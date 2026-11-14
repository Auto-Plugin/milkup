# P6 milestone02：证据说明

本目录记录方案 A 原生 catalog、候选受限 activation、独立公开 SDK 管理扩展的真实失败、修正和 Linux 验收。最终 Linux 管理闭环使用 production07（ELF SHA `b909794f6d83b5e27a92e852f4c2b81d0b5630a336ca182b85f0bea310e26f94`）通过；11项目录事务在production05统一通过，production06补跑失败/挂起，5项布局/编辑/输出仍归属production04。当前结果以仓库 `docs/v2-product-phase6-native-catalog-2026-10-19.md`、`final-checks.json`、各轮原始 completion 及独立 review 联合解释；失败日志原样保留，不用进程 exit 0 替代断言或像素验收。

## 证据入口

- `productionNN/proof.json`：源码输入、构建命令/时间、输入漂移及实际 ELF SHA。production02 有输入漂移，不能用于验收；各轮截图保持原二进制归属。
- `native-ui/control/` 与 `native-ui/runs/`：精确驱动/夹具输入、程序身份、独立 profile、原始 UI 截图、Markdown、catalog、事件和完成记录。重启/CAS/磁盘故障使用可信宿主探针，不代表普通插件拥有 native 权限。
- `native-ui/review/initial-failure-classification.json`：真实产品失败与驱动/夹具错误分别分类；保留旧失败目录。
- `native/native-catalog-review.md`：磁盘格式、sealed generations、恢复和卸载重试交叉审阅。
- `catalog-adapter/native-final-review.md`：production05 的 11 个事务场景最终原件复核。
- `runtime/native-raw-review.md`、`outline-retirement-green-review.md`、`native-cold-html-review.md`：原始能力封禁、大纲退休与冷启动 HTML 产物及实际截图审阅。
- `management-extension/native-matrix-review.md`：production04 的 24 单元、176 卡片、216 控件焦点/裁剪/命中检查，以及 16 张实际 PNG 独立复核。
- `management-extension/native-management-final-review.md`：最终独立管理扩展审批、只读详情、可信导航、拒绝/回滚、完整诊断及停用后的宿主恢复闭环。
- `manager/`、`runtime/`、`catalog-adapter/`、`native/`：RED→GREEN 与定向合同证据。定向套件重叠，不加总为全仓测试数量。

legacy UI harness 的 completion 中 `visualReview: pending` 是其自动运行时状态；后续独立 review 单独落盘，不篡改原始 completion。cold HTML 的 Chromium 截图仅用预装浏览器查看本地产物，不是产品导出引擎、运行时依赖或 PDF 修复。

## 字节与归档

`final-index.json` 覆盖本归档每个文件的大小与 SHA-256；运行 `python3 verify-index.py` 验证。历史组件索引保持其当时范围，不冒充最终全量索引。`excluded-local-artifacts.json` 记录未纳入 Git 的 ELF、SDK tar、插件包的真实大小及 SHA；这些原件仍保存在 `/workspace/milkup-plugin-lifecycle-evidence/milestone02/`。对应源码、构建证明及包指纹保留；本轮没有上传 Windows 包、Runtime、Library 或 GitHub artifact，没有 Release。

## 适用范围

仅 Linux WebKit 原生验收。Windows 安全 catalog 当前返回 unsupported，不只是未测；macOS 未构建/运行。sidecar catalog activation unsupported；DOM 仅严格只读呈现 profile。原生缩放不是系统 DPI，焦点检查不是完整 Tab 遍历。故障边界重启不是任意断电，撤权与已尝试清理不是全部 OS 资源已回收。能力收紧不是完整恶意代码沙箱。

P5 PDF Unicode 精确复制/搜索、长块分页及历史 Print04 超时继续开放；遵循用户选择保留既有 WebKit 依赖，不引入 Chromium 产品依赖。本检查点不声明跨平台或整个 P6 完成。
