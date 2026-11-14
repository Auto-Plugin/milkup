# Checkpoint08：已保存的诊断增量，尚未验收

本增量保存 checkpoint07 远端核验元数据、已冻结 sampler02/03、singlecold02/03 首次工具失败，以及完成的能力检查与静态审计。sampler03 最初仅收 selfproc 单文件，随后在完整冻结和运行完成信号后才追加其余清单；新产品修复准备目录与源码变化不读取。归档过程只作复制与哈希核验；本目录已由 Root 保存入仓，原始对象和索引未改。归档本身不运行产品测试、构建或原生诊断，不改旧 checkpoint05/06/07。

## 历史批次：sampler02 与 singlecold02

sampler02 preparation SHA `6c6b8fec62b9e86effd68dfdaf8f0bd8c57c2ef7e1cadbf3a0c09079c6589257`，Root static/synthetic review SHA `c25cc85857b7123e9b3c932b84fbbc2c8f707c0514d8e32227ee3277bf5c9791`。24 个有限 mocked binding case 通过且读取序列相同；只覆盖已执行分支，不等于全部 malformed/window/terminal 用例通过，也未证明 summary 大小的普遍上界。静态 preparation 的“未执行”是其历史阶段事实，后续 synthetic 与 singlecold 原件分别保留。

singlecold02 summary SHA `cfe674d2e5a7200cd4651e34b41cfdcc052d63a58f87c2067c31ee751f6ff552`，只按 45 项显式 manifest 加 summary 保存。独立诊断 binary `8041da503dac6cc0ff5d45d4c11982ca4b6a898930f3e4ecc3442d8cb1e4d140` 的 **cold UI gate PASS，但 observer 首次失败，CPU samples=0**。唯一获准运行已执行一次，无重试；sampler exit2、harness exit1，`guardian-bind-not-unique-or-missing`。

此次绑定中 owner 的精确 birth 前后匹配；观察到 36 个 task，每个 children 读取均 ENOENT（32 条明细保留，4 条省略计数），raw children=0、matching=0、outcome=`zero-discovered`。这仅解释本次工具读取证据，不能倒推出旧 coldbatch01 的缺失分支，不能据此断言应用没有子进程。无 guardian 被选中，无 DOM CPU 样本，cgroup before/after/delta 均为空；sampler 自身 user/system CPU 另列，不是渲染 CPU。

原生保留 73 条 trace、6 dispatch、5 完整 ok:true result、0 deadline；最慢完整 block render_1 wall time=1138.027775ms。render_6 ER 在正常 App 关闭前没有保留完成记录，是被关闭截断的观测，不推定成功或超时。观测开销未扣除；wall time 不等于 helper CPU。376 项输入/历史记录未变，正文字节未变。正式 UI04 deadline 与完整 UI 验收仍未关闭。

清理记录中 App/driver/helper 不在，4626/4627 空闲；trace guardian PID368230 当时为 PID1 下 Z。失败 sampler 没有保存该 guardian 独立 birth，不能事后重建精确身份或声称全身份消失。原始两张 PNG 原样保留；Root 的原图审阅以其原件为依据，归档代理未新增视觉验收。

## 最新批次：sampler03 与 singlecold03 首次扫描上限失败

sampler03 最终 SHA `f109f8ee86061e9f37b1e561a7964e3b4c830bb58957832acfc480d06d2089f0`，完整冻结目录含第一版 17 个有限 synthetic case 与修订后 19 个 case、两版源码/差异、独立和 Root review、自身 cgroup 能力检查。两个 synthetic 批次分开保留，不合并成 36 个独立 case，不替代实际成功绑定。原 preparation/review 的“待原生运行”是历史资格，不覆写；自有 cgroup 可读性不保证后续目标 cgroup 可读或可作 DOM 专属归因。

singlecold03 summary SHA `f116962dbe06bcf23dcd157aad651dec1e938e9234816d4905fbb39e6559e9ee`，52 项显式清单与 summary 原样保存。**cold UI PASS，但首次 proc 扫描触及原 50ms 上限，CPU samples=0**；一例获准、一例执行、无重试，sampler exit2 / harness exit1。实际扫描 50.189210ms，1251 entries / 1200 numeric PID、1200 stat 已解析，失败 `proc-scan-wall-limit`；部分表被丢弃，没有接受部分结果。owner-before birth 通过，但未到 owner-after 或精确 guardian argv/env 接受，因此无有效 guardian 绑定。

0 DOM CPU 样本、cgroup before/after/delta 为空；sampler 自身 user/system CPU 与扫描 wall 开销单列，不归因或扣除对并行渲染的影响。74 条 trace、6 dispatch、5 完整 ok:true、0 native deadline；最慢完整 class render_3=663.936425ms wall time。render_6 ER 在正常关闭前未保留完成，被关闭截断，不推定超时或成功。452 项输入/历史未变。正式 UI04 和历史 deadline 仍未关闭。

Root 完成审阅 SHA `7518bf38774c33868bee37a95dd817979e7d2e3cc0f5659d6ed621b08b782829` 独立核了 52 文件、6 请求源码映射、74 trace，并实际查看原 X11 图：完整 block 和 class 上部可见，class 底部超出 viewport，不是完整 class/UI 验收。Driver/App/helper 不在、端口空闲；trace guardian PID369370 当时为 PID1 下 Z，无失败 sampler 独立保留的先前 birth，不宣称精确身份全消失。

## 两份只读审计：不是已修复或耗时因果结论

`native-render-async-boundaries-01.json` SHA `bdc322c2e710439bf9da9ec4bec7d41281e52a1aa52cb8fa112ec36f78a29281` 记录 class 默认 ELK、block 自有布局、fastdom microtask 以及两处 ELK timer 源码位置；这些静态事实没有证明本次或历史耗时原因。其 helper 引用是冻结 A/C candidate，不是当前 cold stage binary8041；保留原报告资格。Root 的 14 源码核验与归档代理复用冻结对象是不同证据，不混称重新读取 whole deps。

`native-owned-sampler-independent-review.json` SHA `918a9f816942f9dcb2c568da7a62fab301bbc455955dadaa623dc956b1be5e79` 静态确认生产 App 侧周期 owned 扫描没有找到必要消费者，认为移除是待生命周期回归验证的窄候选。这里没有实现修复，没有性能测量，不证明扫描造成历史 deadline。未把正在准备的修复源码、测试变化或目录纳入本检查点。

两报告共 18 项历史源码引用：7 项对应已有 checkpoint06/07 冻结对象，按 SHA 跨引用；11 项仅保留报告路径/长度（如有）/SHA 声明，没有复制 whole deps 或将当前源码填入旧 SHA。`sourceReferences` 明确区分可访问冻结正文与 reference-only。

## 先前单文件 selfproc 能力检查

`native-dom-cpu-sampler-03/proc-capability-first.json` SHA `4d06ebea04a8039f57b96853c659e1e228f25117a283800adb6689bf35d86a6a` 是初批唯一获准读取的03文件；后续03完整冻结后才追加其余原件。自有 task 目录存在但 children 条目不存在（ENOENT）。一次有界只读 stat 测量观察 1827 个 entries / 1776 个 numeric PID、解析 1776 stat、0 vanished、failure=null，耗时 33.655747ms。未读取其他进程 cmdline/env，没有逐进程 stat 内容、信号、UI 或 sampler-main 执行。这是单次能力/成本观察，不是普遍上界或 CPU 归因；Python 只在操作边界检查 wall limit，不能抢占内核单次读取。不能用它补造历史 guardian 绑定原因。

## 增量与完整性

当前 139 个 source aliases，99 个本地去重对象 / 1,447,911 字节，19 个 checkpoint06/07 跨引用 / 8,118,170 字节。两次 singlecold 共 4 张原 PNG 保留。相同内容按 SHA 复用；不复制二进制、profile/cache 或 SQLite。固定 base 为 checkpoint06 提交 `2c3ff12bf3caa50520c8b6d49601e2f33a5f7da0` 与 checkpoint07 提交 `e684539ff34e719d5b2ba40cf8147a0b8b24dd99`；归档代理没有重新查询远端。

累计 133 个 SHA/长度声明匹配（含重复核验），静态审计中仅声明的源码引用另列，不计作新读取核验，新增文本敏感模式候选 0；这不是任意秘密不存在的保证，也没有 PNG OCR。raw 文本/图片保持原字节。检查索引、对象 SHA/长度、全部别名、无孤立对象和无符号链接：

```sh
python3 verify-index.py \
  --checkpoint06 /workspace/milkup/docs/evidence/v2-product-phase4-mermaid-engine/checkpoint06 \
  --checkpoint07 /workspace/milkup/docs/evidence/v2-product-phase4-mermaid-engine/checkpoint07
```

校验脚本不是产品测试；同级入仓后可省略 base 参数。外部 checkpoint08-draft 执行报告属于未自动随本目录交付的支持材料。
