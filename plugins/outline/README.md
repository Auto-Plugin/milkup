# Milkup Outline

Milkup Outline is a read-only Worker-hosted plugin that adds a document-scoped outline panel.

## Features

- Sidebar outline panel in the `sidebar-panel` slot.
- Incremental full-document heading scan that also works for virtualized and very large files.
- The sidebar updates as result batches arrive and automatically rescans after document changes.
- Shows at most 500 headings around the current editor viewport.
- Keeps selection under manual control; editor scrolling does not change or reload the outline.
- Loads adjacent outline windows only when the outline itself reaches the top or bottom.
- Retains two adjacent scan blocks so reversing direction does not immediately trigger another load.
- Click a heading to jump to it without modifying the document.
- Requires only the `document:read` permission.

## Install locally

1. Build the plugin as shown below.
2. Open Milkup.
3. Go to `菜单 > 插件`.
4. Choose `安装本地插件`.
5. Select `plugins/outline/plugin.json`.
6. Enable `Milkup Outline`.

## Development

```powershell
pnpm --dir plugins/outline install
pnpm --dir plugins/outline build
```

The plugin uses `context.host.document.scan()` with the `markdownHeadings` query and requests controlled UI updates through `context.host.ui.requestUpdate()` after each result batch. Viewport state comes from the UI renderer context, and clicks use `context.host.ui.revealLine()`. It never materializes the full document inside the Worker.
