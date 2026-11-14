# Checkpoint10：production05 生命周期与浏览器34项通过，正式 UI05 首次 RED

第一批保存 production05 完成的实际 Linux deb 构建、五项通用 DOM 生命周期、Root/独立审阅和 checkpoint09 远端核验记录；第二批在 UI05 完成后按新清单追加首次 RED；第三批追加最终 manager 的完整 browser34。三批均已冻结。原始 completed-manifest SHA `4624d87a5c22eef80d14d1a40337bb6e11e46f62e56a37876ff7fdba9a3a676a`，493 项精确文件清单 / 7,217,561 字节；不重新展开目录。第一批采集时 formal UI05 仍活动，未读取；现已收到完成信号并按第二批清单追加。full34 browser 随后完成，第三批才按其冻结 manifest 追加；新的 native-ui05-mindmap-transport-diagnostic-01 活跃，未读取。本目录保存已完成证据，旧 checkpoint05–09 不变。第一、二批 README/index/verifier 与交接报告分别原样保存于外部 `checkpoint10-draft/first-batch-frozen/`、`second-batch-frozen/`，不回写旧批次。

## 最新第三批：最终 manager 的完整 browser34 通过

已完成 `36-final34-preparation` 的383文件（375冻结源码、6support快照、PLAN及inputs），及 `37-browser-final34` 的48文件（47项显式manifest+manifest自身）。前者inputs SHA `512addaa04d47d4bdaa57624ada545aec5d503ead5621da0bfb23bc24c9d4762`，后者manifest SHA `b5ea7abeaaf6849d0a6c149e6c0877ca29b0b0b4ed3261c199cc9b14ce4ef897`、summary SHA `d29344f196b150c69785628e05406f41118c70cac1166dec93d6c4f6271ddfdb`。17张成功测试原PNG及JSON观测按实际清单保留，没有虚构“成功无图”。仅读取快照，不跟随support的原始node_modules或当前产品路径。

整份 `desktop-markdown-extensions.spec.ts` 一次完整执行，**34 expected、0 unexpected、0 flaky、0 skipped，retries=0，exit0**。最终 manager SHA `8dc1f4a2571539cdb32b85bb7f8cecee6c32cf2aa2f1f757b580d1087301d8e3`，375项前后检查无变。执行记录使用 `/usr/bin/chromium`；项目标签虽为 desktop-msedge，不是 Windows 或 Microsoft Edge 实测。

此批覆盖真实 math/footnotes 和明确受控的 image provider，验证浏览器呈现/交互合同；**不是官方 Mermaid native acceptance**，不洗绿第二批 native UI05 mindmap RED，不补齐其 windowed/64矩阵。375输入中的测试/源码快照用于重现当次浏览器入口，不把额外未执行的源测试文件数计为通过测试。

清理记录：live captured owned processes=0、端口无监听，但仍有 **11个 exited Z** 身份等待parent/init reap，不能称全部进程身份消失。记录的owned process group还有1个Z（包含在11个中，不另加），没有发新清理信号。它们不是活动服务器/browser task，且这个资格仅属于browser批次。新 native mindmap 诊断仍不在本检查点范围。

## 第二批：正式 UI05 首次 mindmap 目标预览缺失

UI05 completed-manifest SHA `e95fcc4a634e2b3fcaa12fcf5b393919071a4ab58d743021cd9581f2781defe8`，105 项显式文件、48 张原 PNG；summary SHA `80b5f3bce7306f446aee8f1bcc0eeef1d82610976b26ba8da69b6000d26ebdb0`。首次正式运行 exit1，26 条记录=25 PASS+1 FAIL；其中 **ordinary 13/31 PASS，windowed 0，64组合矩阵0**。25条PASS记录不能误写为25个ordinary样例。首失败后没有重跑；剩余ordinary、全部windowed、source/history操作和全部64组合未执行。

目标 `mindmap-000-first-official-example` fence UTF16 [4024,4425)，对应目标 preview 缺失，没有目标 img。`Timeout: actual image decode …` 是等待断言名称，不是解码器故障证据。页面保留的 previews 是之前 [3378,3644)、[3738,3928)；Root 实际查看 FAIL-x11：前一个 gitgraph 仍可见、底部 mindmap 源围栏可见但后半段在viewport外、已保存状态，没有可见 mindmap 图。Root审阅 SHA `6021bc561db63f05aebb7148f64c8bde0a414b747b0be8946fb101c7e912d50d` 原样归档；归档代理未新增图像审阅。

失败时插件 enabled、errors为空，audit没有denied，JS errors/CSP violations均为空；可见notice为部分内容尚未生成预览且源码保留。249条有限异步 native trace含243 dispatch、两组kill-start/cleanup-complete/cleanup-confirmed，**没有保留native deadline或control-timeout**。没有捕获请求payload，不将任一dispatch绑定到该mindmap，不推断完成次数、decoder根因或无超时的普遍保证。renderer/service admission 路径仍未定位；历史deadline仍未关闭。

运行后2912 source检查无差异、25inputs未变、documentsExact。App/driver已退出、4626/4627不可连接，guardian375565已终止但仍是PID1下Z，不能称全部身份不存在；没有安装完整后代 census，UI清理审计不是五生命周期清理证明。共享Xvfb未动。生产05前一批五例55身份absent与本UI批次guardianZ属于不同批次，必须分别保留。

## 第一批实际构建身份

实际 production05 deb 构建首次通过，89.871030s；提取 executable SHA `63205c85b11fbaa7ec0ec0316737eabb8fe9a96115a4a06367dbd8d59322af7a`，21,872,816 字节。deb SHA `a061fa33821a10f6b4dc26dd815ed9ae51bedeee91a8bb5533a6d094eb1d7376`。不是 diagnostic8041/02b15，也不是独立回归 test owner。

构建/最终审计报告 2912 个冻结源码文件匹配，process 源 SHA `c6540ffc4d11e61050379d68bad0342c0cfaf8ec4a6fe60075b18ddecd851702`；相对 production04 的源码变更只有该文件。构建时记录 HEAD 为 `e370c668666b17abe861a5d3176dc83d57b8d515`，后续 `ea216ff8c54d7736bc9630a461d4166943088f90` 才提交了同一 process 内容，不能将后者标成构建时 HEAD。

独立审阅核验 target/extracted binary 仅唯一 Tauri bundle marker 三字节不同，其他字节相同；完整 15,656 字节 guard 与构建输出一致并嵌入实际 executable。官方 diagrams archive、SDK、guard 身份未变。非 test Rust release 无 warning；Vite 既有 >500kB chunk 提醒原样保留。独立审阅只比较2912清单并核对变更文件，没有宣称自己重新读取全部2912源码；归档代理亦不复制整源码树、二进制或依赖环境。

## 五项首次生命周期结果

| Case        | 首次结果 | Trusted input→DOM ms | 两次 rAF ms |
| ----------- | -------- | -------------------: | ----------: |
| timeout     | PASS     |                   10 |          31 |
| disable     | PASS     |                    5 |          16 |
| remove      | PASS     |                    9 |          21 |
| wm-close    | PASS     |                 未测 |        未测 |
| app-sigkill | PASS     |                 未测 |        未测 |

5 次尝试、5 PASS、0 RED、无 retry、无冻结后 harness 修改。每例原断言要求9个精确 DOM PID/birth 身份消失与私有目录清理；最终审计确认45个 DOM身份、5个 driver 和5个 wait-only ancestor 全部不存在，共55个。交接时4626/4627空闲；Xvfb126留给下一位独立 suite owner，不称所有辅助服务退出。

product harness 命令均 exit0。driver ancestor 工具结束241，是产品判定完成后的既定精确 owned wrapper group SIGTERM 清理，记录 child exit-15，不是产品失败。保留每例自然 guardian exit、reap、原始 native trace；缺失的异步阶段不补造时间，只采用原 harness 明确的观察上界。timeout 从原 dispatch 计时：deadline-observed 2.000163297s、kill-start 2.001704172s、cleanup-complete 2.101721531s、cleanup-confirmed 2.125908777s；这些与输入响应表是不同测量，不互相替代。

两次 rAF 数值仅是各例单次样本，不是所有帧间隔或普遍响应上界。观察开销不扣除、不作 CPU 归因。原 PNG 和原日志全部按清单保存；Root 实际看 timeout failed-card、disable/remove complete 三图并审5份 raw event，归档代理不冒称新增视觉验收。此套仅验证实际05 binary 的通用 DOM 生命周期，**不代表官方 Mermaid 31×2/64×5 UI 矩阵通过，不证明历史 deadline 根因或历史 RED 已关闭**。

## 精确归档与检查

三批共1035个 source aliases，551个本地去重对象 / 9,390,627字节，161个旧检查点对象 / 10,204,575字节跨引用。88个PNG来源别名，68个本地去重PNG；来源按批次为23、48、17，内容相同则跨引用/去重。493项中488主体按原SHA/长度实读核验；5份小测试 `fixture.milkup-plugin` 的清单SHA/大小与 checkpoint06 已保存对象精确对应，只跨引用，不重读或复制源 archive 主体。原manifest保留其fixture例外说明，但本增量仍避免复制任何新archive。

累计6项 official executable/deb/guard/plugin archive/SDK 来源引用总40,865,748字节（含不同原路径的同一archive身份声明，不是唯一artifact大小），仅保留 completed manifest 的路径/大小/SHA声明，归档代理不重读主体。profile、SQLite、cache、target、整frontend/source树均不归档；每run明确冻结的68份测试输入快照、源码清单和审计原件保留。raw字节不格式化。

两份完成审阅均保留；其中 lifecycle Root 审阅的 research 原件与 owner 副本分别建立 alias，相同内容按 SHA 去重；checkpoint09 remote元数据固定提交 `ea216ff8c54d7736bc9630a461d4166943088f90`，归档代理不重复网络身份查询。固定checkpoint06/07/08/09 index SHA写入索引。静态对象/alias/无孤立对象/无symlink验证：

```sh
python3 verify-index.py \
  --checkpoint06 /workspace/milkup/docs/evidence/v2-product-phase4-mermaid-engine/checkpoint06 \
  --checkpoint07 /workspace/milkup/docs/evidence/v2-product-phase4-mermaid-engine/checkpoint07 \
  --checkpoint08 /workspace/milkup/docs/evidence/v2-product-phase4-mermaid-engine/checkpoint08 \
  --checkpoint09 /workspace/milkup/docs/evidence/v2-product-phase4-mermaid-engine/checkpoint09
```

累计1024项source主体SHA/长度声明匹配（第一批488、第二批106、第三批430，包含manifest核验）；5个第一批fixture档案单独按旧对象引用，不算新源body核验。第三批敏感模式匹配3次，均来自两处明确测试夹具的示例 `/home/me`、`/home/user` 路径，逐处审阅无实际凭据/私人内容；前两批候选0。同级入仓后可省略base参数。验证与敏感模式筛查仅针对静态归档，不是产品测试；无PNG OCR，不保证任意秘密不存在。外部 checkpoint10-draft 报告属于未自动随本目录交付的支持材料。
