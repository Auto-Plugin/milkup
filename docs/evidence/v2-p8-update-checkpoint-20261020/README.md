# 更新检查点冻结证据

功能候选：`b2f0efaf6f1689cd709c49985e616c0c6a15957e`。基线：`5b62eb75615170f8a9cd8eede5fa42f275850ca7`。结论和未验范围见[检查点报告](../../v2-product-phase8-update-checkpoint-2026-10-20.md)。

`evidence.zip` 保存原始测试日志、修复前失败测试源码、精确候选源码、GitHub 提交身份与 Windows Actions 原始日志；不包含安装器、exe、Runtime 或正式密钥。`index.json` 对整个归档和每个成员记录 SHA-256。验证不执行应用：

```bash
python3 docs/evidence/v2-p8-update-checkpoint-20261020/verify.py
```

- `red/`：在基线生产实现上失败的两项回归及退出码。
- `green/`：本地全仓、Rust、浏览器、类型、构建和格式记录。编号 01 的失败没有被编号 02 的通过覆盖。
- `source/`、`source-manifest.json`：功能候选的变更文件及关键未变信任配置、版本和依赖锁，含 Git blob 和 SHA-256。
- `candidate-remote.json`：GitHub 返回的精确提交、author 和 committer。
- `windows-ci01/`：唯一候选 CI 的 run/jobs、零 artifact 清单、原始日志 ZIP、无改写解压日志、派生分阶段结果和二进制链接证明。只保存证明，没有上传或归档 Windows 二进制。
- `validation.json`：本地结果计数、未改路径、历史证据哈希以及验收边界。

浏览器场景使用真实独立 Worker/公开 SDK，但替代原生 transport。Rust HTTP 测试只读取 loopback 合成签名向量。Windows source job 是编译和测试，不是已安装应用操作；成功不能关闭正式密钥、包内真实版本、GUI、升级中断或应用回滚门槛。WFP 没有写入，既有 UDP 失败证据没有改变。
