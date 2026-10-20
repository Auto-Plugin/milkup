# P7 长尾归因证据

本轮从 `b85e6a456699ecf515ec547a3b50aae2ca3e79fe` 继续，仅新增一次独立诊断，产品源码仍为 `8f1645cd72522c10de6714b9918d6f0dc5baee38`。参见[完整结论](../../v2-product-phase7-tail-attribution-2026-10-20.md)。

[diagnostic.zip](diagnostic.zip) 含 35 个原始文件，217,163 字节，SHA256 `7c096c911301c69df63734e9b57dd46722708bd74a8b71b8f5cc8188e9bec9e4`；包含计划、脚本、124 条独立诊断观察、3732 个有界事件、59 次系统采样、截图、失败准备记录和清理证明。不包含 ELF、安装器或插件包。

[analysis.json](analysis.json) 是从前一检查点十轮冻结数据和这一次诊断重算的派生结果。[index.json](index.json) 保存逐文件哈希及原归档引用。原生产分布没有增加、删减或改写。

```sh
python3 docs/evidence/v2-p7-tail-attribution-20261020/analyze.py --check
```

此命令同时校验两个归档、全部 1060 条原观察、1000 个暖态样本的分解、RPC 配对和清理证明，并核对派生 JSON。无需启动应用、网络或新依赖。去掉 `--check` 会重新生成本目录派生 JSON；不会修改原归档。

**结论仍开放：** 候选 RPC 批次确实减少；生产样本恶化存在，但因果回退未决；一次诊断没有复现折叠慢点。保留隔离候选，不以性能改善为由整合。唯一实验已用完，不继续追加轮次或放宽预算。
