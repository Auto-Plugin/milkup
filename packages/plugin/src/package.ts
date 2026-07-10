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
  const files = value.files.map((file, index) => parsePackageFile(file, index, paths))

  if (manifest.main && isRelativePackagePath(manifest.main)) {
    const main = manifest.main
    const entry = files.find((file) => file.path === normalizePackagePath(main))

    if (!entry) {
      throw new Error(`Plugin package entry is missing: ${manifest.main}`)
    }

    if ((manifest.host ?? 'worker') === 'worker' && entry.encoding !== 'utf8') {
      throw new Error('Worker plugin entry must use utf8 encoding')
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
  const parts = path.replace(/\\/g, '/').split('/')
  const normalized: string[] = []

  for (const part of parts) {
    if (!part || part === '.') {
      continue
    }

    if (part === '..') {
      throw new Error(`Plugin package path must stay inside the package: ${path}`)
    }

    normalized.push(part)
  }

  if (normalized.length === 0 || /^[a-zA-Z]:$/.test(normalized[0] ?? '')) {
    throw new Error(`Plugin package path must be relative: ${path}`)
  }

  return normalized.join('/')
}

function parsePackageFile(value: unknown, index: number, paths: Set<string>): PluginPackageFile {
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

  if (paths.has(path)) {
    throw new Error(`Duplicate plugin package file: ${path}`)
  }

  paths.add(path)
  return Object.freeze({ path, encoding: value.encoding, content: value.content })
}

function isRelativePackagePath(path: string): boolean {
  return !/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(path) && !/^(?:\/|\\|[a-zA-Z]:)/.test(path)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
