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
    writeTempImage: (file: Uint8Array<ArrayBuffer>, tempPath: string) => Promise<string>
    // 主题编辑器相关
    openThemeEditor: (theme?: any) => void
    themeEditorWindowControl: (action: 'minimize' | 'maximize' | 'close') => void
    saveCustomTheme: (theme: any) => void
    platform: NodeJS.Platform
  }
}
