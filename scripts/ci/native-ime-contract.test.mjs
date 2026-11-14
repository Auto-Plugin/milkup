import { test } from 'node:test'
import assert from 'node:assert/strict'
import { verifyNativeImeCommit } from './native-ime-contract.mjs'
const input = {
  type: 'input',
  data: '中文',
  trusted: true,
  composing: true,
  inputType: 'insertFromComposition',
  time: 4259,
}
const end = { type: 'compositionend', data: '中文', trusted: true, time: 4276 }
test('accepts the captured external WebKit preedit order', () =>
  assert.equal(verifyNativeImeCommit([input, end]).path, 'external-preedit-composing-input'))
test('accepts complete native DOM preedit', () =>
  assert.equal(
    verifyNativeImeCommit([
      { type: 'compositionstart', trusted: true, time: 1 },
      { type: 'compositionupdate', data: 'zhong', trusted: true, time: 2 },
      end,
    ]).path,
    'dom-preedit',
  ))
for (const [name, events] of [
  ['missing final', [input]],
  ['wrong final', [input, { ...end, data: '中文中文' }]],
  ['untrusted input', [{ ...input, trusted: false }, end]],
  ['untrusted final', [input, { ...end, trusted: false }]],
  ['ordinary input', [{ ...input, composing: false }, end]],
  ['beforeinput only', [{ ...input, type: 'beforeinput' }, end]],
  ['reversed order', [end, input]],
  ['reversed time', [{ ...input, time: 5000 }, end]],
  ['no provenance', [end]],
  [
    'untrusted preedit',
    [
      { type: 'compositionstart', trusted: false, time: 1 },
      { type: 'compositionupdate', trusted: true, time: 2 },
      end,
    ],
  ],
])
  test('rejects ' + name, () => assert.throws(() => verifyNativeImeCommit(events)))
