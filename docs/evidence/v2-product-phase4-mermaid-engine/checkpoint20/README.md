# Checkpoint20：受控03 RED→同案例04 GREEN，原生集成验收待完成

本批只收明确完成的 `window-navigation-multirow-browser-03/completed-manifest.json`（SHA `502dab64e29bb5ba0ac7575346bd37cdf7bda548b2bf584744007b719f364dd5`）26项显式文件、manifest自身和Root独立审阅。所有条目实际SHA/大小核验，summary SHA `b3aea49c25343e7cded6a2ab7bc22de1174008e1e59c7f515536986bd8f56288`。未读取活动native、产品修复、04或其他未完成研究；本代理未运行测试/构建/原生程序，未写仓库或提交。

## 实际首RED与证据边界

首次Chromium运行retries0/exit1，真实setup已建立77行围栏、76行collapsed及已解码受控图片。public source read在逻辑选区8103..8160已赋值、目标398仍mounted/visible后等待2个真实RAF，实测30.4ms；provider另等待8观察帧约141ms，两个safety timer均未触发。

该await期间围栏恢复77行literal、自然scroll7191→8377；随后读取419..523的窗口应用为mounted427..506，排除了目标398，早先syntax读取才恢复。navigation虽然resolved，最终marker=null，projection/caret均无，16个settled frames保留该状态；逻辑选区仍8103..8160、source版本0及字节未变。首断言 `expect(result.final.marker).not.toBeNull()` 实际FAIL，属于已到达主要导航断言的受控RED，不是setup错误或0.21875px边界失败。后续断言未执行，空projection/caret是saved DOM独立观察，不补算后续断言PASS。

Root审阅 `multirow-browser03-root-review.json` SHA `9f906d7d1e7b552c283951a3001ec9b5dc07f20b64bd538b8fa67f5213a4ff23` 已核26项并实际查看result.png：显示后续sequence025/026/027源码，目标000不在画面，未见选区/光标。最终top spacer底端−539.71875位于viewport上方，**不是旧原生整viewport白区的同形复现**。本代理没有另作像素判断。

案例是修正前缀语法的580行受控公开source契约/Chromium，不是真实IPC或Mermaid/WebKit/160k完整历史。未直接观测私有测量cache或ResizeObserver回调次序；公开read/DOM/source支持受控时序缺陷，但不自动确认旧native白区或历史deadline相同根因。没有产品改动、重试、人工scroll、refresh或放宽主要断言；合法provider窗口排除旧围栏时返回空数组，不能改称强制遗漏。

## 原件与验证

两张PNG逐字相同（SHA `8fc3826a6b078ced41da04b95d12efb32f5787e7ee570e033093df9d601a30c0`），保留两个source alias并按内容只存一份。trace.zip（429635字节，SHA `a79f14e9c5b7ef291995882c979d74e8a20b250e482c792e175d680a4a168d17`）已核验，外部原件保留、不复制或解包；本检查点不是该trace的自包含归档。

旧相同内容引用checkpoint06–19索引；checkpoint19基线commit `63c7a54fe20bdf9519b148e029833c0bfe07474a`，index SHA `b065dfae3f5e803e158ffd384e6893789f34e22ae642864b8e43a0a4ce276766`。没有重拷19历史PNG、改写旧raw/索引或把旧研究结果合并为本次PASS。

`verify-index.py` 核验固定基线索引、所有本地及cross对象SHA/大小、alias、无孤儿/符号链接。外部支持命令 `checkpoint20-draft/verify-final01.sh` 显式列出checkpoint06–19全部路径；draft提纲是早期规划，不是runtime证据，后续完成manifest才可新增。初批没有修复或native同case结果；第二批后来单独收录原02 WebKit基线，仍无03同case native结果、04 GREEN、正式全矩阵或历史deadline关闭声明。

## 第二批：原02的WebKit基线PASS，不包含03 source gate

按 `product-ui-runs/control/mermaid-ui-window-navigation-multirow-01/completed-manifest.json`（SHA `7dbcc47ec171555cebad1b51db8a401e809f3432e42286b3d57670153680c49e`）相对evidence-root的53项显式文件核验1,013,598字节，另收manifest及Root审阅。仅列出的已冻结准备/运行文件可读，没有展开活动修复、04或其他目录。外部产品/依赖/构建输入路径只按manifest转录SHA/大小，未读取或复制当前可变源码树/binary/archive；不以历史路径宣称当前源码仍一致。

该首次运行exit0，复用production07 WebKit/CSS，单独打包相同public classes和受控矩形provider，运行原02的selection-provider-only案例。完整77行/76collapsed初始化成立，恢复literal后目标398、selection8103..8160、projection/caret仍在；provider8RAF实测482ms，source版本0/字节不变、errors/drops0。它**不含03 public source read跨两RAF gate**，不反驳03真实RED；也不是实际desktop document view、file/search历史或官方Mermaid executor/deadline验收。没有重新collapse/decode阶段、没有产品改动或预算延长。

Root审阅 `native-multirow01-root-review.json` SHA `9ff9667e00d2939d0e167ecd0ad91a2f1f7a42f608140e8b8346f04a0d4cfccb` 核53项并实际查看result.png：marker选区、caret和后续literal源码可见，无整viewport白区。截图helper在原case snapshot返回后额外等200ms，原断言仍基于原返回snapshot，不能混作同一采样时刻。本代理没有重新执行或扩大视觉结论。

finally trace/screenshots保存；冻结audit证明四个已记录精确identity均absent、4626/4627拒绝连接、Xvfb126保留，未新增全descendant采样或全进程inventory，不表述为全进程均消失。本批保留原02WebKit负向基线与03Chromium受控RED两个不同范围，第二批冻结时仍等待修复/guards/04；第三批后来依明确完成清单收录，未读取活动临时切换的仓库文件。

## 第三批：冻结修复ff6256、同case04首次GREEN与focused112PASS

只按已完成04清单26项（SHA `63e1d79f2a18e9b895a99c96f141b068128090bbc0dff7b0d5be25e47adc5499`）及focused01清单9项（SHA `835f8680793b3dd21a09e8ecd580893e7dcd5ff87a83957f49bff5707b9b16a3`）逐SHA/大小核验；另存两manifest和Root审阅。03首RED与前两批原件保留不变。04 trace.zip791213字节，SHA `e8081e86ed49d0005b599782bb02b4db8170f0c8ade8356f4d01e56f15ab2bba`，仅外部核验引用，不复制/解包。

04冻结输入与03的204项runtime repo输入对比仅 `document-presentation.ts` 从07cb变为 `ff6256e3021c2bee18b404c66809301ec14399dfd954d4eaf3d5041746436013`；测试case除了03→04输出目录逐字相同，fixture不变。修复在restore路径同步测量已恢复literal行后再恢复anchor，并防重入/失效context；归档使用冻结source snapshots，没有读取当前临时swap仓库源来替代证据。原source-comparison中的“NOT_EXECUTED”是准备时状态，后续execution/summary单独给出实际首GREEN，旧原件不回写。

04首次Chromium运行retries0/exit0，2个真实RAF source gate实测55.3ms，未触safety timer；同样77行collapsed→literal、自然scroll8377。03最终mounted427..506且marker398消失；04维持318..447，marker398 top37.59375、精确selection8103..8160和caret8160在16个settled frames中保留，主要断言全部执行通过，source字节/version0不变、errors/drops0。这支持受控测高/anchor次序修复；不宣称两次耗时相同或精确历史原生因果。

Root `multirow-browser04-root-review.json` SHA `7d9c156077973ffa611ab89a3f538a0513684f52212b576d700bd4a91123b81d` 已核26项并实际看result.png：目标marker选区及后续literal源码可见。caret精确DOM证据独立于截图blink。580行受控矩形provider/Chromium不是实际Mermaid、nativeIPC、完整160k历史；最终provider窗口仍排除旧Sankey，没有重新collapse阶段；私有height model/RO callback未直接观测。

focused01首次Vitest/jsdom为3文件112/112 PASS，含18新增restore guard测试、0retry。9项原件152050字节含command/execution/first.log、before/after四源SHA相等及四份完整源码快照，manager同ff6256。这是owner实际单测结果，本代理未重跑；单测不替代真实浏览器或原生验收。

当前仅上述冻结研究对照和单测已纳入。正式e2e、产品临时swap及后续原生集成活动均未读取；历史原生白区、Mermaid deadline、正式全矩阵仍待对应验收，不用受控GREEN替代。

## 第四批：正式回归旧实现首RED，修复整文件36项首次GREEN

`window-navigation-formal-regression-01/completed-manifest.json` SHA `f5e9c891912cb260c36d5b4a02db8df39bf040fdb568e31ed4f6cbedb455f030` 的110项全部SHA/大小核验。73项非ZIP原件、manifest及Root审阅收录并按内容去重；37份trace ZIP共34,317,845字节仅外部原件核验引用，未复制/解包，不能称本归档自包含这些trace。原旧RED和修复整批结果分别保留，没有覆盖失败记录。

正式持久化用例用旧manager07cb单项首次运行，两个真实RAF source gate约29.9ms后marker-null主要断言FAIL，mounted427..506；后续断言未执行，旧projection/caret空由raw DOM另证。随后恢复修复managerff6256，完整 `desktop-markdown-extensions.spec.ts` **36/36首次通过**，JSON duration320957.456ms，36个结果均retry0、skipped/unexpected/flaky全0。新用例实际两个RAF约38.3ms，窗口318..447、marker398及精确selection/caret保留，source字节/version0不变、errors/drops0。既有35项相关用例同批执行，但不把新case本身扩大成user-scroll/source-version/theme变更覆盖。

206项输入在各自运行期间不变，临时切换前与最终输入一致，manager已精确恢复ff6256；正式test SHA `618c6f0a3de813795672d767c07d263df73a4fd1fb6bd7b2b0d44a6dfa5b1672` 与夹具快照纳入原件。本代理只读冻结清单，不读取临时swap或现repo产物代替。Root审阅 SHA `6b45e45f017576a9d48f4aa8671981128c0d0100c152d6ec82bc797e766f6073` 实核110项并实际看before/after两PNG：旧图为后续literal源码，新图为选中target000；caret精确几何另有DOM证据。

实际平台是Linux Chromium，desktop-msedge仅项目名，不称Windows/Edge或原生Mermaid通过。cleanup无active owned/related、端口空闲；PID452995仍为PPID1下Z，不能写全部身份消失。exit0和清理完成后发生的只读报告提取transport断连另留记录，不是运行中断、测试重试或产品更改。

正式browser已完成，其结果与研究04、focused112分别计数。第四批冻结时gate08尚待完整清单，后来依第五批单独追加；production08构建/生命周期/集成原生UI、全矩阵和历史deadline因果仍未以浏览器或全仓门禁代替。

## 第五批：全仓gate08四命令首次通过，production08仍待验收

按 `repository-gates08/manifest.json` SHA `f9c036a5a74be0f250d5dec44ab7acc360c194c3bce21b0cbe8e9a9d8efbc794` 的12项实际SHA/大小核验，另保留manifest及Root `root-gates08-manifest-review.json` SHA `dbaf788fdfd0f3f4cff52dc6d2fe05df73f25d61836ab8942fa9f5b2c0b05cac`。原始四日志/执行/计数审阅及输入清单保留，没有重跑或覆写早期阶段记录。

类型检查、测试、lint、构建四条命令均首次exit0。逐包真实日志为2069项Vitest加独立4项Node，共2073；focused112、浏览器36和原生基线是不同范围/独立执行，不能再累加成新的全仓distinct计数。17971项source条目的字节数/SHA前后完全相同；before/after JSON本身含采集时点等元数据而哈希不同，不能称两份manifest文件逐字相同。

三处官方diagrams archive均复用SHA `9889f1796f9080ff230a1c51147522e83e065bc191a258035208f69403a327df`、5726838字节，未重建插件、SDK或external archive，本归档仅保存其元数据引用。Vite大chunk警告按原build.log保留，不是失败。本次build是仓库构建，不是新的Tauri/native deb构建、生命周期或正式UI。

本检查点保留受控03／正式旧实现首RED、04／正式36GREEN、112 focused及全仓2073PASS的各自原始证据和边界。production08原生构建/生命周期、正式UI与矩阵仍待新候选实际验证；历史白区、未知deadline因果及Windows未完成事项不因这些通过关闭。没有收集production08准备脚本或活动文件，所有历史对象和索引不改。
