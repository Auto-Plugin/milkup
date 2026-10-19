import { parsePluginManifest, type PluginManifest } from './manifest'

export const PLUGIN_PACKAGE_FORMAT = 'milkup-plugin' as const
export const PLUGIN_PACKAGE_VERSION = 1 as const

export type PluginPackageFileEncoding = 'utf8' | 'base64'

export interface PluginPackageFile {
  readonly path: string
  readonly encoding: PluginPackageFileEncoding
  readonly content: string
}

export interface PluginPackageArchive {
  readonly format: typeof PLUGIN_PACKAGE_FORMAT
  readonly version: typeof PLUGIN_PACKAGE_VERSION
  readonly manifest: PluginManifest
  readonly files: readonly PluginPackageFile[]
}

export function isPluginPackageArchive(value: unknown): boolean {
  return isRecord(value) && value.format === PLUGIN_PACKAGE_FORMAT
}

export function parsePluginPackageArchive(value: unknown): PluginPackageArchive {
  if (!isRecord(value)) {
    throw new Error('Plugin package must be an object')
  }

  if (value.format !== PLUGIN_PACKAGE_FORMAT || value.version !== PLUGIN_PACKAGE_VERSION) {
    throw new Error('Unsupported plugin package format or version')
  }

  const manifest = parsePluginManifest(value.manifest)

  if (!Array.isArray(value.files)) {
    throw new Error('Plugin package files must be an array')
  }

  const paths = new Set<string>()
  const directories = new Set<string>()
  const files = value.files.map((file, index) => parsePackageFile(file, index, paths, directories))

  if (manifest.main) {
    // Development manifests may refer to external modules; installable archives
    // must contain their executable entry, including sidecar executables.
    const main = normalizePackagePath(manifest.main)
    const entry = files.find((file) => file.path === main)

    if (!entry) {
      throw new Error(`Plugin package entry is missing: ${manifest.main}`)
    }

    if ((manifest.host ?? 'worker') !== 'sidecar' && entry.encoding !== 'utf8') {
      throw new Error(
        `${manifest.host === 'dom' ? 'DOM' : 'Worker'} plugin entry must use utf8 encoding`,
      )
    }
  }

  for (const resource of manifest.resources ?? []) {
    if (!files.some((file) => file.path === normalizePackagePath(resource))) {
      throw new Error(`Plugin package resource is missing: ${resource}`)
    }
  }

  return Object.freeze({
    format: PLUGIN_PACKAGE_FORMAT,
    version: PLUGIN_PACKAGE_VERSION,
    manifest,
    files: Object.freeze(files),
  })
}

export function createPluginPackageArchive(
  manifestValue: unknown,
  filesValue: readonly PluginPackageFile[],
): PluginPackageArchive {
  return parsePluginPackageArchive({
    format: PLUGIN_PACKAGE_FORMAT,
    version: PLUGIN_PACKAGE_VERSION,
    manifest: manifestValue,
    files: filesValue,
  })
}

export function serializePluginPackageArchive(archive: PluginPackageArchive): string {
  return `${JSON.stringify(parsePluginPackageArchive(archive), null, 2)}\n`
}

export function readPluginPackageTextFile(archive: PluginPackageArchive, path: string): string {
  const normalized = normalizePackagePath(path)
  const file = archive.files.find((candidate) => candidate.path === normalized)

  if (!file) {
    throw new Error(`Plugin package file is missing: ${path}`)
  }

  if (file.encoding !== 'utf8') {
    throw new Error(`Plugin package file is not UTF-8 text: ${path}`)
  }

  return file.content
}

export function normalizePackagePath(path: string): string {
  if (/^[\\/]|^[a-zA-Z]:/.test(path) || /[\u0000-\u001f\u007f]/.test(path)) {
    throw new Error(
      `Plugin package path must be relative and contain no control characters: ${path}`,
    )
  }
  const parts = path.replace(/\\/g, '/').split('/')
  const normalized: string[] = []

  for (const part of parts) {
    if (!part || part === '.') {
      continue
    }

    if (part === '..') {
      throw new Error(`Plugin package path must stay inside the package: ${path}`)
    }

    // A package has one portable file layout. Reject Windows path aliases even
    // when parsing on Unix; this is format validation, not an OS sandbox.
    if (
      /[<>:"|?*]/.test(part) ||
      /[. ]$/.test(part) ||
      /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³]|conin\$|conout\$)(?:\.|$)/i.test(part)
    ) {
      throw new Error(`Plugin package path contains a nonportable component: ${path}`)
    }

    normalized.push(part)
  }

  if (normalized.length === 0 || /^[a-zA-Z]:$/.test(normalized[0] ?? '')) {
    throw new Error(`Plugin package path must be relative: ${path}`)
  }

  return normalized.join('/')
}

function parsePackageFile(
  value: unknown,
  index: number,
  paths: Set<string>,
  directories: Set<string>,
): PluginPackageFile {
  if (!isRecord(value)) {
    throw new Error(`Plugin package file ${index} must be an object`)
  }

  if (typeof value.path !== 'string' || typeof value.content !== 'string') {
    throw new Error(`Plugin package file ${index} requires path and content strings`)
  }

  if (value.encoding !== 'utf8' && value.encoding !== 'base64') {
    throw new Error(`Plugin package file ${index} has an invalid encoding`)
  }

  const path = normalizePackagePath(value.path)
  const key = path.toLowerCase()
  const parts = key.split('/')

  if (parts[0] === 'plugin.json') {
    throw new Error('Plugin package path plugin.json is reserved for the installed manifest')
  }
  if (paths.has(key)) {
    throw new Error(`Duplicate plugin package file: ${path}`)
  }
  if (directories.has(key)) {
    throw new Error(`Plugin package file conflicts with a directory: ${path}`)
  }
  for (let end = 1; end < parts.length; end += 1) {
    const parent = parts.slice(0, end).join('/')
    if (paths.has(parent)) {
      throw new Error(`Plugin package directory conflicts with a file: ${path}`)
    }
    directories.add(parent)
  }

  if (value.encoding === 'base64' && !isCanonicalBase64(value.content)) {
    throw new Error(`Plugin package file ${index} requires canonical base64 content`)
  }
  paths.add(key)
  return Object.freeze({ path, encoding: value.encoding, content: value.content })
}

/** Validate RFC 4648 bytes without allocating a decoded copy of a binary file. */
function isCanonicalBase64(content: string): boolean {
  if (content.length % 4 !== 0) return false
  const padding = content.endsWith('==') ? 2 : content.endsWith('=') ? 1 : 0
  const end = content.length - padding
  let last = 0
  for (let index = 0; index < end; index += 1) {
    const code = content.charCodeAt(index)
    if (code >= 65 && code <= 90) last = code - 65
    else if (code >= 97 && code <= 122) last = code - 71
    else if (code >= 48 && code <= 57) last = code + 4
    else if (code === 43) last = 62
    else if (code === 47) last = 63
    else return false
  }
  return padding === 2 ? (last & 15) === 0 : padding === 1 ? (last & 3) === 0 : true
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
