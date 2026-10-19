# Linux 原生输出集成验证

基线 `7241f8b875f241d6ee50535e3bc0d4c18f51052b`，验证时包含尚未提交的实现。原始证据位于 `/workspace/milkup-export-print-evidence/milestone05/native-integration/`；本目录九个日志／JSON 文件均逐字节复制并核对 SHA-256，未收录二进制、profile 或原图。

- 两次 `cargo check` 成功；最终 [单测日志](cargo-test-output-with-spool-02.log) 为 **15 通过、0 失败、3 忽略**。中间新增测试的类型推导编译失败及修复后重跑均保留。
- [GTK 实测](filebackend-proof.json)：调用产品同一 `submit_pdf → source_fd → send` 路径，368,049 字节 PDF 经本地 FileBackend 后逐字节不变；源文件、提交事件顺序和 FD 生命周期断言通过。独占显示进程已清理。**未向物理打印机发送任务。**
- [实现证明](implementation-proof.json) 保存测试二进制／源文件哈希、取消与提交边界。提交授权后不再声称取消成功；结果不明时要求检查队列。最终生产 UI／目标生命周期回归另记。

浏览器仅可选复用已安装的系统 Chromium；安装包不自动依赖、下载或携带浏览器运行时。物理打印及 Arabic 逻辑文本提取仍是独立未完成项，不以本目录证据宣称通过。原始 JSON 中的本机路径和当时状态保持原样。
