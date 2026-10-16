// Independent X11 recording; recording overhead excludes this spot from latency matrix.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { startProduction } from '../helpers/native-production.mjs'
const root = path.resolve(process.env.MILKUP_NATIVE_EVIDENCE_DIR)
await mkdir(root, { recursive: true })
assert(process.env.MILKUP_SEARCH_FIXTURE)
const file = path.join(root, 'presentation.md')
await copyFile(process.env.MILKUP_SEARCH_FIXTURE, file)
const original = await readFile(file),
  events = []
let app,
  recorder,
  log = '',
  finished
try {
  app = await startProduction(file, root)
  await app.key('ctrl+2')
  await app.focus('.milkup-input-proxy')
  await app.key('ctrl+Home')
  await app.until(async () => (await app.probe()).cursor === 0, 'home')
  await app.execute(
    `window.__presentation=[];addEventListener('keydown',e=>window.__presentation.push({key:e.key,wall:Date.now(),at:performance.now(),trusted:e.isTrusted}),true)`,
  )
  recorder = spawn(
    'ffmpeg',
    [
      '-hide_banner',
      '-nostdin',
      '-f',
      'x11grab',
      '-framerate',
      '60',
      '-video_size',
      '1100x760',
      '-i',
      ':99.0',
      '-t',
      '8',
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-crf',
      '0',
      path.join(root, 'native-presentation.mkv'),
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  )
  finished = once(recorder, 'close')
  recorder.stderr.on('data', (chunk) => {
    log += chunk.toString()
  })
  await app.until(() => log.includes('Output #0'), 'X11 recording started', 5000)
  await app.delay(400)
  events.push({ action: 'q-before-send', wall: Date.now() })
  await app.key('q')
  events.push({ action: 'q-sent', wall: Date.now() })
  await app.until(async () => (await app.probe()).cursor === 1, 'q visible')
  await app.delay(800)
  events.push({ action: 'backspace-before-send', wall: Date.now() })
  await app.key('BackSpace')
  events.push({ action: 'backspace-sent', wall: Date.now() })
  await app.until(async () => (await app.probe()).cursor === 0, 'backspace visible')
  await app.delay(400)
  recorder.kill('SIGINT')
  const [code, signal] = await finished
  assert(code === 0 || code === 255, `ffmpeg exit ${code}/${signal}`)
  await app.key('ctrl+s')
  await app.until(
    async () => {
      const p = await app.probe()
      return !p.saving && !p.dirty
    },
    'saved',
    20000,
  )
  assert((await readFile(file)).equals(original))
  const keys = await app.execute('return window.__presentation')
  assert(keys.filter((e) => ['q', 'Backspace'].includes(e.key)).every((e) => e.trusted))
  await app.shot('presentation-final')
  await writeFile(
    path.join(root, 'results.json'),
    JSON.stringify(
      {
        events,
        keys,
        bytes: original.length,
        sha256: createHash('sha256').update(original).digest('hex'),
        recording: {
          code,
          signal,
          scope:
            'X11 composited pixels at requested 60 fps, independent presentation evidence; capture overhead and dropped/duplicated frames not controlled; not photon latency or a 200ms pass',
        },
        exactBytes: true,
      },
      null,
      2,
    ),
  )
} finally {
  if (recorder && recorder.exitCode === null) {
    recorder.kill('SIGINT')
    await finished
  }
  await writeFile(path.join(root, 'ffmpeg.log'), log)
  await app?.close()
}
