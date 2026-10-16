export type ImportPolicy = 'assets' | 'document-assets'
export const parsePolicy = (value: unknown): ImportPolicy =>
  value === 'document-assets' ? 'document-assets' : 'assets'

/** The host supplies a canonical relative URL; never turn it into a path or a network URL. */
export function markdownImage(alt: string, reference: string): string {
  if (alt.length > 512) throw new Error('替代文本最多 512 个字符。')
  let decoded: string
  try {
    decoded = decodeURIComponent(reference)
  } catch {
    throw new Error('图片资源引用无效，请重新选择图片。')
  }
  const parts = decoded.split('/')
  if (
    parts.length !== 2 ||
    !parts[0] ||
    !(parts[0] === 'assets' || parts[0].endsWith('.assets')) ||
    !parts[1] ||
    parts.some((part) => part === '.' || part === '..') ||
    /[\\\u0000-\u001f\u007f]/.test(decoded) ||
    /[:?#\s()<>\\\u0000-\u001f\u007f]/.test(reference) ||
    /%2f|%5c/i.test(reference) ||
    !/\.(?:png|jpe?g|webp)$/i.test(parts[1])
  )
    throw new Error('图片资源引用无效，请重新选择图片。')
  const safeAlt = alt
    .replace(/\r\n|\r|\n/g, ' ')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/[\\[\]]/g, '\\$&')
  return `![${safeAlt}](${reference})`
}
