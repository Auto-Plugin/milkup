# 第四检查点：产品原生后端与静态 SVG 转换

此目录归档正在进行的 P4 Mermaid 研究和实现证据，不代表整个编辑器或 Mermaid 全图型已验收。[index.json](index.json)记录每份原件路径、字节数及 SHA256；原始文本追加 `.txt` 后逐字节保存，PNG 是未缩放、未拼接的原图。

## 输出转换与像素

- `converter/execution-first-two-rounds.json.txt` 保留最初转换失败、命令和阶段记录。后续 round03/04/05 摘要继续保留实际修正过程，包括漏计组变换的真实回归。
- round05 的五份官方样例结果与 `host-validation-round05/results.json.txt` 配对：flow、sequence、journey、sankey、class 的实际 AST 均通过独立宿主验证和规范序列化。这不是全图型通过，也不是像素验收替代品。
- `pixels/converter-paired-journey-first/` 与 `pixels/converter-paired-flow-first/`：每组 original-inline/canonical-img 的 PNG 逐字节一致；执行代理与根代理均实际查看原图。仅 Linux WebKit、1100×800、light、zoom 1。
- `pixels/converter-paired-sankey-first/`：原始 SVG 与规范图片有可见差异，59,691/880,000 像素不同，不计为通过。
- `pixels/converter-paired-sankey-diagnostic01/`：三路定位中 original-inline/canonical-inline 的 PNG 逐字节一致，canonical-img 仍有相同差异。实际 CSS 尺寸均为 600×406.90625，图片 naturalHeight 为 406。这支持问题位于 inline→image 边界，尚不证明小数尺寸量化是唯一原因。内联仅用于研究，不改变产品图片隔离设计。

随后 `outer-viewport/` 的首次外包视口候选将差异减少到 21,068 像素，但没有消除，不计为通过。`integer-viewport/` 保存下一次独立候选的完整原件：外层视口按精确尺寸向上取整为 600×407，原规范内层 SVG 字节不变，图片采用同样整数尺寸；外部布局槽仍为原来的 600×406.90625。

整数候选首次原生执行中，controlled-original、canonical-inline、canonical-img 三张完整 PNG **逐字节一致**，差异像素/max/mean 均为 0，执行代理与根代理均实际查看原图。没有布局槽的原始截图与控制图在图形区域也完全一致，仅多出用于观察重排的 640 像素 footer；footer top 始终为 422.90625。72 个节点样本的 CTM、screenCTM 和屏幕矩形一致；已有数值精度转换带来的少量 getBBox 末位差单独记录，不冒称所有中间浮点数逐位相同。渲染 0.479 秒、诊断帧 259,169 字节、cleanup 无残留。

该证据支持使用整数图片栅格包围原精确内层视口，同时保留原布局足迹；不重写图表坐标、不增加任意固定留白。它仍只验证当前 Sankey 在浅色、100% 的单一样例；其它图型、主题、缩放和根边界/阴影仍需产品矩阵验证。

渲染仍使用独立两秒截止及 256 KiB 输出限制。后续图片解码、两帧等待和截图属于单独的研究阶段，不能延长或补救渲染截止。未知有效样式、有效动画或无法完整表达的普通图形仍须整图回退源码，不能删除后报告 ready。

## 产品原生后端

`native/validation-summary.json.txt`、两个 `command.json.txt` 和原始日志对应冻结 build02 的两次首次执行，均 exit 0，无重试。13 份源码、构建/测试/guard 二进制哈希、外部观察脚本与 post-run 检查保存在 `native/`；二进制本体保留在执行器外部证据目录，不入仓库。

- 真实 default-export 激活、Unicode getBBox、固定资源 guard、网络/文件请求拒绝及全局别名重绑定检查通过。
- 同步死循环：自 dispatch 起 2.000161617 秒观察截止，2.000396263 秒开始 SIGKILL，2.018833747 秒 guardian 达到 ECHILD，2.025976721 秒 App 确认清理，2.026041550 秒发出可信控制事件。调度延迟实际计入，不宣称零延迟。
- 独立外部观察器确认真实 WebKit CPU ticks 增加 10 后，只对模拟 App 发送 SIGKILL。guardian 在 0.028723361 秒后以 0 退出；所有已观察 PID/birth 消失，精确私有目录已删除，均发生在 namespace/观察器退出之前。此探针不证明 guardian 自身被 SIGKILL 后仍能清理，也不替代 Rust App watchdog 探针。
- 直接 Rust 测试 14 通过、2 个特殊入口忽略；真实 WebKit 入口随后在 native02 显式执行。独立 guardian 单测验证未预先采样的 setsid 后代清理，不将其说成 WebKit 实际产生了任意 OS 子进程。

native01 首次通过的原始日志/哈希保留在外部目录，但未保存完整旧源码/二进制快照；native02 的冻结与重新执行补足新实现的可追踪闭环，不能倒填旧证据。构建来源与具体缺口见 `native/README.md.txt`。

提交前格式门禁及重验见 `native03/`：Rust 首次格式检查通过；两份 bootstrap JS 首次 Prettier 失败，保留原日志，仅格式化这两文件后检查通过，Node bootstrap 4/4 通过。重新构建并冻结 build03 后，native03 首次通过；截止观察 2.000178438 秒、终止开始 2.000545009 秒、guardian 清理 2.016063793 秒、App 发出可信超时 2.020903628 秒。13 份源码及三份二进制运行后哈希匹配。Rust 源码未变，父进程 SIGKILL 与 14 项 Rust 测试仍准确引用冻结 build02，没有冒称重新执行。

## 通用独立构建门禁

`build-gates/red-run/` 保存原脚本下 9 项测试中 4 失败/5 通过的修前记录；`implementation-run/` 保存修正后两份 Node 测试首轮 15/15 通过，以及六份归属文件的格式记录。实现明确区分新的 DOM frozen closure 与历史 Worker legacy-non-frozen 路径；校验固定 SDK tarball、锁/闭包哈希、实际输入和许可证，并检查外部构建前后全部复制源码未变化。真实新 diagrams 冻结依赖安装/独立构建尚未执行。

## 产品集成修前回归

`integration-red/` 保存现有公开入口上的真实修前结果和两份执行过的测试源码：core 8 失败，view 16 失败、5 守护通过；没有缺导入或启动错误。失败原因分别为旧 AST 白名单拒绝新节点，以及两种 view 尚未进入解码。未知节点回退、source literal 和同步工厂守护通过。共享预算等后续负例必须在新节点的正例可用后重新运行，不能拿尚未到达的断言当作已通过。

产品 core/view/SDK 的实现正在接入，完整 source/live、普通/窗口化、主题/缩放、保存/历史/恢复及 Linux 生产矩阵均未验收；Windows/macOS 不作通过声明。
