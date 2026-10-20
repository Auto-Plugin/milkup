# P5 WebKit 原生 PDF 失败证据

对应[检查点报告](../../v2-product-phase5-webkit-checkpoint-2026-10-20.md)。基线 `cf7d407dbb9416232d4f2163e8cebf9d49798c57`；只有诊断与文档，没有已修复候选。

- [最小 PDF，2 页](./minimal.pdf)
- [当前序列化器 PDF，1 页](./serialized.pdf)
- [最小 PDF 第 1 页像素](./minimal-page-1.png)
- [完整归档](./evidence.zip)：170,035 字节，38 个成员，SHA256 `23be00c82ebd53778d41bd9ab1eb9f18d68694f110c8818d78cdddf8f6b31087`
- [完整成员清单](./manifest.json)

归档保存两份 HTML、Markdown、当前序列化器调用、HTML 锚点审计、原生执行脚本和命令、三个逐页 PNG、两种提取器原始文本、搜索／链接结构审计、失败门槛及实际退出记录、精确生产 ELF 构建证明、guard 校验、运行库／环境信息和固定标签 WebKit 源码快照。源码保留原许可证；不包含运行库、ELF、字体、插件包或用户 profile。

归档完整性可用标准库验证：

```bash
python3 docs/evidence/v2-p5-webkit-checkpoint-20261020/verify.py
```

在独立目录解压后，现有 Python 环境已具备 PyMuPDF 1.26.6、pypdf 6.10.0 和系统 Poppler 25.03.0，可重新分析实际 PDF：

```bash
python3 audit.py
python3 quality-gate.py
```

第二条命令应 **退出 1**：8 个质量失败、ASCII 正向对照通过。它要求原文精确提取／搜索及 PDF 链接，不能将这次失败改成通过。该门槛只覆盖此次最小反例，不足以验收未来引擎补丁的全部目标坐标、分页、Unicode、打印或安全行为。

重新执行原生生成还需要原执行器的精确 cf7 ELF、既有 sysroot、guard、Xvfb 与 namespace 路径，见 `provenance.json`、`native-command.txt`、`run-pair.py` 和 `with-display.py`。它们以固定哈希和排他创建保护原始证据；应复制到新的诊断目录并调整输出位置，不能直接覆盖归档结果。序列化调用可用仓库已安装的 esbuild 打包执行，源文件为 `serialize.ts`；没有增加依赖。

`quality-gate-run.json` 是内容质量失败；`execution-minimal,serialized.json` 和 `xvfb-133-cleanup.json` 是实际输出／清理成功，两者含义不同。本轮没有完整 GUI、实际阅读器点击／剪贴板或 Windows 验证。
