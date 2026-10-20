# 当前首次输出与 P7-03 原生检查点

对应[报告](../../v2-p7-input-search-checkpoint-2026-10-20.md)。产品基线为 `cf7d407dbb9416232d4f2163e8cebf9d49798c57`；没有新的产品修复或大纲候选。

- [完整归档](./evidence.zip)：4,271,071 字节，251 个成员，SHA256 `b6a09720a3d2bf506facab24479dfc10aa728b4e2b951493a6e17e5ddc4b9d00`。
- [成员哈希清单](./manifest.json)。
- [实际复核结果](./review.json)：三种首次输出通过；六次长文功能与 24 个保存状态通过；首次搜索 5/6 失败。
- [质量门槛实际退出记录](./quality-gate-run.json)：退出 **1**，不把原生流程退出 0 当性能通过。
- [当前首次打印脚注页](./current-first-print-footnotes.png)。

归档包含全部 10 个 driver 的生命周期记录、一次尚未启动应用的 harness 准备失败、三种首次输出实际产物／页面像素、六个完整长文夹具、858 条样本、24 个保存历史状态、屏幕截图、CPU／内存观察、冻结脚本及构建／插件指纹。原始应用 ELF、插件包、Runtime 与用户 profile 均不在归档内。

目录中的两个 JSON 摘要副本按仓库格式排版；校验器确认其解析内容与归档原件一致。归档保留原始字节和逐文件 SHA256。

使用标准库核验完整性、原始样本、保存哈希与明确失败：

```bash
python3 docs/evidence/v2-p7-input-search-20261020/verify.py
```

这条命令成功只表示证据自洽。解压后 `python3 quality-gate.py` 应退出 **1**，因为原 500 ms 首次搜索门槛没有通过。`review.py` 是本执行器的完整重新分析脚本，像素对照还需要仓库已保存的 P6 历史原件或原执行器中脚本记录的历史路径；使用现有 Pillow，不安装产品依赖。

真实原生复跑依赖 `runtime/` 所记录的既有 sysroot、独占 Xvfb、namespace wrapper 和精确 cf7 ELF。每次必须使用新的 profile／输出目录，不能覆盖此次成功或失败。`preparation/bounded-run-plan.json` 冻结了六次长文运行及原预算；“first-query”发生于可逆编辑和保存后，不是冷磁盘。`cold-source/` 的唯一行为适配是接受当前大纲 1.3.3，脚注与产物断言未改。

历史保存核验在全部计时之后执行。真实 X11 剪贴板不代表系统 IME；两次 rAF 不代表物理屏幕呈现；Linux 不代表 Windows/macOS。PDF 精确文字、链接动作、长块分页和历史 Print04 超时仍为各自独立限制。
