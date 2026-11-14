# macOS/Linux 手动验收操作手册 - 2026-07-06

这份文档给实际执行验收的人使用，用来完成剩余 macOS 和 Linux 手动 checklist 项。它本身不会关闭任何 checklist；执行完成后，请填写脚本生成的中文报告草稿，验证通过后再更新 `coding-plan.md`。

## 最简单的启动方式

请在目标平台上运行，也就是 macOS 项在 macOS 上运行，Linux 项在 Linux 上运行。

macOS：

```sh
pnpm manual:cross-platform -- --platform macos
```

Linux：

```sh
pnpm manual:cross-platform -- --platform linux
```

这个入口会自动：

- 创建本次验收用的 fixture 目录。
- 生成一份带日期的中文报告草稿，并预填平台、OS、架构、fixture 路径和建议启动命令。
- macOS 草稿会包含 IME、Cmd 快捷键和 file watcher，并创建 `watcher.md`。
- Linux 草稿只包含 Linux IME，不会生成无关的快捷键或 watcher 章节。
- 打开本操作手册。
- 打开报告草稿。

如果只想生成草稿但不打开文件，可以加 `--prepare-only`：

```sh
pnpm manual:cross-platform -- --platform macos --prepare-only
pnpm manual:cross-platform -- --platform linux --prepare-only
```

## 验收范围

本手册覆盖：

- M16 macOS Chinese IME。
- M16 macOS Cmd shortcuts。
- M16 file watcher on macOS。
- M16 Linux IME。

Windows 文件对话框、Ctrl 快捷键、file watcher、external conflict 和 Chinese IME 均已有 pass 报告；本手册只处理剩余 macOS/Linux 项。

## 需要记录的环境信息

最终报告中请记录：

- 日期/时间：
- 验收人：
- OS 名称/版本：
- 架构：
- 显示缩放：
- 输入法和键盘布局：
- App build 路径：
- 启动命令：
- Fixture 目录：
- Pass/fail 备注：

## 手动准备 Fixture

如果你使用上面的 `pnpm manual:cross-platform` 入口，可以跳过本节。需要手动准备时，请在目标平台上使用新的临时目录。

macOS/Linux shell：

```sh
fixture_root="$(mktemp -d "${TMPDIR:-/tmp}/milkup-manual-XXXXXX")"
watch_file="$fixture_root/watcher.md"
printf '# Watcher\ninitial watcher content\n' > "$watch_file"
printf '%s\n' "$fixture_root"
```

把最后输出的 fixture 目录记录到最终报告里。Linux IME 验收不需要 `watcher.md`；只有手动准备 macOS file watcher 验收时才需要创建它。使用脚本入口时，这些路径会自动写入报告草稿。

## 启动 App

启动 packaged 或 debug desktop build。请记录准确命令和 build 路径。

可接受示例：

```sh
pnpm --filter @milkup/desktop tauri dev
```

或者使用平台对应的 packaged app/binary 路径。

本次验收必须使用真实 desktop shell。不要用 browser fallback mode 作为 manual matrix 证据。

## macOS 中文 IME

使用中文输入法，例如 Pinyin - Simplified。请从 macOS Keyboard/Input Sources 中记录准确 input source 名称。

Source mode 步骤：

1. 切换到 source mode。
2. 输入中文、标点和中英混排，例如 `中文输入，test。`。
3. 确认 composition text 不会提前提交。
4. 确认最终提交文本只出现一次。
5. 执行一次 undo，记录该 composition commit 是否作为一个逻辑编辑被撤销。

Live mode 步骤：

1. 切换到 live mode。
2. 在普通文本中重复 composition。
3. 在列表项中重复 composition。
4. 在 inline Markdown marker 附近重复 composition，例如 `**bold**` 附近。
5. composition 后切换 mode，确认文本、selection 和 history 都保留。

报告字段：

- Input source：
- Source mode composition：
- Source mode undo 行为：
- Live mode 普通文本：
- Live mode 列表项：
- Live mode marker 附近：
- composition 后 mode switch：
- 备注/截图：

## Linux IME

请记录 desktop environment、display server、IME framework 和 input method，例如 GNOME on Wayland with ibus-libpinyin，或 KDE on X11 with fcitx5-pinyin。

Source mode 步骤：

1. 切换到 source mode。
2. 输入中文、标点和中英混排，例如 `中文输入，test。`。
3. 确认 composition text 不会提前提交。
4. 确认最终提交文本只出现一次。
5. 执行一次 undo，记录该 composition commit 是否作为一个逻辑编辑被撤销。

Live mode 步骤：

1. 切换到 live mode。
2. 在普通文本中重复 composition。
3. 在列表项中重复 composition。
4. 在 inline Markdown marker 附近重复 composition，例如 `**bold**` 附近。
5. composition 后切换 mode，确认文本、selection 和 history 都保留。

报告字段：

- Desktop environment：
- Display server：
- IME framework：
- Input method：
- Source mode composition：
- Source mode undo 行为：
- Live mode 普通文本：
- Live mode 列表项：
- Live mode marker 附近：
- composition 后 mode switch：
- 备注/截图：

## macOS Cmd 快捷键

请在编辑器聚焦时验证：

1. Cmd+A 选择全部编辑器内容。
2. Cmd+C 复制选中内容。
3. Cmd+V 通过编辑器 transaction 路径粘贴。
4. Cmd+Z 撤销粘贴或编辑。
5. Cmd+Shift+Z 在当前 shell 支持时执行 redo。
6. 文档已有路径时，Cmd+S 保存 active document。
7. Save As 打开 native dialog；当该 dialog 聚焦时，快捷键不会修改文档。
8. 切换 source/live/preview mode 后，重复代表性快捷键验证。
9. 如果当前 shell 支持打开或创建另一个文档，确认快捷键作用于 active document。

报告字段：

- Cmd+A/C/V/Z/Shift+Z 行为：
- Cmd+S 行为：
- Save As/dialog-focus 行为：
- mode switch 后行为：
- active document 定向：
- 备注/截图：

## macOS File Watcher

使用 `watcher.md` fixture。

步骤：

1. 在 app 中打开 `watcher.md`。
2. 当文档处于 clean 状态时，从外部修改文件：

   ```sh
   printf '\nexternal clean edit\n' >> "<watcher.md path>"
   ```

3. 确认 app 检测到变更，并提供或执行 clean reload 路径。
4. 如果 app 提供 reload，先执行 reload，然后在 app 中输入本地未保存编辑。
5. 再次从外部修改文件：

   ```sh
   printf '\nexternal dirty edit\n' >> "<watcher.md path>"
   ```

6. 确认 app 进入 conflict state，并且普通保存被阻止。
7. 按当前产品流程解决冲突。
8. 在 app 中保存，确认 own-save watcher echo 不会造成假的 external-change state。
9. 从外部删除文件：

   ```sh
   rm "<watcher.md path>"
   ```

10. 确认 app 显示 deleted-file state。

报告字段：

- clean external modification 是否被检测/重新加载：
- dirty external modification 是否进入 conflict：
- conflict 期间普通保存是否被阻止：
- own-save watcher echo 是否被忽略：
- external delete 是否被检测：
- 备注/截图：

## 最终报告和 Checklist 更新

执行完成后，确认脚本生成的带日期报告已经填入真实观察结果。macOS 报告可同时覆盖 macOS IME、Cmd shortcuts 和 file watcher；Linux 报告只覆盖 Linux IME。

示例文件名：

```text
docs/manual-verification-macos-2026-07-06.md
docs/manual-verification-linux-2026-07-06.md
```

更新 checklist 前，先运行报告验证器：

```sh
pnpm manual:validate docs/manual-verification-macos-2026-07-06.md
pnpm manual:validate docs/manual-verification-linux-2026-07-06.md
```

如果报告还只是草稿，需要确认结构是否完整，可以运行：

```sh
pnpm manual:validate docs/manual-verification-macos-2026-07-06.md --allow-pending
pnpm manual:validate docs/manual-verification-linux-2026-07-06.md --allow-pending
```

只有当报告中包含对应平台和 requirement 的具体 pass 证据时，才能勾选 `coding-plan.md` 中对应项目。其他平台行必须保持 pending，直到对应平台报告存在。

验证通过后，可以先 dry-run 计划更新：

```sh
pnpm manual:apply docs/manual-verification-macos-2026-07-06.md
pnpm manual:apply docs/manual-verification-linux-2026-07-06.md
```

确认 dry-run 输出只包含本报告确实证明的项目后，再写入 `coding-plan.md`：

```sh
pnpm manual:apply docs/manual-verification-macos-2026-07-06.md --write
pnpm manual:apply docs/manual-verification-linux-2026-07-06.md --write
```
