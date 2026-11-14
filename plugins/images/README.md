# 图片与资源

独立 Worker 插件 `milkup.images`。只依赖公开的 `@milkup/plugin-sdk` 0.3.2，不导入宿主、Tauri 或 Milkup 私有包。

安装后在插件详情批准 `document:read`、`document:write`、`images:import` 并启用，通过通用插件入口打开“图片与资源”。选择 PNG、JPEG、WebP 本地图片，或在编辑器中真实粘贴图片。插件不会读取任意路径、访问网络或扫描剪贴板。

未命名文档先由宿主完成普通首次保存；取消保存不会导入图片。图片由宿主持久暂存后，插件构造 Markdown，再通过编辑快照检查一次性接纳资源并插入引用。文档内容或保存位置改变会让旧操作失效。关闭界面、取消或停用会停止待处理操作；已插入的资源和用户原图会保留，撤销只移除引用。

可选两种固定资源目录：文档同级 `assets/` 或宿主按文档名派生的 `<文档名>.assets/`。选择仅影响之后的导入，并通过插件私有 storage 保存；写入失败会明确提示。替代文本仅作为转义后的 Markdown 文本使用。

另存为资源保护由宿主通用保存协调机制负责，插件不持有磁盘路径、不移动或删除原资源。不支持网络图片、拖入图片、未保存草稿图片暂存或任意目录配置。

## 独立构建与测试

```sh
pnpm install
pnpm test
pnpm build
```

输出 `dist/plugin.js` 和 `dist/milkup.images-1.0.0.milkup-plugin`。构建脚本审查依赖图，允许插件源码与公开 SDK，拒绝其它代码依赖。PNG 卡片图标包含在插件包内。

```sh
node scripts/verify-external.mjs /absolute/milkup-plugin-sdk-0.3.2.tgz /absolute/outside-checkout/images
```

此脚本把插件源码复制到仓库外，唯一 Milkup 依赖指向指定 SDK tarball，独立安装、构建和运行测试，保留日志及 `verification.json`。

稳定 UI 合同：modal `images-panel`；命令 `images.choose`、`images.paste`、`images.change`、`images.cancel`；字段 `policy`（资源目录）与 `alt`（替代文本）。`images.paste` 仅接受宿主真实图片粘贴签发的 `{grantId}`，声明 `pasteHandlers` 不授予任意脚本粘贴能力。
