const POSITION_ERROR = 'Position must be a non-negative integer'

export function insertText(position, text) {
  assertPosition(position)
  assertString(text, 'Inserted text must be a string')

  return replaceRange(position, position, text)
}

export function deleteRange(from, to) {
  return replaceRange(from, to, '')
}

export function replaceRange(from, to, text) {
  assertRange(from, to)
  assertString(text, 'Replacement text must be a string')

  return freezeChangeSet([{ from, to, insert: text }])
}

export function cursor(position) {
  assertPosition(position)

  return Object.freeze({
    ranges: Object.freeze([
      Object.freeze({
        anchor: position,
        head: position,
        from: position,
        to: position,
        empty: true,
        affinity: 'none',
      }),
    ]),
    mainIndex: 0,
    main: Object.freeze({
      anchor: position,
      head: position,
      from: position,
      to: position,
      empty: true,
      affinity: 'none',
    }),
  })
}

export function rangeSelection(anchor, head) {
  assertPosition(anchor)
  assertPosition(head)

  const from = Math.min(anchor, head)
  const to = Math.max(anchor, head)
  const range = Object.freeze({
    anchor,
    head,
    from,
    to,
    empty: anchor === head,
    affinity: 'none',
  })

  return Object.freeze({
    ranges: Object.freeze([range]),
    mainIndex: 0,
    main: range,
  })
}

export function dispatchInsert(context, text, options = {}) {
  const editor = requireEditor(context)
  const position = editor.state.selection.main.head

  editor.dispatch({
    changes: insertText(position, text),
    selection: cursor(position + text.length),
    origin: {
      type: 'command',
      id: options.commandId ?? context.command?.action ?? 'plugin.insert',
    },
    historyGroup: options.historyGroup ?? 'isolate',
  })
}

function freezeChangeSet(changes) {
  const frozenChanges = Object.freeze(changes.map((change) => Object.freeze({ ...change })))

  return Object.freeze({
    changes: frozenChanges,
    empty: frozenChanges.length === 0,
    mapPosition: (position, affinity = 1) => mapPosition(frozenChanges, position, affinity),
  })
}

function mapPosition(changes, position, affinity) {
  assertPosition(position)

  let mapped = position

  for (const change of changes) {
    const deletedLength = change.to - change.from
    const insertedLength = change.insert.length
    const delta = insertedLength - deletedLength

    if (position < change.from) {
      break
    }

    if (position > change.to) {
      mapped += delta
      continue
    }

    mapped = affinity < 0 ? change.from : change.from + insertedLength
  }

  return mapped
}

function requireEditor(context) {
  if (!context?.editor) {
    throw new Error('Plugin command requires an editor context')
  }

  return context.editor
}

function assertRange(from, to) {
  assertPosition(from)
  assertPosition(to)

  if (to < from) {
    throw new RangeError('Range end must be greater than or equal to range start')
  }
}

function assertPosition(position) {
  if (!Number.isInteger(position) || position < 0) {
    throw new RangeError(POSITION_ERROR)
  }
}

function assertString(value, message) {
  if (typeof value !== 'string') {
    throw new TypeError(message)
  }
}
