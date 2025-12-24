/**
 * TODO: 当前文件仅用于迁移旧代码，未来会被删除
 * 未来期望将同类型的 API 迁移到各自文件夹下
 */

function openFile() {
  return window.electronAPI.openFile()
}

function saveFile(filePath: string | null, content: string) {
  return window.electronAPI.saveFile(filePath, content)
}

function saveFileAs(content: string) {
  return window.electronAPI.saveFileAs(content)
}

function on(channel: string, listener: (...args: any[]) => void) {
  return window.electronAPI.on(channel, listener)
}

function removeListener(channel: string, listener: (...args: any[]) => void) {
  return window.electronAPI.removeListener(channel, listener)
}

function setTitle(filePath: string | null) {
  return window.electronAPI.setTitle(filePath)
}

function changeSaveStatus(isSaved: boolean) {
  return window.electronAPI.changeSaveStatus(isSaved)
}

function windowControl(action: 'minimize' | 'maximize' | 'close') {
  return window.electronAPI.windowControl(action)
}

function closeDiscard() {
  return window.electronAPI.closeDiscard()
}

function onOpenFileAtLaunch(cb: (payload: { filePath: string, content: string }) => void) {
  return window.electronAPI.onOpenFileAtLaunch(cb)
}

function openExternal(url: string) {
  return window.electronAPI.openExternal(url)
}

function getFilePathInClipboard() {
  return window.electronAPI.getFilePathInClipboard()
}

function writeTempImage(file: File, tempPath: string) {
  return window.electronAPI.writeTempImage(file as any, tempPath)
}

function resolveImagePath(markdownFilePath: string, imagePath: string) {
  return window.electronAPI.resolveImagePath(markdownFilePath, imagePath)
}

function readFileByPath(filePath: string) {
  return window.electronAPI.readFileByPath(filePath)
}

function showOverwriteConfirm(fileName: string) {
  return window.electronAPI.showOverwriteConfirm(fileName)
}

function showCloseConfirm(fileName: string) {
  return window.electronAPI.showCloseConfirm(fileName)
}

function showOpenDialog(options: any) {
  return window.electronAPI.showOpenDialog(options)
}

function getPathForFile(file: File) {
  return window.electronAPI.getPathForFile(file as any)
}

function getSystemFonts() {
  return window.electronAPI.getSystemFonts()
}

function getDirectoryFiles(dirPath: string) {
  return window.electronAPI.getDirectoryFiles(dirPath)
}

function openThemeEditor(theme?: any) {
  return window.electronAPI.openThemeEditor(theme)
}

function themeEditorWindowControl(action: 'minimize' | 'maximize' | 'close') {
  return window.electronAPI.themeEditorWindowControl(action)
}

function saveCustomTheme(theme: any) {
  return window.electronAPI.saveCustomTheme(theme)
}

function getIsReadOnly(filePath: string) {
  return window.electronAPI.getIsReadOnly(filePath)
}

function watchFiles(filePaths: string[]) {
  return window.electronAPI.watchFiles(filePaths)
}

export {
  changeSaveStatus,
  closeDiscard,
  getDirectoryFiles,
  getFilePathInClipboard,
  getIsReadOnly,
  getPathForFile,
  getSystemFonts,
  on,
  onOpenFileAtLaunch,
  openExternal,
  openFile,
  openThemeEditor,
  readFileByPath,
  removeListener,
  resolveImagePath,
  saveCustomTheme,
  saveFile,
  saveFileAs,
  setTitle,
  showCloseConfirm,
  showOpenDialog,
  showOverwriteConfirm,
  themeEditorWindowControl,
  watchFiles,
  windowControl,
  writeTempImage,
}
