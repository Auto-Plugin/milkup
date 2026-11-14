# Checkpoint17：UI10 首 FAIL，部分覆盖与像素审阅

本目录保存已冻结的正式 UI10 首次失败及完成审阅。**不是完整 UI/64组合通过。** 原279条 records 最后一条 FAIL 原样保留，不改成 PASS、不由归档补造重试。checkpoint06–16 原件和索引不变，checkpoint16 commit `79e7ee89329163d8bf3c275c57520297cf2b8670` 的远端/GitHub身份记录随附。

## 正式运行与未完成范围

精确按 `product-ui-runs/control/mermaid-ui-10/completed-manifest.json` 收录552个绝对路径文件及清单自身；Root逐项实核44,943,836字节，并核对494张PNG的记录引用。ordinary11914字节、windowed7851914字节的最终文件经Root从catalog重建全字节相同。生产07 binary为 `df7b509fefa335df89b004a9992d16cb3a712f062281f418518d3e59d96e5d72`，官方archive为 `9889f1796f9080ff230a1c51147522e83e065bc191a258035208f69403a327df`；artifact只由冻结原件记录身份，不复制body。

完成记录范围：ordinary coverage31、windowed coverage31、selection2、history12、matrix完成30/64组合、150个matrix samples、10个edges。最后完成ordinary/live/dark/150/narrow；ordinary/live/dark/200/wide第一class等待失败，尚未产出该组合首个matrix sample record。余34组合包括这个wide、同档narrow和全部32个windowed matrix，不能计为通过；windowed的31个初始coverage与6条history不等同于windowed matrix通过。

正式harness于2026-10-16 22:56:23 UTC exit1，错误为 `Timeout: actual image decode classDiagram-000-first-official-example`。实际native `render_2754` 在dispatch后2005.473164ms触发deadline，随后原安全清理链记录kill、cleanup及control，插件标记failed/disabled。**未采request payload或CPU，不能把render2754绑定class，也不能凭等待错误认定decoder故障。** Root实际查看FAIL图：class marker选中，原Markdown fence仍显示，没有目标预览，不是空文档或源码丢失。保留errors/CSP为空不意味着native执行未失败。

这是harness自己失败并关闭应用，没有外部abort、手动reenable、重试或扩大预算。cleanup记录五个自有/trace身份absent、4626/4627不可连接，Xvfb126保留；这不是完整后代清单。全部结果是原始捕获事实，本归档代理没有重跑端口、原生程序或测试。

## 完成像素审阅的范围

- Ordinary coverage：Root实际看4张指定WebView，独立审阅实际看其余27张X11；合计31个选定case，不等于每case两种截图都看过，更不是逐标签源码到像素审计。
- Ordinary matrix：独立审阅37张WebView，其中30个已完成组合的图、4张light200narrow class/Journey角图、3张context；两个dark200组合及其额外角图未完成、不宣称已看。
- Other corners：独立完成6张light角图的审阅，保留视口另一端可裁切、Sankey密集标签等限制；不扩大为每个中间滚动位置正确。
- Windowed：按另一个 `final-manifest.json` 的 `files[].file` 相对schema明确收录6份reviewer metadata及清单自身。实际只看8张初始coverage和2张history共10图；windowed matrix产出/审阅均为0。31条coverage和6条history的运行记录与实际目视范围分别记录。

Root和独立审阅的原文件含具体路径、SHA和观察，本目录不改其历史状态。Sankey密集标签、block官方literal `&nbsp;` 与Journey白区/zoom2文本差异有各自既有边界，不能因为这次某截图“未发现新缺陷”便视为全部可读性、像素等价、Windows或完整产品通过。缺失矩阵不作推断。

## 原件、去重与校验

494张PNG全部按清单保存来源alias及原hash/大小，不裁剪或重新编码；内容相同的PNG/文本跨checkpoint06–16或本批复用。`index.json` 精确列本地对象、跨检查点对象、来源别名、捕获时核验和批次；文本原样以 `raw/*.txt` 保存。profile/SQLite、binary/deb、依赖和生成bundle主体均未收集，不递归扫描其它研究或活动方案。已有大fixture按相同内容复用，不能把引用算作重复复制的body。

`verify-index.py` 在仓库相邻checkpoint06–16齐备时可直接运行；外部staging显式传入 `--checkpoint06` 至 `--checkpoint16`。它验证对象SHA/大小、固定base index、alias、无孤儿/符号链接，不替代产品测试。外部 `checkpoint17-draft` 的脚本、逐批metadata快照和handoff是未随本目录归档的支持材料。新诊断方案未读取、未收录，后续验收需另行留证。
