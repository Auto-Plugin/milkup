# Milkup Shortcuts

独立 Worker 插件，只依赖公开 `@milkup/plugin-sdk` 0.3.1；`app:keymap` 权限仅允许读取命令/快捷键目录、原子更新和恢复默认，不授予命令执行、文件或网络权限。

通过宿主受控 field 表单编辑本地草稿，保存前不改变运行中的快捷键；取消仅丢弃草稿。保存与恢复默认均带目录 revision，过期、冲突、非法/保留按键或持久化失败会显示错误并保留原运行设置和草稿。卸载/禁用会取消在途请求；已提交的用户设置由宿主持久保存，基础编辑和保存不依赖此插件。

使用 Mod+Shift+K 等单组按键，多个候选用空格分隔，空值取消绑定。必需参数的命令列于帮助而不可绑定；上下文固定导航、文本编辑和输入法键单独说明。搜索框保留文件、视图与查找等全局命令及原生本地编辑；其他输入框保留原生编辑。

```sh
pnpm install
pnpm build
pnpm test
node scripts/verify-external.mjs /absolute/milkup-plugin-sdk-0.3.1.tgz /tmp/milkup-shortcuts-external
```

构建器检查所有输入仅来自本插件与公开 SDK，输出自包含 ESM 和 `.milkup-plugin` 安装包。外部验证会复制插件到仓库外、安装 SDK tarball 并重新构建/测试，禁止引用宿主内部源文件。
