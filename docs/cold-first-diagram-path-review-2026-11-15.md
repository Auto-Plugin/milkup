# 冷首图长尾：保全证据到当前代码的只读复核

复核基线 `e414e3ff0a6a4b91d20a2aca328101aa973b3e72`，产品仍为 `0e4e8c58`。仅阅读已保全的脱敏报告及当前源码；未重新解密/公开 trace、运行应用、构建、派发 CI 或 ETW。本轮没有产品补丁：现有证据不足以把某个尚未修复的应用阻塞安全移出首屏关键路径。长尾保持未解决，不以更快单样本或加载占位替代。

## 样本分开映射，不拼接成一次启动

| 实际样本 | 时间与证据 | 对应当前路径及结论 |
| --- | --- | --- |
| 43151150510，历史最慢普通文档样本 | process→navigation 3141.1ms；assets-read 18331ms，frame-loaded 18575ms，engine-ready 19802ms，render 19814→20621ms，首次 decode 20634.2ms。render 807ms，之后观察间隔13.2ms。 | 早期无完整浏览器角色/文件 I/O 分段，不能把后来 Cookie 的归因套到该样本。4694ms shell-create/paint 间隔、早期 IPC/目录慢均有记录，但未解释18331ms以前全部时间；不能算成 Mermaid 计算耗时。 |
| 43197922164，pure B 新临时 profile | 首图20289.3ms，constructor2811.6ms，navigation→Wry14105ms，实际成功render395ms；57个主循环探针最大4.329ms。 | `lib.rs::run` → Tauri/Wry environment/controller/init/navigation → 主文档 protocol callback。主要等待在前端模块运行前；仅重排 Mermaid 或首文档 JS 无法消除该14.1秒。 |
| 43200029365，filtered B 新 profile | 首图19661.9ms，navigation→Wry15060ms，render347ms；61个队列探针最大12.414ms。 | 反证“只在纯标准账户”假设。两个 run 不同构建字节/VM，不能当严格前后优化比较。 |
| ETL 43513112486，B 新 profile | product PID3140→browser872→network1788/TID528，以出生身份/区间绑定。navigation57.591606s→Wry66.750606s，9.159秒；cookie-finished66.753081s→WebResourceRequested66.753941s。 | 网络服务的 Cookie 数据库初始化接近请求放行；前端脚本大部分尚未执行。7.090秒 off-CPU 中 ready等CPU仅5.480ms；5.141秒同步刷盘栈、1.390秒NTFS资源等待。不能归因具体服务/过滤驱动/物理磁盘。 |
| 同 ETL，A 首次 profile/目录 | built→setup10.619秒；WebView创建前主线程hard-fault读取 EmbeddedBrowserWebView.dll，随后browser读locale/ICU，renderer读ffmpeg/V8资源；Cookie flush与之重叠。 | 属于Wry/WebView构造之前及其中的库/资源初始化，不能将重叠线程时长相加，也不能与B统一成单一Cookie根因。 |
| b877 filtered初次目录 | 首图11984.4ms，navigation→Wry5458ms，Wry自身2.399ms；准备/批准/begin-trial/commit合计约4.64秒，render212ms。 | 目录工作确在激活前，但各转换仅一次；读/读worker不写。慢点包括打开句柄前、write-through、flush；队列/锁等待不是已证主因。独立持久检查点不是无谓重复保存。 |

所有首次decode值都包含观察/附着延迟，不能冒称精确物理首次绘制。不同时间原点只在原报告已校准范围使用。最慢20.634秒记录没有足够进程/存储字段，不伪造其细分结果。

## 当前代码路径与能否移出

1. `apps/desktop/src-tauri/src/lib.rs::run`（约1060、1087、1226–1255行）记录build/setup边界并安装前端帧guard；`vendor/wry/src/webview2/mod.rs` 的 `create_environment`/`create_controller`、`init_webview`（约288–540行）完成环境、controller、初始化和导航。profile目录经已有WebContext传入，不存在本次发现的“每图重建浏览器”。改变Cookie、持久目录、跨用户复用或增加后台浏览器都不是现有证据支持的优化。正常退出仍须等待前端owner退休，不能保留活浏览器制造热样本。
2. `main.ts` 约906行已通过现成原生桥调用catalog，避免初始布局后才动态导入；约2026–2066行先启动 `openInitialDocument`，完整catalog-ready回调反而等待该文档。`openInitialDocument`/`openSelectedDocumentAfterConfirmation`（约3219–3367）进行元数据、真实读文件、内置Markdown解析与显示；启动普通Markdown跳过插件文档探测。不能再提出“等全部插件完成才打开文档”作为当前根因。
3. `desktop-plugin-manager.ts::initializeCatalog`（约633–760）读取权威目录、处理未完成迁移/试运行、恢复批准的插件并检查随包升级。恢复循环是顺序的，理论上前置插件可能延迟后续插件，但现有最慢样本未提供“某个无关插件工作占据关键路径”的实例证据；贸然并行会影响目录revision、生命周期和发布顺序。未准备这种补丁。
4. 同文件 `enableCatalogInstance`（约821–876）必须 `startupBegin` → 受限实例 → `startupComplete` → publish；候选使用 `beginTrial` → commit。`publishCatalogInstance`（约784–819）重查epoch后立即复用/创建唯一owner并异步 `prepare()`，无需等待剩余bundled目录I/O。原生 `plugin_catalog.rs::save`（约979）保存有效旧主本到backup，再原子替换有新revision的主本；这些是失败恢复门槛，不能延迟到首图以后假装已经批准。
5. `frontend-mermaid-service.ts::fixedScript/connect/render`（约130–425）共享一个connection，等待原生guard，按精确长度/hash读取同源固定引擎，再建立opaque frame/专属port、检查边界，最后接收源文本渲染。已有明确批准后的提前准备；不能新增未批准预热、跳过完整性/桥检查、延长截止或放开并发。诊断模式的audit还会等待原生记录，需与无诊断用户路径区分，不能直接删除它使测量变快。
6. `main.ts::refreshPluginContributionsInViews`（约2870）已有精确scope/document/rendering/bindings未变时保留owner的catalog-ready分支（3c658aa4已集成）。`document-png-image.ts` 在实际decode后记录首图；8f7fefdf只为明确插件渲染策略提供pending占位。两者分别解决初始化重复与源码采样闪现，不能算长尾修复。源码/混合编辑语义及纯前端架构保持。

## 已有反证限制继续尝试

- 普通profile对照32次，20次保留profile样本约2.56–3.43秒；正常用户profile本来就复用，不代表首次配置成本已解，也不证明热启动没有长尾。不能清用户数据或另造共享profile。
- 已安装b877的none/late/early附着对照各两次未复现20秒，不能认定WebDriver为唯一原因；不追加普通启动重跑。
- 43189737359首例environment API自身5.929秒，回调在API返回前0.129ms到达；不支持改消息泵消除多秒“回调后卡住”。
- 唯一定向增量43522696501启用了FileIO/Minifilter/DiskIO但未重现原9.159秒区间。它没有建立唯一的file→filter→storage链，已按停止条件结束，不能据此改安全服务、同步刷盘或系统配置。
- 空视图无意义layout读取已有修正/局部证据，但没有证明20秒长尾改善；不重复作为新优化。已安装初始化刷新/稳定40次光标与占位验收同样不复跑。

## 需要的全新证据与本轮停止点

若未来重新授权此方向，必须先出现可区分因果的新材料，而不是再跑同一矩阵：

- 对确切慢样本，提供匹配出生身份/时钟的完整主文档与catalog分段（入队/原生起止/回前端/插件id代次）及审计开关，证明具体**非必要**工作挡住首图；现有20.634秒样本缺该覆盖，其他run无法补造。若证实无关工作，才为顺序、撤销epoch、首次批准、关闭、失败重试设计受控本地合同。
- 若慢点仍在浏览器请求放行前，需要运行时维护者的可验证因果说明或已有同样慢区间的可关联I/O/资源拥有者证据，以及不改变持久化、安全和profile隔离的受支持修复。现有guest trace不能支持指认过滤驱动或虚拟化宿主磁盘；不要求再次采集，更不要求用户改机器安全配置。
- 任何将来优化均需精确候选的真实冷启动收益证据，不能用本地Promise时序、缓存命中、占位或更换时间起点证明尾延迟修复。

本轮没有符合以上条件的独立最小产品改动，因此不提供猜测性补丁或新测量接线。不再新增边缘验收；以[五项矩阵](release-five-gaps-closure-2026-11-15.md)收口，保留冷首图长尾及默认Linux导出等未完成项。未改main、正式渠道、发布、通知或安全/持久化。

## 已存证据入口

- [原20.634秒与b877目录分解、安装附着对照](release-quality-integration-2026-11-12.md)。
- [profile冷/热及执行顺序对照](https://github.com/Auto-Plugin/milkup/blob/636da79a/docs/startup-profile-comparison-2026-11-12.md)，以各段原run身份为准。
- [ETW已保全脱敏分析目录](https://github.com/Auto-Plugin/milkup/tree/9c6bef0b/docs)：`webview-etw-startup-results`、`webview-etw-wait-breakdown`、`webview-etw-targeted-io-results`（均后缀 `-2026-11-13.md`）。原始trace仍私有，不随本报告复制。
