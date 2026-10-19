# 导出与打印

`milkup.export-print` 1.0.0 是独立 Worker 插件，只使用公开的 `@milkup/plugin-sdk` 0.3.5。

在侧栏“导出与打印”中选择 HTML、PDF 或打印；支持整篇文档和所选内容、包含或省略图片，以及 PDF/打印的 A4、Letter、横向或纵向。点击输出后会显示捕获的文档版本、行数和资源提示。之后的编辑不会加入本次输出。重试会重新捕获最新内容。

插件需要 `document:read` 与敏感权限 `document:output`，安装后须由用户明确批准。缺少宿主输出支持时显示错误，不使用浏览器下载或假打印代替。菜单可通过宿主通用插件面板入口访问，插件本身不导入宿主文件。

命令在第一个 `await` 前调用 `host.output.capture`，立即消费真实用户操作授权；命令自身不等待文件选择、写入或打印。关闭面板、取消、禁用或销毁会终止未完成操作并释放未提交资源；迟到的捕获或目标同样释放。宿主确认写入成功后保留成功结果，不删除已保存文件。取消与完成竞态以宿主返回的提交结果为准。

## 独立构建与验证

```sh
pnpm install
pnpm test
pnpm build
pnpm verify:external /absolute/milkup-plugin-sdk-0.3.5.tgz /outside/checkout/export-print
```

离线验证脚本只复制本插件，使用给定的公开 SDK tarball，执行 `pnpm install --offline`、构建和测试。已有 pnpm 缓存位于非默认目录时设置 `PNPM_STORE_DIR`；包元数据缓存位于非默认目录时设置 `PNPM_CACHE_DIR`。构建会拒绝除插件自身与公开 SDK 以外的输入，并要求生成的 Worker ESM 没有运行时 import。

产物：`dist/plugin.js` 与 `dist/milkup.export-print-1.0.0.milkup-plugin`。控制器测试覆盖即时捕获、重复点击、版本与警告、路径取消、延迟返回、写入失败与重试、关闭/禁用清理、取消与提交竞态以及缺少宿主的错误。真实 HTML/PDF/打印质量须由集成环境验收。
