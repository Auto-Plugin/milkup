# Checkpoint21：production08构建与五项生命周期首PASS，完整UI首次冷启动失败

第一批按 `linux-production-08/completed-manifest.json`（SHA `f1f656d9166768cb180ad53d96b949a211cd5f7e0e9e5df933a7ea4d2d081aca`）493项显式相对路径实际核验7,340,809字节，另存manifest、两份Root完成审阅及checkpoint20远端证明。第二批按 `product-ui-runs/control/mermaid-ui-production08-observed-01/completed-manifest.json`（SHA `bad81b17a70dedd1184743d69d0ee7fc54ba7bd0236488c9b48dbb3419e44e03`）逐项核验114份文件、16,905,360字节，全部SHA/大小一致；其中12份frontend构建输出仅核验并保留元数据，102份可归档文件加manifest及Root首次失败审阅按内容去重追加。两份已存在路径复用，净增102个source aliases。没有遍历source/profile/cache树；本代理只做静态归档，没有执行产品、测试或构建，也未写仓库或提交。

checkpoint20已推送commit `ffa662077bfe696b50c43f94691bc88e5f693c14`，远端及GitHub author/committer LarryZhu-dev、id40397402一致由Root记录证明；本代理保存记录、不重复联网核验。基线index SHA `6fb1c0262cd48d0a0621b51680bed0e796ac14c7d9a29454bc3218a6c7dfbccc`，checkpoint06–20既有原件/索引不改，相同对象跨检查点引用。

## 实际新包与构建边界

clean HEAD ffa662上真实Linux deb首次构建通过，102.27秒、exit0。deb SHA `4e61a47901a8952dc6507f0e07f9a4456e7d0db1a4cb136280528f152f80b807`；实际提取程序21872616字节，SHA `cd0f892d274bb363ee663e8b36aead93cbee31a4464bdef26ac849f5018cb304`。Root实际核17项artifact/frontend哈希，target仅唯一三字节UNK→DEB标记替换后与包内程序逐字一致，完整guard已嵌入。官方diagrams archive9889、guard、SDK沿用已有哈希，不是重新构建插件证明；Vite大chunk警告原样保留。

2913项采集源码在build及life后均相同，比production07采集范围多一份restore测试源码。该范围不等于任意全仓文件；原约37MB source正文树与binary/deb/guard/officialarchive/SDK主体不复制，仅冻结清单、源SHA及明确artifact元数据引用保留。小型测试fixture archive和精确prelaunch脚本属于原493显式清单，按原字节收录。

## 五次独立首PASS与时序口径

五项各首次通过：timeout26.58s、disable30.49s、remove27.42s、WM-close25.61s、App-SIGKILL24.74s。每项保留68份prelaunch输入及9个product PID/birth身份；owned-context-cleared早于PASS verdict和外层teardown。没有runtime失败尝试或重试。Root实核5case原记录与最终493项SHA/大小；本代理没有把这些通用DOM生命周期扩称完整Mermaid/UI导航通过。

下表均为**从原render dispatch开始**的秒数，不是从点击、输入或故障注入开始，更不是硬实时保证：

| case        |  kill-start | guardian cleanup-complete |
| ----------- | ----------: | ------------------------: |
| timeout     | 2.005298022 |               2.266302317 |
| disable     | 1.067315023 |               1.190379240 |
| remove      | 0.853506211 |               0.910819828 |
| WM-close    | 0.284119886 |               0.335210208 |
| App-SIGKILL | 0.379653293 |               0.504639912 |

Timeout原deadline观测2.000218811秒，ECHILD cleanup-complete2.266302317秒，App cleanup-confirmed2.330869636秒，control-emitted2.330911824秒。不能写成所有工作恰在2秒停止。本轮WM-close与SIGKILL都有实际cleanup-complete trace；SIGKILL精确guardian另有自然exit0和trusted ancestor的waitpid回收，不借用旧候选的observed/unobservable结论，也没有ancestor向guardian发送signal。

输入响应是另一组离散样本：timeout DOM/twoRAF为7/32ms、disable7/36ms、remove6/24ms，均满足原200ms输入断言；但相应最大观测frame gap为144/281/273ms。**不能由输入样本通过声称所有帧低于200ms**，disable/remove typing还可能发生在cleanup之后。观察器、timer及外部采样开销没有扣除；最大gap与输入到两帧指标不混用。

## 清理范围、离线修正与仍待事项

最终55个记录PID当前absent：45 product与5 driver有birth，另5祖先只记录PID，不能把这5项补写成有birth的完整身份保证。五个精确private目录不存在，4626/4627拒绝连接、Xvfb126保留，均来自冻结audit，本代理未重新探测或发signal。原stop-driver在产品清理后仅对精确owned driver组发送SIGTERM；wrapper/ancestor的−15（shell241）与既有行为一致，不冒充生命周期命令失败，也不伪造成功0。五个harness与finalize本身均exit0。

离线post-run审计脚本发生map-versus-array TypeError，随后静态更正并完成audit，原记录保留；没有runtime重跑，不计为新的产品RED。Root build/life审阅在清单内另有逐字copy，与research原路径通过内容去重保留两个alias；Root completed-manifest审阅单独补齐493项核验。

完整observed UI的首次冷启动失败已冻结纳入，具体边界如下。即使通用timeout测试按原策略清理成功，也不能归因历史UI10 `render2754` 的未知payload/CPU/截止原因；当前 `render_3` 与历史 `render2754` 分别报告。没有Windows运行或上传证明，不能宣布P4完成。

## 完整UI首次冷启动失败：2条records，0完整验收

唯一一次尝试为2026-10-17 00:49:33.401Z至00:50:13.665Z，harness exit1。原始 `results.json` 仅两条：`preinstalled-cold-before-render` 元数据检查及 `FAIL`。原错误为 `Timeout: actual image decode block-000-first-official-example`；控制台 `PASS FAIL` 是通用截图logger，不是成功结论。冷启动目标图片就绪0、独立archive安装0、隔离fallback验收0、ordinary/windowed完整coverage各0、history0、edge0、matrix 0/64，不能把fixture已生成或计划已准备写成已完成验收。

Root实际查看的FAIL WebView截图显示字面block与后续class源码，底栏说明diagrams渲染超时并禁用；不是白屏，也不是已证实的图片解码缺陷。本代理保存Root像素审阅记录，没有补写原results中的截图reviewed字段。两张原PNG均按原字节收录，page error与CSP violation数组为空。六个fixture与冻结catalog重建逐字一致，87项准备输入未变化，均以冻结记录为准。

本次native `render_3` instance `32334888594142dd8481207c9921d47cfd83a3935befe193` dispatch为85795991194763ns，deadline-observed为85797995302212ns，相隔2004.107449ms；kill-start为2004.301282ms，首个App cleanup-confirmed为2190.438188ms，control-emitted为2190.481689ms。没有cleanup-complete trace，精确ECHILD时刻未知。页面在断言block-000图片，但transport观察器仅在独立安装后才启用，该步骤未到达，`observerInstalled:false`。**render_3的完整payload、source及range未知，不能将它认定为block-000或class请求，也不能与历史render2754混同。**

CPU采样绑定App PID463772/birth8578628，保留10个App样本、5个共享cgroup样本；native截止日志观测延迟320.564002ms，未记录工具错误、丢槽或eviction。完整App样本区间4.513972172s内own CPU为0.31s；位于render截止边界内的完整样本区间1.510067704s内own CPU为0.07s，起点比dispatch晚313.187730ms、终点比deadline早180.852015ms。**App CPU不是WebKit/helper/renderer CPU**，不得对缺失的两侧区间插值或把低App CPU解释为渲染器空闲。共享cgroup端点无throttling增量仅是该采样范围的观测，不能排除其他调度/争用原因；原生trace与采样开销未扣除。

冻结cleanup记录显示harness已关闭App，driver `/status` 已返回No sessions，之后仅对精确PID/birth/argv对应的driver发送pidfd SIGTERM，wrapper/driver exit0。四个完整捕获PID/birth身份均absent；sampler及trace guardian仅有PID、无独立历史birth，二者当时absent不补足身份缺口，也不构成全后代清扫证明。4626/4627拒绝连接、Xvfb126保留，CPU/UI slot已释放。本代理没有重探测进程/端口、发signal、重跑、改变budget或再构建。

## 归档与复核

当前索引599个source aliases；152个本地唯一对象共3,643,454字节，123个跨checkpoint唯一对象共9,042,992字节；25个PNG aliases、18个本地唯一PNG。22项外部主体引用共46,936,862字节，包括原5项artifact、12项frontend输出与5项runtime环境/工具；后二者分类与本地对象计数分开。除12项frontend为本次逐项读取核验外，binary/deb/guard/archive/SDK/runtime环境/工具正文未由本次归档读取或复制。约37MB源码正文树保持排除；原始manifest及哈希记录保留。

`verify-index.py` 检查基线index SHA、对象SHA/大小、alias、无孤儿和无符号链接。外部复核入口为 `checkpoint21-draft/verify-final02.sh`；新增 `check-final02.py` 再核验计数、599份source claims、114项本次manifest原文件、frontend排除、首FAIL事实和旧handoff01不变，并输出 `verification02.json`、`source-verification02.json`、`sensitive-final02.json`、`handoff02.json`。这些是归档完整性检查，不能当作产品测试PASS。定向敏感模式审阅不等于任意秘密不存在的证明。

先前 `checkpoint21-draft/handoff01.json` 原字节保留，仍表示当时fullUI pending状态；当时README/index/verify-index和配套审计副本另存 `checkpoint21-draft/first-batch-frozen/`，不将历史pending改写为当前结论。原文、日志、截图、旧检查点和仓库均未修改。
