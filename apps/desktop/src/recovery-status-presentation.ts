import type { RecoveryStatus } from './recovery'

/** A recovery backup protects a draft; it never means the original file was saved. */
export function recoveryStatusText(status: RecoveryStatus): string {
  switch (status.phase) {
    case 'idle':
    case 'ready':
      return ''
    case 'pending':
      return status.version === undefined ? '尚未生成恢复备份' : '新编辑尚未备份'
    case 'writing':
      return '正在备份未保存编辑…'
    case 'error':
      return '恢复备份失败'
  }
}
