# Checkpoint09：重复扫描修复与真实回归，未完成产品验收

本批仅保存已完成的 parent process-table sampler 回归与修复证据、Root 独立复核和 checkpoint08 远端核验元数据。按 completed-manifest SHA `bfebac3fe654a62c10808775632b35bbfa09775edc2c03b0a4db63b98d101f6d` 的 38 项显式清单复制，保留原日志、旧失败、两版 baseline 测试方案及冻结源码。归档步骤未运行测试、构建或原生 UI；正在执行的 production05 未读取或归档。旧 checkpoint05/06/07/08 不变。

## 实际完成的机制与安全验证

生产 Instance 原本启动额外后台线程周期扫描整个进程表；guardian 已负责后代清理，生产 stop 路径不消费此缓存。最小修复删除该线程并修改说明，watchdog、2s render / 10s initialization-lifecycle 预算、FD4/EOF、guardian pidfd/subreaper 清理和独立测试 fallback 保留。冻结修后 process 源码 SHA `c6540ffc4d11e61050379d68bad0342c0cfaf8ec4a6fe60075b18ddecd851702`。

- Baseline 首次编译通过，真实 WebKit fixture 只在最终“调用数应为0”断言失败：实际 `sample_owned` 入口 **125 次**，exit101。激活、文本 bbox、native resource guard、网络/文件拒绝、global-alias 隔离、真实同步死循环 deadline 与9个独立观察身份清理检查先通过。失败原件不覆写。
- 最小删除后的同一真实 fixture 首次通过：**实际入口0次**，1 PASS，原断言保留，9个独立观察 PID/birth 身份均消失。测试以 guardian PPID 树独立采样，并在 owned argv 读取前后检查当前 PID/birth/parent，确认直接 helper 和 owned WebKitWebProcess；不再把被删除的缓存当作后代证据。
- 同一冻结 GREEN 测试 executable 另跑 `plugin_dom::` 安全回归：**14 PASS、0 FAIL、2 ignored**。ignored 分别为被父测试调用的私有 subprocess worker 和已单独运行的真实 WebKit fixture。覆盖未预注册 escaped descendant 的 EOF 清理、cancel/malformed/late response、blocked pipe、lease identity/memory 与受限已安装源码；不是完整 Rust library sweep。

`cfg(test)` 的 per-Instance 入口计数不进入生产构建。Cleanup Drop 在激活前安装，最终计数断言发生在成功 stop 后；namespace teardown 在断言结果之后。实际 guardian cleanup-complete 与 App cleanup-confirmed trace 保留，时序均从原 loop dispatch 计算，不用缺失事件反推清理时间。只证明9个独立观察身份消失，不声称列表覆盖全部瞬态后代。

两次 test owner 使用相同冻结 production04 guardian/GTK helper SHA `323213867fda26d1de66f67c5a428dd26d0a78f0334d40f8d15f1e94b161a172`；owner 逻辑在各自编译的测试 executable 内，**不是新打包应用的验收**。baseline test SHA `baf4a2d676aaeea6b036bdb83e3e59daa97a0bde33210a3e0fe4e8e361ce7de0`，GREEN SHA `8cd5b69ef1468b848ece3f5fe6ef0db9089e8bb705ad453f71bcc47fb6a17236`。50项冻结构建输入在对应构建/运行后核对无差异；完整相同 guard bytes 嵌入由 owner 与 Root 分别核验。

Root 原件 `root-parent-sampler-green-review.json` SHA `faa6a58711d4ea1bbc19917e9f60b495bc5603f60e76607cb722bb2b63ccf04d` 记录实际38文件、raw logs、binary/helper SHA及完整guard复核。归档代理只核验清单文本/源码主体，不重新读取排除的 binary。

这组证据支持移除冗余工作并保留已测安全与清理行为；没有测到历史 Mermaid 请求的 CPU，不证明性能改善或历史 deadline 根因，不关闭既有 UI/deadline RED，也不代表完整 production 生命周期/视觉验收。production05 仍是另一个阶段，本目录不预判其结果。

## 精确范围、跨引用与验证

41个 source aliases；40个本地去重对象 / 1,169,381字节；1个已有冻结源码对象 / 42,409字节按 SHA 跨引用。build JSONL 若内容 SHA 不同则各自原样保留，不能因大小相同而合并。无新增 PNG。两份测试 executable 共34,648,272字节仅存 provenance 路径/长度/SHA声明，不读取或复制主体；helper/guard 元数据保留在原 provenance，不复制二进制。profile、cache、target、整个frontend/source树均排除，只有清单明确指定的 process 源快照进入索引。

固定 base 为 checkpoint06 `2c3ff12bf3caa50520c8b6d49601e2f33a5f7da0`、checkpoint07 `e684539ff34e719d5b2ba40cf8147a0b8b24dd99`、checkpoint08 `e370c668666b17abe861a5d3176dc83d57b8d515`，其 index SHA 保存在本索引；08远端/身份记录是 Root 原件，归档代理没有重新查询网络。原始文件字节不格式化。

39项来源 SHA/长度声明匹配（38清单+Root新增review），归档文本敏感模式候选0；这是定向筛查，不保证任意秘密不存在。可复制目录的完整性检查：

```sh
python3 verify-index.py \
  --checkpoint06 /workspace/milkup/docs/evidence/v2-product-phase4-mermaid-engine/checkpoint06 \
  --checkpoint07 /workspace/milkup/docs/evidence/v2-product-phase4-mermaid-engine/checkpoint07 \
  --checkpoint08 /workspace/milkup/docs/evidence/v2-product-phase4-mermaid-engine/checkpoint08
```

校验对象/引用 SHA与长度、全部aliases、无孤立对象和无symlink，不执行产品测试。同级入仓后可省略三个base参数。外部 checkpoint09-draft 的生成/审阅/验证记录是支持材料，不自动计入本目录原始证据。
