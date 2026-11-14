# Diagrams 插件实现与验证

基线 `2184526ddfaeef6ae1e80008f0ee90e41be9fdec`。本代理产品改动仅 `plugins/diagrams/`；未提交、推送、Windows 构建、上传或发布。

实现独立 `milkup.diagrams` Worker 插件，公开 SDK 0.3.3，只有 `document:read`。完整可信 `mermaid` 围栏注册 `diagrams.mermaid`：flowchart/graph TD/TB/LR 的矩形/圆角/菱形、有向带标签边、循环/自环/孤立节点；sequenceDiagram participant/actor、别名、实线/虚线/self 消息；pie 标题和非负十进制数据。准确语法边界在插件 README，不宣称完整 Mermaid。

未知语句、配置、样式、点击动作、HTML 或预算失败整图回退完整源码及固定可访问错误；不输出 raw SVG、HTML、CSS 或 URL。输出仅 SDK typed vector/主题 token。same screen/export 语义，P5 实际输出链路尚未完成。

## 最终检查

- 仓库外只安装公开 SDK tgz，`tsc --noEmit`、build、55 focused tests 全通过：`external-final.log`、`external/verification.json`。
- 对真正外部 bundle 使用当前宿主 core validator 校验相邻流程图、循环流程图、时序图、饼图、整图错误回退，5 项通过：`host-contract-check.log`。该检查使用宿主代码的部分只属于集成证据，插件本身不导入内部包。
- 源码逐文件与 external copy 比较一致：`provenance.json`。
- SDK SHA256 `b9a163f32556a77c4ae0f5c5a8cbd8a3eaf1e102e9d3e83f9e76e539a3d89e9f`。
- 最终 `external/dist/milkup.diagrams-1.0.0.milkup-plugin`：30233 bytes，SHA256 `d92d19db21a9c7e63949201db6b065a8aab4c6077fb928a94e6c3275474f89a9`。

## 先失败后修复记录

每项保留对应 `before-*.log`；最终完整外部测试包含所有新增断言。

| 记录              | 实际问题与修复                                                                                                                               |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| label-bounds      | TD 长标签超过画布；LR 长标签负 baseline。保守 grapheme 宽度、调整标签位置并扩展画布。                                                        |
| plain-label       | 时序图普通括号被错误当作形状分隔符。仅流程图跟踪形状边界，普通消息/饼图标题保留标点。                                                        |
| branch-route      | 短节点的横向连线穿过同层较高邻接节点。以层底而非本节点底分配通道。                                                                           |
| point-budget      | 合并输出漏算 polygon/polyline 的点。按宿主规则把点计入 4096 总节点。                                                                         |
| label-route       | 边线与标签字框相交。增加文本留白及下一层入边预留区，外侧通道置于所有标签外。                                                                 |
| direct-edges      | root 的真实浏览器截图确认相邻 LR 节点也绕 U。新增 TD/LR 两点直线断言；相邻无阻挡同轴直连，错位只走层间短折线，回边/跳层/重复边使用外侧通道。 |
| numeric-underflow | 正小数下溢变 0，导致数据被静默改写。明确拒绝并整图回退。                                                                                     |

初始 `before.log` 与 `first-after.log` 是 Vitest config 路径错误的工具启动失败，不作为产品回归证据。真正产品回归是上述明确断言失败日志。

## 验证边界

本代理没有新开浏览器/原生服务器；真实宿主矩阵由 root/view owner 负责，最新直线布局需要使用最终 d92d19 包复验，不能沿用旧 dcfce 包截图作为最终结果。纯函数/类型/宿主 validator 检查不能替代视觉、系统 IME、读屏或 Windows 验收。

32 Ki UTF-16、100 节点/200 边、256 UTF-16 标签均为上限，复杂长图可能更早达到 8192 几何、8192 摘要或 256 KiB/4096 输出节点预算；这会明确回退而不截断语义。HTML/PDF/打印尚需 P5。
