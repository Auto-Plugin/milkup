# Checkpoint25：诊断06冷gate通过，stage首审计保留缺失端点

唯一native诊断构建首exit0；06原Node冷前缀通过后停止。stage新增五个真实App settlement端点，但render_6无保留的App terminal，原stage auditor首exit1不改。CPU覆盖仍不完整，没有关闭历史production08未知输入/超时根因，也没有完成生产、fullUI/matrix、Windows或P4验收。

固定基线为checkpoint24本地commit `da6a9d676b791c4b367ada1c0c989d886f535921`，index SHA `e4ac704e50c7ebfbbc45fffb53ac194d0276adbc588593fe87621628621839c9`；该commit未push，原`root-local-commit.json`保留。产品代码仍为`ffa662077bfe696b50c43f94691bc88e5f693c14`，原INIT10s/RENDER2s不变。归档代理只写外部staging/draft，没有产品运行、测试重跑、live proc读取、signal、repo修改、commit或上传。

## 原首结果

| 项目                | 原结果及范围                                                                              |
| ------------------- | ----------------------------------------------------------------------------------------- |
| Owner JS纯测试      | 首exit1：8PASS/3FAIL；仅失败3项修正后exit0，8份源码overlay未变，已PASS项未重跑            |
| Owner Rust纯测试    | 首编译exit0，首11tests PASS，warning保留；不当作native集成证明                            |
| 审计器纯测试        | request首12tests、CPU首14methods，各实际exit0；合成结果不是实际运行结论                   |
| 唯一native构建      | 首Cargo exit0、57.758554s，无retry，3项warning原文保留；不是production08 DEB              |
| 06 Node harness     | exit0、DIAGNOSTIC_PREFIX_STOP，仅原cold gate                                              |
| 06 CPU / wrapper    | CPU exit2、app-terminal、failure=null；wrapper保留sampler==0断言exit1，不是Node cold FAIL |
| 实际strict wire审计 | 首exit0，完整冻结driver六个dispatch均有完整wire                                           |
| 实际stage审计       | 首exit1、integrityOk=true，唯一gap为render_6无App terminal；未缩scope或重跑               |
| 实际离线CPU审计     | 首exit0，明确1个unresolved request；计算完成不等于完整端点或精确request CPU               |

Owner首JS失败为测试对刻意null-prototype数组调用.some；首次formatter只读home错误和Root首次test-path hash mismatch均保留。修订测试曾以原`bootstrap.test.mjs`路径执行，随后原字节恢复，修订字节另存`bootstrap.v02.test.mjs`；原命令、revision02 manifest及恢复映射不回写，不把实际执行路径改写成新名。prepared/final输入、GO、全部首命令/退出/stdout/stderr均原样保存，详情由index定位。

构建后8overlay恢复、3个新增模块移除，145 immutable inputs/2913源码/12frontend/旧生产binary/官方archive不变。两个shared target是预先声明的可变输出，run05 immutable artifact引用保留，预期变化不算input drift。新binary SHA `ac7ca012ecd6150725bf780563446a57b01d8b708672f9d5f80fef86b9b57d15`、22,018,488 B；SO SHA `0355b69f0f15e4d0efa5f5ab137d45b8342233f32b16c0240521a45695a6f8f3`、16,824 B。Root确认完整SO唯一嵌入offset3,529,248；本代理未读artifact body。

## 06支持的结论及边界

运行后403输入、2913源码、12frontend及旧production binary/archive核验不变。Root实际查看两张原PNG：light live、DB/A/B/C/D block和部分Animal class，saved/11872characters，无timeout notice；已知字面`&nbsp;`保留，X11黑色区在应用窗外。仅冷viewport，不是fullUI/scale验收。driver address-in-use warning原文保留，未指认为阶段耗时或缺端点的原因。

完整wire为1guardian+6render，各UTF8/hash/UTF16源范围独立核验。render_1/2/4是block `[108,342)`，render_3/5是class `[440,969)`，render_6是ER `[1087,1257)`；只属于本实例，不能回填production08未知render_3或run03缺失render_6。native armed/result、raw fdinfo、外部四节点链与argv证明WebProcess477775/birth9531969、helper held FD21；不用NSpid内层2做外部PID映射。顺序身份brackets不是原子快照、ABA排除、未来exec或全树保证；链节点477774没有CPU样本，不能补算。

App33rows/10,357 B、helper108rows/37,062 B各status==complete、final/closed，记录drop/error/inFlight为0。五个同App dispatch→settled局部跨度256.553764/131.168135/587.621558/189.326746/263.589757ms，ok=true；JS invoke局部跨度244/120/580/137/256ms另算，不能跨列相减成IPC、CPU或仪表化开销。这里只分出外层调用，没有定位Mermaid parse/layout/SVG等内部原因。

render_6有完整wire/dispatch、成功pipe completion和helper evaluate callback，但无App settlement/deadline、helper output或JS marks。evaluate callback不等于async renderer完成；缺失不能指定为timeout、卡死或ER根因。stage final只表示自身观察集合关闭/排空，不是所有端点或生命周期完整。原2s失败未重现，不据此提高预算或实施产品修复。

CPU21轮/130 member records中124有效、4terminal、2missing/identity-changed；sampleIncomplete0只是行预算标志。WebProcess15有效样本/14相邻区间内own CPU2.27s，不含首72ticks及末约252.673ms尾部；AppCPU不等于rendererCPU，leader schedstat不是全线程等待，无共享cgroup数据。仅render_3在未证实的App/observer坐标相等假设下容纳两个完整区间，条件性WebProcess CPU0.78s不是精确、独占或因果request成本；render_1/2/4/5窗口CPU为null，render_6无endpoint不生成窗口。所有关联始终标记`unverified-coordinate-assumption`，不填0或插值。

10/10 discovery incomplete，53 children接口gap、14普通pidfd gap及1 native缺record gap；741次共享fdinfo计数未扩原限额。四轮超过协作式5ms、max7.975660ms，不声称硬实时或超时根因。stage capture、helper collection、writer CPU和observer开销互有嵌套，不能相加/相减制造零扰动或完整成本。同步JS堵塞可能丢失未drain marks，缺mark不能定位阻塞。

## final checkpoint校准及独立审阅

CPU原REVIEW两处把wire final简写为closure，字段`lastSampleToWireCloseNumericNs`也沿用该命名。原20文件不改，独立addendum明确：95324334286607ns只是wire writer final publication checkpoint/sample，不是实测actual-close、stage-close、request terminal或精确filesystem发布完成时刻。181.920949ms仅为条件性末WebProcess sample→final checkpoint差；200.909394ms仅为App dispatch→final checkpoint差。实际关闭单调时刻未记录，不据此补render_6或CPU边界。

| 冻结审阅                       | Manifest或文件SHA256                                               |
| ------------------------------ | ------------------------------------------------------------------ |
| Request，12文件                | `4c392562c88983d6935e24d97b673a8f8626892154faa95f67b0a6793cb25158` |
| CPU，20文件                    | `324d8b34eca71d044f04a3e96f2b23a284f48c3aec2d1d2221d1fddcd834f8d8` |
| CPU语义addendum                | `a091836e57d3137baebd46d22df7b86c3a1f84a19835a10c46f1ff864e85414b` |
| Root实际pixel/full-hash review | `952a38641446fbe0ee893f3dbd7a3970b65f732882e2cd4a65ab86deb3e9695a` |
| Root对review的独立hash复核     | `ca1990a5996559df5322764d03e659c7bae00c197d2650160b5465a70b5c3433` |

清理原记录为19个birth-qualified身份absent、另3个无birth断言的launch PID absent、专用端口无listener、11reaps；专用Xvfb按环境意图保留。不是未知进程树全空证明，本代理没有重扫或signal。旧01/02 setupFAIL、03 strict首FAIL及production08冷首FAIL沿固定基线保留，下一层研究不纳本检查点。

## 选择性归档与复核

最终223 aliases/10,776,908来源字节；173个本地唯一对象/2,557,034 B，23个fixed crossrefs/8,148,327 B，2个新增PNG。34项artifact/compiler/rlib引用/164,637,486 B按路径计数，含旧基线metadata，不是新增正文或唯一artifact体积。

run06完整manifest SHA `dc3ed51b01ef044a6056126cfb42eee3f34b16131f6612cc0a791cf78e48afe4`，218项/17,674,262 B保留；本代理实际核74项非profile/8,594,182 B，144项profile/cache/安装主体9,080,080 B仅metadata。reviewer完整主体核验按各自报告引用，不冒称本代理读过全部body。build28项/22,725,624 B完整清单保留，本代理核26正文/690,312 B，2 artifact/22,035,312 B仅metadata；owner48项清单的47源码/文本正文与1个Rust测试binary metadata分开。

binary/SO、target、frontend、node_modules、profile/cache主体不复制。raw不格式化，README使用仓库Prettier；prepared-handoff/capture历史保留。`verify-index.py`核固定基线、对象SHA/大小、aliases、去重、孤儿及symlink；外部`checkpoint25-draft/verify-final01.sh`核来源、首失败及结果边界，生成handoff01。定向敏感模式的两处`/home/agent/.rustup`仅为标准sandbox formatter首失败原文及summary，已逐项复核、无未解决候选，原文保留；不是任意秘密不存在证明。所有归档检查PASS只表示证据完整性/格式。
