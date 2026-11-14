import { describe, expect, it } from 'vitest'
import { pluginIconDataUrl, pluginIconMaxBytes } from './plugin-icon'

const png = () =>
  Uint8Array.from(
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZZkAAAAASUVORK5CYII=',
      'base64',
    ),
  )
describe('package icon raster boundary', () => {
  it('accepts a bounded PNG and rejects active content, oversized files and dimensions', () => {
    expect(pluginIconDataUrl(png())).toMatch(/^data:image\/png;base64,/)
    expect(
      pluginIconDataUrl(new TextEncoder().encode('<svg onload="alert(1)"></svg>')),
    ).toBeUndefined()
    expect(pluginIconDataUrl(new Uint8Array(pluginIconMaxBytes + 1))).toBeUndefined()
    const large = png()
    new DataView(large.buffer).setUint32(16, 1025)
    expect(pluginIconDataUrl(large)).toBeUndefined()
    new DataView(large.buffer).setUint32(16, 0)
    expect(pluginIconDataUrl(large)).toBeUndefined()
  })
})
