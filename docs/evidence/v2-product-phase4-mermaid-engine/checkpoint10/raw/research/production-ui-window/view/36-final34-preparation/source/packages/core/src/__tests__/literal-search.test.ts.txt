import { describe, expect, it } from 'vitest'
import { createLiteralLineMatcher } from '../store/literal-search'

describe('literal line matching shared by native fallback and memory search', () => {
  it('preserves locale case expansion and UTF-16 coordinates without overlap', () => {
    expect([...createLiteralLineMatcher('i')('😀İiİ')]).toEqual([
      { from: 2, to: 3, text: 'İ' },
      { from: 3, to: 4, text: 'i' },
      { from: 4, to: 5, text: 'İ' },
    ])
    expect([...createLiteralLineMatcher('\u0307')('İİ')].map((hit) => [hit.from, hit.to])).toEqual([
      [0, 1],
      [1, 2],
    ])
    expect([...createLiteralLineMatcher('aa')('aaaaa')].map((hit) => hit.from)).toEqual([0, 2])
    expect([...createLiteralLineMatcher('Σ')('ΟΣ Σ')].map((hit) => hit.from)).toEqual([3])
  })
  it('keeps case-sensitive literal punctuation, CJK, and surrogate pairs', () => {
    expect(
      [...createLiteralLineMatcher('😀中文', true)('A😀中文 a😀中文')].map((hit) => [
        hit.from,
        hit.to,
      ]),
    ).toEqual([
      [1, 5],
      [7, 11],
    ])
    expect([...createLiteralLineMatcher('[x]', true)('[X] [x]')].map((hit) => hit.from)).toEqual([
      4,
    ])
  })
  it('yields dense results lazily and rejects an empty needle', () => {
    const hits = createLiteralLineMatcher('x')('x'.repeat(1000000))
    expect(hits.next().value).toEqual({ from: 0, to: 1, text: 'x' })
    expect(hits.next().value).toEqual({ from: 1, to: 2, text: 'x' })
    expect(() => createLiteralLineMatcher('')).toThrow()
  })
})
