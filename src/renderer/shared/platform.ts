const platform = window.electronAPI.platform

const isMac = platform === 'darwin'
const isWin = platform === 'win32'
const isLinux = platform === 'linux'

export { isLinux, isMac, isWin, platform }
