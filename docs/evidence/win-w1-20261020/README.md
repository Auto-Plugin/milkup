# Windows W1 / W0 证据

`evidence.zip` 保留原始 GitHub Actions 日志 ZIP、分阶段原文、精确 run/attempt/SHA、源码快照与本地检查；没有 Windows 可执行文件、安装器或 Runtime。

- W01：旧后端真实失败，156 通过、3 失败、1 忽略。
- W02：首个实现实际出现 5 个发布失败（Win32 87），166 通过、3 忽略。
- W03：修复后 174 通过、0 失败、3 忽略；整体因未修改的大纲独立测试失败，后续生产构建未执行。
- W05：W03 精确同源码的 attempt 2；15/15 阶段通过，174 个 Windows Rust 测试与 22 个新增原生回归通过，生产链接/manifest 验证通过。原 W03 失败不删除。
- W04 / W06 / W07 / W08：单独授权的临时 AppContainer 兼容性实验，W08 静态 Runtime 兼容性原型成功，全部失败尝试保留。仅有有限 canary 观测，未通过完整网络/文件/后代隔离验收；产品 DOM/PDF 保持关闭。

运行 `python3 verify.py` 校验 ZIP、全部成员 SHA-256、原生测试名称、完整 15 阶段及各次零 artifact 上传记录。`index.json` 自身由 Git 提交追踪。

实际支持范围、原型失败阶段与未验 GUI 见[里程碑报告](../../v2-windows-backends-w1-2026-10-20.md)。Linux 单元测试不替代 Windows OS 测试，Windows CI 不替代已安装应用、用户交互或普通用户实机验证。
