import { startProduction } from '/workspace/milkup/tests/helpers/native-production.mjs'
import { mkdir, writeFile } from 'node:fs/promises'
import { spawn, execFileSync } from 'node:child_process'
const root = '/tmp/milkup-v2-phase16/loading-video'
await mkdir(root, { recursive: true })
const file = root + '/review.md'
await writeFile(file, '# 加载前的普通正文\n')
const app = await startProduction(file, root)
let video, oldPaths
try {
  oldPaths = await app.execute('return localStorage.getItem("milkup.desktop.nativeTestPaths")')
  await app.execute(
    'localStorage.setItem("milkup.desktop.nativeTestPaths",JSON.stringify({open:arguments[0]}))',
    '/tmp/milkup-v2-phase13/native-scroll-batched/original.md',
  )
  let stderr = ''
  video = spawn('ffmpeg', [
    '-y',
    '-f',
    'x11grab',
    '-framerate',
    '30',
    '-video_size',
    '1280x800',
    '-i',
    ':99',
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    '-crf',
    '18',
    root + '/open.mp4',
  ])
  video.stderr.on('data', (d) => (stderr += d))
  const done = new Promise((resolve) => video.on('exit', resolve))
  await app.delay(400)
  const before = performance.now()
  await app.key('ctrl+o')
  await app.until(
    async () => {
      const p = await app.probe()
      return p.path.endsWith('/original.md') && p.loading === 'ready'
    },
    'native load ready',
    20000,
  )
  const ready = performance.now()
  await app.delay(800)
  video.kill('SIGINT')
  const exit = await done
  await writeFile(
    root + '/timing.json',
    JSON.stringify(
      {
        recordingWarmupMs: 400,
        keyAt: before,
        readyAt: ready,
        observedElapsedMs: ready - before,
        ffmpegExit: exit,
      },
      null,
      2,
    ),
  )
  await writeFile(root + '/ffmpeg.log', stderr)
  execFileSync(
    'ffmpeg',
    ['-y', '-i', root + '/open.mp4', '-vf', 'fps=10', root + '/frame-%02d.png'],
    { stdio: 'ignore' },
  )
} finally {
  if (video?.exitCode === null) video.kill('SIGINT')
  await app
    .execute(
      'if(arguments[0]===null)localStorage.removeItem("milkup.desktop.nativeTestPaths");else localStorage.setItem("milkup.desktop.nativeTestPaths",arguments[0])',
      oldPaths ?? null,
    )
    .catch(() => {})
  await app.close()
}
