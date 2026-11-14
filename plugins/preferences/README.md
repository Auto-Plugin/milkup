# Milkup 编辑偏好

独立 Worker 插件，仅依赖公开 `@milkup/plugin-sdk` 0.3.1，使用 `settings:write` 权限。安装后审批并启用，从通用插件设置入口或详情打开“编辑偏好”。插件没有文件、网络或宿主私有模块依赖。

支持编辑字体、字号、实时正文宽度、行高、缩进方式与宽度、主题及原生界面缩放。字段由宿主安全表单协议渲染，带可访问标签、帮助与错误说明。源码模式不因正文宽度设置而折行。

每次打开开始 application 设置事务。有效输入即时预览；空白、越界或不合法数值保留为草稿并阻止保存。保存成功才持久化；“预览默认值”也只是可取消预览。“取消更改”、关闭界面、停用与卸载撤销未提交预览。所有调用串行处理，关闭后迟到的结果不会恢复界面或事务。宿主同时负责权限撤销和插件终止时的强制回滚。

```sh
pnpm install
pnpm test
pnpm build
node scripts/verify-external.mjs /absolute/milkup-plugin-sdk-0.3.1.tgz /outside/checkout/preferences
```

独立验证只从公开 SDK tarball 安装 Milkup 依赖，执行类型检查、单元测试与自足 ESM 打包。产物 `dist/milkup.preferences-1.0.0.milkup-plugin` 包含 PNG 图标。

`scripts/browser-fixture.mjs` 导出 `installPreferencesFixture(page, options)`，供浏览器测试装入同一独立 Worker 实现；默认仍需批准和启用。该辅助仅准备插件 registry，不替换设置服务或绕过宿主权限流程。
