export interface Tab {
  id: string;
  name: string;
  filePath: string | null;
  content: string;
  originalContent: string;
  isModified: boolean;
  scrollRatio?: number;
  readOnly: boolean;
  milkdownCursorOffset?: number | null;
  codeMirrorCursorOffset?: number | null;
  /** 标记 tab 刚加载，编辑器首次输出时捕获为 originalContent */
  isNewlyLoaded?: boolean;
  /** 合并预览中的临时 Tab */
  isMergePreview?: boolean;
  fileTraits?: FileTraitsDTO;
}
