export interface Tab {
  id: string
  name: string
  filePath: string | null
  content: string
  originalContent: string
  isModified: boolean
  scrollRatio?: number
  readOnly: boolean
  milkdownCursorOffset?: number | null
  codeMirrorCursorOffset?: number | null
}
