import * as fs from 'node:fs'

export function isFileReadOnly(filePath: string): boolean {
  try {
    fs.accessSync(filePath, fs.constants.W_OK)
    return false
  } catch {
    return true
  }
}
