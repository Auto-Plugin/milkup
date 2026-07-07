import { describe, expect, it } from 'vitest'

import { ChangeSet, MemoryTextDocument } from '../index'

describe('MemoryTextDocument', () => {
  it('creates an empty document', () => {
    const doc = new MemoryTextDocument()

    expect(doc.text).toBe('')
    expect(doc.length).toBe(0)
    expect(doc.lineCount).toBe(1)
    expect(doc.line(1)).toEqual({ number: 1, from: 0, to: 0, text: '' })
  })

  it('inserts text at the beginning', () => {
    const doc = new MemoryTextDocument('world').apply(ChangeSet.insert(0, 'hello '))

    expect(doc.text).toBe('hello world')
  })

  it('inserts text at the end', () => {
    const doc = new MemoryTextDocument('hello').apply(ChangeSet.insert(5, ' world'))

    expect(doc.text).toBe('hello world')
  })

  it('inserts text in the middle', () => {
    const doc = new MemoryTextDocument('hello world').apply(ChangeSet.insert(5, ' quiet'))

    expect(doc.text).toBe('hello quiet world')
  })

  it('deletes a range at the beginning', () => {
    const doc = new MemoryTextDocument('noisy hello world').apply(ChangeSet.delete(0, 6))

    expect(doc.text).toBe('hello world')
  })

  it('deletes a range in the middle', () => {
    const doc = new MemoryTextDocument('hello noisy world').apply(ChangeSet.delete(5, 11))

    expect(doc.text).toBe('hello world')
  })

  it('deletes a range at the end', () => {
    const doc = new MemoryTextDocument('hello world noisy').apply(ChangeSet.delete(11, 17))

    expect(doc.text).toBe('hello world')
  })

  it('replaces a range', () => {
    const doc = new MemoryTextDocument('hello old world').apply(ChangeSet.replace(6, 9, 'new'))

    expect(doc.text).toBe('hello new world')
  })

  it('applies multiple non-overlapping changes', () => {
    const doc = new MemoryTextDocument('one two three').apply(
      ChangeSet.of([
        { from: 0, to: 3, insert: '1' },
        { from: 4, to: 7, insert: '2' },
        { from: 8, to: 13, insert: '3' },
      ]),
    )

    expect(doc.text).toBe('1 2 3')
  })

  it('preserves blank lines and trailing newline', () => {
    const source = '```python\nprint(1)\n\nprint(2)\n```\n'
    const doc = new MemoryTextDocument(source)

    expect(doc.text).toBe(source)
    expect(doc.lineCount).toBe(6)
    expect(doc.line(3)).toEqual({ number: 3, from: 19, to: 19, text: '' })
    expect(doc.line(6)).toEqual({ number: 6, from: source.length, to: source.length, text: '' })
  })

  it('finds lines by document position', () => {
    const doc = new MemoryTextDocument('a\nbb\nccc')

    expect(doc.lineAt(0).number).toBe(1)
    expect(doc.lineAt(2).number).toBe(2)
    expect(doc.lineAt(5).number).toBe(3)
  })

  it('maps positions through insertions', () => {
    const changes = ChangeSet.insert(5, ' beautiful')

    expect(changes.mapPosition(0)).toBe(0)
    expect(changes.mapPosition(5, -1)).toBe(5)
    expect(changes.mapPosition(5, 1)).toBe(15)
    expect(changes.mapPosition(11)).toBe(21)
  })

  it('maps positions through replacements', () => {
    const changes = ChangeSet.replace(6, 11, 'new')

    expect(changes.mapPosition(0)).toBe(0)
    expect(changes.mapPosition(6, -1)).toBe(6)
    expect(changes.mapPosition(8, 1)).toBe(9)
    expect(changes.mapPosition(12)).toBe(10)
  })

  it('rejects overlapping changes', () => {
    expect(() =>
      ChangeSet.of([
        { from: 0, to: 5, insert: 'a' },
        { from: 4, to: 7, insert: 'b' },
      ]),
    ).toThrow('sorted and non-overlapping')
  })
})
