# beta.4 交付后仍显示 beta.3：实包核对

用户反馈“看起来一点变化都没有”，随后确认当前关于版本为 `2.0.0-beta.3`。不能据此断言用户装错，也不能用 CI 通过代表覆盖安装成功。当前只确认安装包内是新界面，现场旧窗口来自哪一程序/加载路径仍待核对。

## 实际安装包字节证据

从已交付 artifact `12407892111` 的 EXE（SHA-256 `2becc80d9b5ad7e9e2b8a0f76130157d4a8af32102b65b33c221d334ff4838c4`）只读解压 NSIS LZMA，按既有 manifest 摘要精确找到 17,244,160 字节应用：`dad51ea4fabcbb877facb663738ba8de94f6dac33397ae7eb33759a68f5405f5`。未运行安装器或 Windows 程序。

进一步解析 PE 中实际嵌入资源的指针/长度表，用系统 Brotli 解出 12 项前端资源。`index.html` 实际引用 `assets/index-BJRufgo7.js`；该 JS 为 1,746,841 字节、SHA-256 `ce83659a382965ab16e312e44d587488fd9d0b90c6fb0246ddb1e5b1877df15f`。唯一应用版本常量是 beta.4，无 beta.3 字符串，含 `enableFromUserIntent`、卡片 toggle 和关于更新动作；无“批准”文案。CSS、版本、主 JS 资源名也与实际 Windows 构建日志吻合。

把解出的资源原样在全新 Linux Chromium profile 中加载，实际关于页显示 beta.4 和版本旁“检查更新”。[像素截图](./evidence/v2-beta4-running-version/extracted-about.png)、[提取证明](./evidence/v2-beta4-running-version/embedded-frontend-proof.json)、[浏览器记录](./evidence/v2-beta4-running-version/browser-proof.json)已留存。这是包内前端执行核对，不是 Windows/WebView2 或覆盖安装验证；普通浏览器没有 native invoke，截图中更新传输报错属于此验证环境，无插件 catalog，未据此宣称插件实机通过。探针中错误的宽泛按钮数量断言和等待空 catalog 卡片的超时均单独保留，未改产品来迁就探针。

## 构建与安装路径

实际 CI 的 beforeBuild 于 06:57:13 执行 `pnpm build`，06:57:19 生成上述 JS，随后重新编译 Rust，06:59:59 完成 release；没有跳过 beforeBuild 或复用旧前端的证据。正式配置 `frontendDist=../dist`；关于显示编译时常量，不读取插件数据或保存的版本设置。旧插件状态可以影响插件功能，不能解释宿主关于常量变成 beta.3。

NSIS 配置和钩子从 beta.3 到受测 `0e74d9fad211c304ef68449fa6becb7450dfffef` 未变化，仍是 currentUser、`app.milkup.desktop`；钩子仅维护文件图标。锁定 Tauri CLI 2.11.4 模板会恢复 HKCU 历史安装路径、检查当前用户名下同名旧进程并在复制应用前处理；不能凭猜测说安装器没处理旧进程。默认目录、历史目录、另一个用户/旧机器级安装、固定快捷方式及实际取消/失败仍需现场证据。未找到主 UI service worker；WebView2 数据目录沿用，未实证缓存导致旧页，不要求清缓存。

## 下一步最小核对

父线程已请用户正常退出后运行已交付 beta.4 安装器，从完成页启动并看关于版本；不卸载、不删配置。若仍显示 beta.3，使用普通 PowerShell 只读核对当前进程启动时间、路径、磁盘版本和 SHA，遇权限不可读记录即可，不提权：

```powershell
Get-CimInstance Win32_Process |
  Where-Object { $_.Name -like 'milkup*.exe' } |
  ForEach-Object {
    $appPath = $_.ExecutablePath
    [pscustomobject]@{
      PID = $_.ProcessId
      Started = $_.CreationDate
      Path = $appPath
      Version = if ($appPath) { (Get-Item -LiteralPath $appPath).VersionInfo.ProductVersion }
      SHA256 = if ($appPath) { (Get-FileHash -LiteralPath $appPath -Algorithm SHA256).Hash }
    }
  } | Format-List
```

预期主程序磁盘 SHA 是上面的 `dad51ea4…`，不是安装器或打包前应用摘要；磁盘摘要不证明当前已加载映像。反馈可遮去路径中的个人用户名。当前没有现场路径、安装结果和重新启动后的版本，尚不能确认具体根因；没有已确证的产品缺陷需要凭猜测改动。本次没有新构建、产物上传或产品代码修改。
