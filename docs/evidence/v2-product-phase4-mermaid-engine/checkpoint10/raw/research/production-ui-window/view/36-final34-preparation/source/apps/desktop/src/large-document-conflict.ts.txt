import type { DocumentSession } from '@milkup/tauri-bridge'

export type LargeExternalReloadDecision =
  | {
      readonly kind: 'reload'
    }
  | {
      readonly kind: 'confirm-discard-and-reload'
      readonly message: string
    }
  | {
      readonly kind: 'blocked'
      readonly message: string
    }

export function getLargeExternalReloadDecision(
  session: Pick<DocumentSession, 'dirty' | 'externalChangeState'>,
): LargeExternalReloadDecision {
  if (session.externalChangeState === 'modified-clean') {
    return { kind: 'reload' }
  }

  if (session.externalChangeState === 'conflict') {
    if (!session.dirty) {
      return {
        kind: 'blocked',
        message: '无法重新载入：外部状态需要先重新同步。',
      }
    }

    return {
      kind: 'confirm-discard-and-reload',
      message:
        '外部文件已变化，当前大文件也有未保存编辑。重新载入会丢弃本地大文件编辑；如需保留，请先使用“另存为”。是否继续？',
    }
  }

  if (session.externalChangeState === 'deleted-clean') {
    return {
      kind: 'blocked',
      message: '外部文件已删除，无法重新载入；如需保留当前内容，请使用“另存为”。',
    }
  }

  return {
    kind: 'blocked',
    message: '当前没有可重新载入的外部更改。',
  }
}
