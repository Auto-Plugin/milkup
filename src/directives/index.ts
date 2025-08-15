// 导入所有指令
import { fileDragIn, fileDragInName } from './drag/file-drag-in'

export const directives = {
  [fileDragInName]: fileDragIn,
} as const
