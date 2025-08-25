interface Window {
  electronAPI: {
    openFile: () => Promise<{ filePath: string, content: string } | null>
    saveFile: (filePath: string | null, content: string) => Promise<string | null>
    saveFileAs: (content: string) => Promise<{ filePath: string } | null>
    setTitle: (filePath: string | null) => void
    changeSaveStatus: (isSaved: boolean) => void
    on: (channel: string, listener: (...args: any[]) => void) => void
    removeListener: (channel: string, listener: (...args: any[]) => void) => void
    windowControl: (action: 'minimize' | 'maximize' | 'close') => void
    closeDiscard: () => void
    onOpenFileAtLaunch: (cb: (payload: { filePath: string, content: string }) => void) => void
    openExternal: (url: string) => Promise<void>
    getFilePathInClipboard: () => Promise<string | null>
    writeTempImage: (file: ArrayBufferLike, tempPath: string) => Promise<string>
    // 图片路径解析
    resolveImagePath: (markdownFilePath: string, imagePath: string) => Promise<string>
    // 通过路径读取文件（用于拖拽）
    readFileByPath: (filePath: string) => Promise<{ filePath: string, content: string } | null>
    // 显示文件覆盖确认对话框
    showOverwriteConfirm: (fileName: string) => Promise<number>
    // 显示文件选择对话框
    showOpenDialog: (options: any) => Promise<{ canceled: boolean, filePaths: string[] } | undefined>
    // 获取拖拽文件的真实路径
    getPathForFile: (file: File) => string | undefined
    // 字体相关
    getSystemFonts: () => Promise<string[]>
    // 主题编辑器相关
    openThemeEditor: (theme?: any) => void
    themeEditorWindowControl: (action: 'minimize' | 'maximize' | 'close') => void
    saveCustomTheme: (theme: any) => void
    platform: NodeJS.Platform
  }
}
