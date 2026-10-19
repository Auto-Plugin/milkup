# Diagrams 1.1.2 独立构建候选

状态：frozen closure 构建验证通过，原生验收待定；未采纳，不宣称解决历史 print04。

- 包：`artifacts/milkup.diagrams-1.1.2.milkup-plugin`
- SHA-256：`2e54b8326935b28b6b727315ccef163fd288e1374514f1783e0722d539abdd78`
- entry 5,315,435 bytes，archive 5,728,329 bytes；相对正式1.1.1均增加53 bytes。
- SDK仍0.3.4，tarball SHA `1717c0114aa165fa3e48a1bfa7687ffd0d9b2e5392d33e99d8b2dc59a1f3ad4f`。Mermaid仍12.2.0、SDK/build依赖/profile/锁文件不变；runtimeImports为空，entry低于原8MiB上限。
- 完整插件129 tests通过，tsc通过；copied inputs在构建前后及checkout对照一致。

执行原有 `scripts/verify-external.mjs`，外部目录 `/tmp/milkup-p5-m06-diagrams-external`，PNPM_CLI为 `/workspace/.cache/corepack/v1/pnpm/11.7.0/bin/pnpm.cjs`。设置PNPM_HOME、XDG_DATA_HOME、XDG_CACHE_HOME及npm_config_store_dir为专属 `/tmp/milkup-p5-m06-*` 路径。没有改HOME。安装使用 frozen-lockfile、ignore-scripts 和verify-store-integrity，下载173个普通锁定依赖包，无浏览器/字体/runtime下载。workspace node_modules未复制或扩张。

`inputs/`逐字节保存verify脚本选择的全部源码/构建闭包及SDK tarball；`copied-inputs.json`是原脚本清单。`artifacts/proof.json`及`build-meta.json`保留构建证明。`verification.json`、`execution.json`和各阶段日志来自独立构建目录。`comparison.json`给出精确字节增量。`frozen-manifest.json`包含本目录除自身外文件SHA。未复制node_modules或pnpm store。

首次尝试虽设置store-dir，pnpm仍试图创建默认用户数据目录并以ENOENT退出，尚未build；原始失败记录在 `attempt01/`。重跑明确设置上述数据/缓存路径后通过，没有忽略安装错误、改锁或关闭完整性检查。

候选仅在原activation期限内公开调用 `mermaid.registerExternalDiagrams([], {lazyLoad:false})`；没有解析/预渲染用户文档、加大2秒期限或改缓存。它不保证预加载独立布局loader。是否改善真实首绘须用同一隔离native host做pre/post时序对比，mock测试及构建成功不能替代该验收。
