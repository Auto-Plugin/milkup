import { parsePluginPackageArchive, type PluginRegistryRecord } from '@milkup/plugin'
import { readBundledPlugin } from './bundled-plugin-catalog'

export const pluginIconMaxBytes = 256 * 1024

/** PNG only: never render URLs, SVG, HTML, or a package's arbitrary data URI. */
export function pluginIconDataUrl(bytes: Uint8Array): string | undefined {
  if (
    bytes.length < 33 ||
    bytes.length > pluginIconMaxBytes ||
    ![137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value) ||
    ![0, 0, 0, 13, 73, 72, 68, 82].every((value, index) => bytes[index + 8] === value)
  )
    return undefined
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const width = data.getUint32(16)
  const height = data.getUint32(20)
  if (width === 0 || height === 0 || width > 1024 || height > 1024) return undefined
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return `data:image/png;base64,${btoa(binary)}`
}

export async function loadDesktopPluginIcon(
  record: PluginRegistryRecord,
): Promise<string | undefined> {
  const icon = record.manifest.icon
  if (
    !icon ||
    !/^(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.png$/i.test(icon) ||
    !record.manifest.resources?.includes(icon)
  )
    return undefined
  const bundled = readBundledPlugin(record.manifestPath)
  if (bundled) {
    const archive = parsePluginPackageArchive(JSON.parse(bundled) as unknown)
    if (archive.manifest.id !== record.manifest.id || archive.manifest.icon !== icon)
      return undefined
    const file = archive.files.find((file) => file.path === icon)
    if (
      !file ||
      file.encoding !== 'base64' ||
      file.content.length > Math.ceil(pluginIconMaxBytes / 3) * 4
    )
      return undefined
    return pluginIconDataUrl(
      Uint8Array.from(atob(file.content), (character) => character.charCodeAt(0)),
    )
  }
  if (!('__TAURI_INTERNALS__' in globalThis)) return undefined
  const { invoke } = await import('@tauri-apps/api/core')
  return pluginIconDataUrl(
    new Uint8Array(await invoke<number[]>('read_plugin_icon', { pluginId: record.manifest.id })),
  )
}
