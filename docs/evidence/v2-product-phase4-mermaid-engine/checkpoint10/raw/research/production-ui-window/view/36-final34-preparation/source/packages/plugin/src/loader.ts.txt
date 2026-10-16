import { parsePluginManifest, type PluginHostKind, type PluginManifest } from './manifest'
import type { PluginModule } from './runtime'

export interface LocalPluginLoadRequest {
  readonly manifestPath: string
  readonly moduleSpecifier?: string
  readonly allowedHosts?: readonly PluginHostKind[]
}

export interface LocalPluginHost {
  readText(path: string): string | Promise<string>
  importModule?(specifier: string, context: LocalPluginImportContext): unknown | Promise<unknown>
}

export interface LocalPluginImportContext {
  readonly manifest: PluginManifest
  readonly manifestPath: string
  readonly moduleSpecifier: string
}

export interface LoadedLocalPlugin {
  readonly manifest: PluginManifest
  readonly module?: PluginModule
  readonly manifestPath: string
  readonly moduleSpecifier?: string
}

export async function loadLocalPlugin(
  request: LocalPluginLoadRequest,
  host: LocalPluginHost,
): Promise<LoadedLocalPlugin> {
  const manifestText = await host.readText(request.manifestPath)
  const manifest = parsePluginManifest(parseManifestJson(manifestText, request.manifestPath))
  const moduleSpecifier = request.moduleSpecifier ?? manifest.main

  if (moduleSpecifier && host.importModule) {
    assertLocalImportHostAllowed(manifest, request.allowedHosts)
  }

  const importedModule =
    moduleSpecifier && host.importModule
      ? coercePluginModule(
          await host.importModule(moduleSpecifier, {
            manifest,
            manifestPath: request.manifestPath,
            moduleSpecifier,
          }),
        )
      : undefined

  return Object.freeze({
    manifest,
    manifestPath: request.manifestPath,
    ...(moduleSpecifier ? { moduleSpecifier } : {}),
    ...(importedModule ? { module: importedModule } : {}),
  })
}

export function coercePluginModule(value: unknown): PluginModule {
  const moduleValue = unwrapDefaultExport(value)

  if (!isRecord(moduleValue)) {
    throw new Error('Plugin module must export an object')
  }

  return moduleValue as PluginModule
}

function assertLocalImportHostAllowed(
  manifest: PluginManifest,
  allowedHosts: readonly PluginHostKind[] = ['worker'],
): void {
  const host = manifest.host ?? 'worker'

  if (!allowedHosts.includes(host)) {
    throw new Error(`Plugin host is not supported by local loader: ${host}`)
  }
}

function parseManifestJson(text: string, manifestPath: string): unknown {
  try {
    return JSON.parse(text) as unknown
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Invalid plugin manifest JSON at ${manifestPath}: ${message}`)
  }
}

function unwrapDefaultExport(value: unknown): unknown {
  if (isRecord(value) && isRecord(value.default)) {
    return value.default
  }

  return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
