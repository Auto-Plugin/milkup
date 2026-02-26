export interface ScrollAnchor {
  blockIndex: number;
  fractionInBlock: number;
}

export interface Tab {
  id: string;
  name: string;
  filePath: string | null;
  content: string;
  originalContent: string;
  isModified: boolean;
  scrollRatio?: number;
  /** 虚拟滚动模式下直接保存的 scrollTop 像素值（比 ratio 更精确） */
  scrollTop?: number;
  readOnly: boolean;
  scrollAnchor?: ScrollAnchor;
  hasScrollState?: boolean;
  milkdownCursorOffset?: number | null;
  codeMirrorCursorOffset?: number | null;
  /** 标记 tab 刚加载，编辑器首次输出时捕获为 originalContent */
  isNewlyLoaded?: boolean;
  fileTraits?: FileTraitsDTO;
}
