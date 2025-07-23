import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  openFile: () => ipcRenderer.invoke('dialog:openFile'),
  saveFile: (filePath: string | null, content: string) => ipcRenderer.invoke('dialog:saveFile', { filePath, content }),
  saveFileAs: (content: string) => ipcRenderer.invoke('dialog:saveFileAs', content),
  on: (channel: string, listener: (...args: any[]) => void) => ipcRenderer.on(channel, (_event, ...args) => listener(...args)),
  removeListener: (channel: string, listener: (...args: any[]) => void) => ipcRenderer.removeListener(channel, (_event, ...args) => listener(...args)),
  setTitle: (filePath: string | null) => ipcRenderer.send('set-title', filePath),
  windowControl: (action: 'minimize' | 'maximize' | 'close') => ipcRenderer.send('window-control', action),
  onOpenFileAtLaunch: (cb: (payload: { filePath: string, content: string }) => void) => { ipcRenderer.once('open-file-at-launch', (_event, payload) => { cb(payload) }) },
  openExternal: (url: string) => ipcRenderer.send('shell:openExternal', url),
  getFilePathInClipboard: () => ipcRenderer.invoke('clipboard:getFilePath'),
  wirteTempImage: (file: File) => ipcRenderer.invoke('clipboard:writeTempImage', file),

  platform: process.platform
})