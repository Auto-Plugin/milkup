import assert from 'node:assert/strict'
import { test } from 'node:test'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { finalizeObserverProcess } from './mermaid-gui-regression.mjs'

test('failed observer stop still sends EOF, retains failure and lets the owned process exit', async () => {
  const child = spawn(
    process.execPath,
    [
      '-e',
      "process.stdin.resume();process.stdin.on('end',()=>process.stdout.write('incomplete-report-retained'))",
    ],
    { stdio: ['pipe', 'pipe', 'pipe'] },
  )
  const observer = { child, exitCode: undefined }
  let output = ''
  child.stdout.on('data', (b) => (output += b))
  const exited = once(child, 'close').then(([code]) => (observer.exitCode = code))
  const original = Error('explicit stop did not acknowledge')
  try {
    await assert.rejects(
      finalizeObserverProcess(
        observer,
        async () => {
          throw original
        },
        () => exited,
      ),
      (error) => {
        assert(error instanceof AggregateError)
        assert.equal(error.errors[0], original)
        return true
      },
    )
    assert.equal(output, 'incomplete-report-retained')
    assert.equal(observer.exitCode, 0)
  } finally {
    if (child.exitCode === null) child.kill()
  }
})
test('report parsing failure remains a failure even after normal observer exit', async () => {
  const child = spawn(process.execPath, ['-e', 'process.stdin.resume()'], {
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  const observer = { child, exitCode: undefined }
  const exited = once(child, 'close').then(([code]) => (observer.exitCode = code))
  try {
    await assert.rejects(
      finalizeObserverProcess(
        observer,
        async () => JSON.parse('truncated'),
        () => exited,
      ),
      /Unexpected token/,
    )
  } finally {
    if (child.exitCode === null) child.kill()
  }
})
