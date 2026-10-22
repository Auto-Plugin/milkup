/** Display only; never use this value for filesystem access. */
export function formatDisplayPath(path: string): string {
  const display = path.replace(/\\/g, '/')
  if (/^\/\/\?\/UNC\//i.test(display)) return '//' + display.slice(8)
  if (/^\/\/\?\/[a-z]:\//i.test(display)) return display.slice(4)
  return display
}
