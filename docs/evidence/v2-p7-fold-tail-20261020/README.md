# P7 稀疏折叠检查点证据

精确基线 `cf7d407dbb9416232d4f2163e8cebf9d49798c57`，源码 `8f1645cd72522c10de6714b9918d6f0dc5baee38`。完整结论见[报告](../../v2-product-phase7-fold-tail-2026-10-20.md)。

**原性能预算仍未关闭。** 确定性读取等待从 8 轮降至 ≤5，不能替代原生延迟证明。主测候选折叠 p95 为 199/223/307 ms，第三轮失败；补充交叉对照不能覆盖主测。归档保留全部十轮、1060 条观察、原始分布、六组成功功能运行和功能脚本初轮失败，以及诊断、独立包、生产构建、全仓检查、实际 PNG 与清理证明。

[evidence.zip](evidence.zip)：5,121,451 字节，475 个成员，SHA256 `d36a26cc4a8bc84621563d40f57c60a52ddaf5992851a0dbb3d5598631fbd223`。逐成员大小及 SHA 见 [index.json](index.json)。

运行离线完整性校验：

```sh
python3 docs/evidence/v2-p7-fold-tail-20261020/verify.py
```

校验器核对原始脚本、完整夹具、样本数、逐轮 p95 与失败状态、源 Git blob、GitHub 身份、功能选区/保存、构建输入和进程清理。校验成功代表证据自洽，**不代表性能预算通过**。副本截图与 ZIP 原图逐字节一致。

ELF、安装器、`.milkup-plugin` 和依赖 tarball 不在归档内；本地构建物的哈希留在 `excluded-artifacts.json`、构建证明和外部构建证明。没有安装器上传、Release 或分支合并。没有 Windows/macOS GUI、真实 IME、读屏、系统 DPI 或完整主题/缩放矩阵的新增验证。
