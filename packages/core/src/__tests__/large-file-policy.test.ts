import { describe, expect, it } from 'vitest'

import {
  classifyDocumentScale,
  getFeatureDegradationPolicy,
  GIB,
  MIB,
  resolveFeatureDegradationPolicy,
} from '../index'

describe('large file feature policy', () => {
  it('classifies documents using the architecture scale thresholds', () => {
    expect(classifyDocumentScale({ sizeBytes: 0 })).toBe('normal')
    expect(classifyDocumentScale({ sizeBytes: 10 * MIB - 1 })).toBe('normal')
    expect(classifyDocumentScale({ sizeBytes: 10 * MIB })).toBe('incremental')
    expect(classifyDocumentScale({ sizeBytes: 100 * MIB - 1 })).toBe('incremental')
    expect(classifyDocumentScale({ sizeBytes: 100 * MIB })).toBe('large')
    expect(classifyDocumentScale({ sizeBytes: GIB - 1 })).toBe('large')
    expect(classifyDocumentScale({ sizeBytes: GIB })).toBe('ultra-large')
  })

  it('supports testable custom thresholds', () => {
    expect(
      classifyDocumentScale({
        sizeBytes: 50,
        thresholds: {
          incrementalBytes: 10,
          largeBytes: 40,
          ultraLargeBytes: 100,
        },
      }),
    ).toBe('large')
  })

  it('rejects invalid sizes and threshold ordering', () => {
    expect(() => classifyDocumentScale({ sizeBytes: -1 })).toThrow('Invalid document size')
    expect(() =>
      classifyDocumentScale({
        sizeBytes: 1,
        thresholds: {
          incrementalBytes: 10,
          largeBytes: 10,
          ultraLargeBytes: 100,
        },
      }),
    ).toThrow('positive and increasing')
  })

  it('keeps normal mode fully featured for small documents', () => {
    expect(getFeatureDegradationPolicy('normal')).toEqual({
      mode: 'normal',
      store: 'memory',
      parse: 'full',
      render: 'full-dom',
      liveRender: 'full',
      search: 'memory',
      outline: 'full',
      pluginRendering: 'full',
      autoRenderMermaid: true,
      fullDocumentDomRequired: true,
      fullDocumentParseRequired: true,
    })
  })

  it('degrades incremental mode without requiring full DOM or full parse', () => {
    expect(getFeatureDegradationPolicy('incremental')).toMatchObject({
      mode: 'incremental',
      store: 'memory',
      parse: 'incremental',
      render: 'virtual-dom',
      fullDocumentDomRequired: false,
      fullDocumentParseRequired: false,
    })
  })

  it('uses chunked local-window behavior for large files', () => {
    expect(resolveFeatureDegradationPolicy({ sizeBytes: 250 * MIB })).toMatchObject({
      mode: 'large',
      store: 'chunked',
      parse: 'local-window',
      render: 'viewport-dom',
      liveRender: 'viewport',
      search: 'chunked',
      outline: 'on-demand',
      autoRenderMermaid: false,
      fullDocumentDomRequired: false,
      fullDocumentParseRequired: false,
    })
  })

  it('uses source-first on-demand behavior for ultra-large files', () => {
    expect(resolveFeatureDegradationPolicy({ sizeBytes: 2 * GIB })).toMatchObject({
      mode: 'ultra-large',
      store: 'chunked',
      parse: 'on-demand',
      render: 'viewport-dom',
      liveRender: 'source-first',
      search: 'chunked',
      outline: 'disabled',
      pluginRendering: 'manual',
      autoRenderMermaid: false,
      fullDocumentDomRequired: false,
      fullDocumentParseRequired: false,
    })
  })
})
