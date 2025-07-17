interface Window {
  electronAPI: {
    openFile: () => Promise<{ filePath: string, content: string } | null>
    saveFile: (filePath: string | null, content: string) => Promise<string | null>
    saveFileAs: (content: string) => Promise<{ filePath: string } | null>
    setTitle: (filePath: string | null) => void
    on: (channel: string, listener: (...args: any[]) => void) => void
    removeListener: (channel: string, listener: (...args: any[]) => void) => void
    windowControl: (action: 'minimize' | 'maximize' | 'close') => void
    onOpenFileAtLaunch: (cb: (payload: { filePath: string, content: string }) => void) => void
    openExternal: (url: string) => Promise<void>
  }
  __MAC__: boolean
  __WIN__: boolean
  __LINUX__: boolean
  __PLATFORM__: NodeJS.Platform
}
