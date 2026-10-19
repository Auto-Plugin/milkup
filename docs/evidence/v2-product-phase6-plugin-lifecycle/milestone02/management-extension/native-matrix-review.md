# P6 milestone02 宿主管理界面原生矩阵独立视觉复核

日期：2026-10-19。复核对象：`../native-ui/runs/p6-m02-manager-matrix-01/`。本次只读取既有 JSON、驱动快照及 PNG，并通过 `view_image` 逐张检查下列16张代表图；未运行原生 UI、重拍截图或修改产品/主报告。

结论：**在所查代表截图和既有24单元断言范围内，简洁卡片、详情信息分离、焦点可见与横向可达性一致，未发现新的横向遮挡缺陷。** 不把此结论扩展为所有内容同屏、完整键盘 Tab 遍历、独立管理扩展 modal、事务/审批正确性或跨平台验收。

## 身份与自动记录

- `plan.json` 指向 **production04**：ELF SHA256 `892089be0177d44e178bde43bd58711abfeed134c4e03ef6043631a22765e9d8`。
- 实际独立大纲包为1.3.1，SHA256 `7eea6ffb5bba53155b3c256c6e35d95b04a93199ebbbd04636ee9c7ec5f6f712`；本矩阵详情对象为此大纲。
- `production-origin.json`：`tauri://localhost`，正式资源 `index-CtaLmMot.js` / `index-BcNetFZt.css`，developmentProbe 为 undefined。这里的 csp:null 不是“无 CSP”或“沙箱证明”的结论，本任务不审计 CSP。
- `manager-matrix.json` 共24单元：明/暗×100/125/150/200%×1280×900及760×520的16个列表单元，另8个窄窗详情单元。
- 176次卡片记录均有title/logo/description，forbidden=0、extraText为空。216次独立聚焦测量均为 focused=true、centerHit=true、fullyWithinClip=true；其中176次列表卡片、40次详情管理控件（8×5）。详情控件记录还要求非disabled。
- `observations.json`最终为 `manager-matrix-completed`，source模式、dirty=false；completion记录 automatedChecksPassed=true，并保留 visualReview:pending 的原始值。本文件是独立复核结果，不回写原始运行文件。

## 实际像素检查

下表文件名均位于上述run目录；每行的light/dark两张都已实际打开查看。

| 检查图（省略.png） | 像素观察 |
| --- | --- |
| `manager-list-{light,dark}-760-100` | 卡片整行边界留在视口内，logo/加粗标题/描述层级清楚，没有版本、审批、状态或操作混入卡片。明暗主题均可读，顶部插件页签绿色焦点环清晰。列表下方超出画面的卡片由纵向滚动承载。 |
| `manager-list-{light,dark}-760-200` | 菜单导航横向排布仍在760宽度内；安装按钮与首张卡片可见，文字放大后描述换行。当前截图在已有滚动位置，正文标题上沿及首卡下部有纵向裁切；这不能写成“所有内容同时可见”，但未见卡片向左右溢出或横向遮挡。 |
| `manager-detail-{light,dark}-760-100` | 详情包含大纲标题/版本/启用状态，以及兼容、host、权限、审批、来源/data路径，确实与普通列表分离。标题有可见绿色焦点框。长路径在列内换行，没有撑出横向边界。底部内容需滚动。这里是可信宿主详情，显示路径不等于公开管理SDK泄漏路径。 |
| `manager-detail-{light,dark}-760-200` | 标题焦点框、状态徽章、描述保持分开；返回列表按钮及详情仍在横向视口内。纵向可视空间小，详情下部不在同一截图，须结合后续聚焦截图。 |
| `manager-detail-{light,dark}-760-100-focused-last-control` | 真实画面显示禁用、撤销审批、重载、导出、移除五个控件；“移除”有明显焦点环，按钮未被横向边缘遮挡。下方插件命令区换行正常。顶部旧内容在滚动容器边缘裁切，不遮挡当前聚焦控件。 |
| `manager-detail-{light,dark}-760-200-focused-last-control` | 大尺寸控件自动分为两行，“移除”在第二行且完整可见，焦点环仍可分辨；data长路径换行。没有按钮右侧截断，说明可通过聚焦滚动到达底部控件。 |
| `manager-list-{light,dark}-1280-125` | 左侧菜单和右侧列表布局清楚；每张可见卡片只有logo/title/description。卡片右边界和描述均在内容区内；颜色层级和插件页签焦点环在两种主题下清楚。 |
| `manager-list-{light,dark}-1280-150` | 更大字号仍保持列布局，描述可读，无横向文字越界。底部下一张卡片可能跨出截图，这是正常纵向滚动范围，不是全部卡片同时显示的证明。 |

截图与JSON描述不存在所查范围内的矛盾。绿色焦点框可见不是色彩对比度量化认证；本次没有计算WCAG对比度。

## 断言和截图能证明什么

驱动的 `nativeZoom` 通过原生键盘 Ctrl+0/Ctrl+=改变实际应用缩放，并用 `appearanceZoom`及窗口几何核对。**这是Linux原生WebKit内的应用缩放，不是操作系统DPI、多显示器缩放或Windows/macOS矩阵。**

`focusedBounds`通过DOM focus使每个控件可见，随后测量祖先clip和中心点命中；因此216个true证明的是逐个聚焦后的可达性，不是216个控件同时可见。列表截图拍摄在逐项测量之前；详情末控件截图拍摄在全部详情按钮测量之后。不能据此声称完整Tab顺序、全键盘遍历、全部语义辅助功能或鼠标所有位置命中均已验。原生点击确实打开了详情，但危险“移除”等控件只测量，没有执行。

本矩阵只覆盖宿主可信管理列表及大纲详情；独立management扩展的modal、候选变化/错误详情、安装失败、授权与升级回滚由各自运行/测试证明，不能借用这组截图关闭。completion中的“First checkpoint only; no upgrade rollback or permission-delta acceptance”仍应尊重。

## production04 与后续 production05

本组像素始终归属于production04，不能改标production05。Root说明后续05仅补action注册，不改CSS；本次只读比对也确认当前 `apps/desktop/src/style.css`及另一项已冻结CSS输入与production04输入SHA相同。复核时production05 proof尚未出现，因此此处不宣称05已构建或已重跑矩阵。

若最终05确实只改action注册、冻结CSS与布局相关源码不变，这组04证据可作为布局未改的既有视觉证据，并同时单列05动作行为验收。仍须由Root核对最终输入/产物关系，不把“CSS未改”自动等同于全部行为或整个P6完成。
