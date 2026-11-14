import assert from 'node:assert/strict'

// DOM preedit is optional for an external OS candidate window. Final native
// provenance is not optional: either a complete composition or the observed
// WebKit composing-input -> compositionend sequence must be trusted and ordered.
export function verifyNativeImeCommit(events, text = '中文') {
  assert(Array.isArray(events) && events.length <= 600)
  const endIndex = events.findIndex(
    (e) => e.type === 'compositionend' && e.data === text && e.trusted === true,
  )
  assert(endIndex >= 0, 'Trusted final IME text required')
  const end = events[endIndex]
  assert(Number.isFinite(end.time))
  const before = events
    .slice(0, endIndex)
    .filter((e) => e.trusted === true && Number.isFinite(e.time) && e.time <= end.time)
  const composingInput = before.find(
    (e) =>
      e.type === 'input' &&
      e.data === text &&
      e.composing === true &&
      e.inputType === 'insertFromComposition',
  )
  const start = before.find((e) => e.type === 'compositionstart')
  const update = start && before.find((e) => e.type === 'compositionupdate' && e.time >= start.time)
  assert(
    composingInput || (start && update),
    'Native composition provenance required; beforeinput alone is insufficient',
  )
  return {
    path: start && update ? 'dom-preedit' : 'external-preedit-composing-input',
    finalData: end.data,
    finalTime: end.time,
    inputTime: composingInput?.time ?? null,
  }
}
