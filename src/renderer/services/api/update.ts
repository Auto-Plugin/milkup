import autotoast from 'autotoast.js'
import { version } from '../../../../package.json'
// 通过 github release 检测更新
const api = 'https://api.github.com/repos/auto-plugin/milkup/releases/latest'
// 使用 fetch
export async function checkUpdate(): Promise<{ version: string, url: string, notes: string } | null> {
  try {
    const response = await fetch(api)
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }
    const data = await response.json()
    // 本地 version 是不带前缀的纯数字，如 0.1.0 而 github release 可能带 v 前缀，如 v0.1.0 或 Beta-v0.1.0,所以去掉所有非数字和点的字符
    const latestVersion = data.tag_name.replace(/^\D*/, '')
    const currentVersion = version
    if (isNewerVersion(latestVersion, currentVersion)) {
      const releaseNotes = data.body || ''
      const downloadUrl = data.html_url || ''
      return { version: data.tag_name, url: downloadUrl, notes: releaseNotes }
    }
    return null
  } catch (error) {
    console.error('Error fetching update info:', error)
    autotoast.show('检查更新失败', 'error')
    return null
  }
}

function isNewerVersion(latest: string, current: string): boolean {
  // 本地 version 是不带前缀的纯数字，如 0.1.0 而 github release 可能带 v 前缀，如 v0.1.0 或 Beta-v0.1.0
  const latestParts = latest.split('.').map(Number)
  const currentParts = current.split('.').map(Number)
  for (let i = 0; i < Math.max(latestParts.length, currentParts.length); i++) {
    const latestPart = latestParts[i] || 0
    const currentPart = currentParts[i] || 0
    if (latestPart > currentPart)
      return true
    if (latestPart < currentPart)
      return false
  }
  return false
}
