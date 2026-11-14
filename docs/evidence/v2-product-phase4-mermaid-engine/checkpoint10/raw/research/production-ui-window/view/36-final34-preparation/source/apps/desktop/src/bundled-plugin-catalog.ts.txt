/// <reference types="vite/client" />

// Archives remain data. They are installed and loaded by the normal plugin host,
// never imported as host modules. An ordinary development build may have none.
const archives = import.meta.glob<string>('./bundled-plugins/*.milkup-plugin', {
  query: '?raw',
  import: 'default',
  eager: true,
})
const catalog = new Map(
  Object.entries(archives).map(([path, text]) => [
    `bundled:${path.slice(path.lastIndexOf('/') + 1)}`,
    text,
  ]),
)

export function bundledPluginPaths(): readonly string[] {
  return [...catalog.keys()].sort()
}

export function readBundledPlugin(path: string): string | undefined {
  return catalog.get(path)
}
