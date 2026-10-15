# Milkup Workspace

独立 Worker 插件，仅依赖公开 `@milkup/plugin-sdk` 0.3。需要 `workspace:read` 审批；安装后从插件详情启用并打开工作区侧栏。

用户每次启动后选择一个文件夹授权访问。目录只在展开时按页读取，每页最多请求 100 项；仅展示宿主支持的 Markdown 文件与目录，不递归扫描。关闭侧栏取消待处理请求，禁用或卸载释放文件夹授权。重新选择或刷新会替换旧句柄。

最近打开只在宿主返回 `opened` 后写入插件 storage，按根的稳定 key 保存至多 20 个相对路径。重启不恢复访问权；重新选择相同根后再解析最近文件。文件读写、未保存文档保护与崩溃恢复全部使用宿主既有流程。

树与最近文件的每次打开操作都会在当前授权根内重新解析已显示的相对路径，因此保存时替换文件不会让旧树节点永久失效。宿主仍检查新句柄对应文件的身份与访问范围。

```sh
pnpm install
pnpm test
pnpm build
node scripts/verify-external.mjs /absolute/milkup-plugin-sdk-0.3.0.tgz /outside/checkout/workspace-external
```

仓库外验证脚本复制本插件到独立目录，只从公开 SDK tarball 安装 Milkup 依赖，执行类型检查、测试和打包。产物为 `dist/milkup.workspace-1.0.0.milkup-plugin`，包含自足 ESM 与 PNG logo；无 Tauri、宿主私有模块或运行时外部导入。
