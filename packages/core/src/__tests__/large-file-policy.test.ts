import { describe, expect, it } from 'vitest'

import {
  classifyDocumentScale,
  getFeatureDegradationPolicy,
  MIB,
  resolveFeatureDegradationPolicy,
} from '../index'

describe('large file feature policy', () => {
  it('classifies documents using the architecture scale thresholds', () => {
    expect(classifyDocumentScale({ sizeBytes: 0 })).toBe('full')
    expect(classifyDocumentScale({ sizeBytes: 128 * 1024 - 1 })).toBe('full')
    expect(classifyDocumentScale({ sizeBytes: 128 * 1024 })).toBe('performance')
    expect(classifyDocumentScale({ sizeBytes: 2 * MIB })).toBe('performance')
  })

  it('supports testable custom thresholds', () => {
    expect(
      classifyDocumentScale({
        sizeBytes: 50,
        thresholds: {
          performanceBytes: 40,
        },
      }),
    ).toBe('performance')
  })

  it('rejects invalid sizes and threshold ordering', () => {
    expect(() => classifyDocumentScale({ sizeBytes: -1 })).toThrow('Invalid document size')
    expect(() =>
      classifyDocumentScale({
        sizeBytes: 1,
        thresholds: {
          performanceBytes: 0,
        },
      }),
    ).toThrow('positive')
  })

  it('keeps full mode fully featured for small documents', () => {
    expect(getFeatureDegradationPolicy('full')).toEqual({
      mode: 'full',
      store: 'memory',
      parse: 'full',
      render: 'full-dom',
      liveRender: 'full',
      search: 'memory',
      pluginRendering: 'full',
      autoRenderMermaid: true,
      fullDocumentDomRequired: true,
      fullDocumentParseRequired: true,
    })
  })

  it('uses one performance policy for larger files', () => {
    expect(resolveFeatureDegradationPolicy({ sizeBytes: 512 * 1024 })).toMatchObject({
      mode: 'performance',
      store: 'chunked',
      parse: 'local-window',
      render: 'viewport-dom',
      liveRender: 'viewport',
      search: 'chunked',
      autoRenderMermaid: false,
      fullDocumentDomRequired: false,
      fullDocumentParseRequired: false,
    })
  })
})
