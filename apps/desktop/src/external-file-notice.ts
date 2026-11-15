import type { DocumentSession, FileWatchEvent } from '@milkup/tauri-bridge'

/** Own-save echoes must not replace a successful-save notice with an external warning. */
export function externalFileNotice(
  state: DocumentSession['externalChangeState'],
  kind: FileWatchEvent['kind'],
): string | undefined {
  if (state === 'none') return undefined
  if (state === 'conflict') {
    return kind === 'deleted'
      ? '原文件已在编辑器外删除。未保存编辑已保留；请另存为新文件。'
      : '文件已在编辑器外发生变化。未保存编辑已保留；请先另存为新文件，再打开外部版本。'
  }
  return state === 'deleted-clean'
    ? '原文件已在编辑器外删除。当前内容仍保留，可另存为新文件。'
    : '文件已在编辑器外修改。当前显示的仍是旧版本；可从文件菜单重新载入外部更改。'
}
