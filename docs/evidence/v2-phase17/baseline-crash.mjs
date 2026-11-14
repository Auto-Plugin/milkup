import assert from 'node:assert/strict'
import { startProduction } from '/workspace/milkup/tests/helpers/native-production.mjs'
import { execFileSync } from 'node:child_process'
import { mkdir, writeFile, readFile, readdir, copyFile } from 'node:fs/promises'
const root = '/tmp/milkup-v2-phase17/baseline'
await mkdir(root, { recursive: true })
const results = []
async function killOwned(app, file) {
  const env = { ...process.env, DISPLAY: ':99' }
  const win = execFileSync('xdotool', ['search', '--class', 'milkup-desktop'], {
    env,
    encoding: 'utf8',
  })
    .trim()
    .split('\n')
    .at(-1)
  const pid = Number(
    /= (\d+)/.exec(
      execFileSync('xprop', ['-id', win, '_NET_WM_PID'], { env, encoding: 'utf8' }),
    )[1],
  )
  const cmd = (await readFile('/proc/' + pid + '/cmdline', 'utf8')).split('\0')
  assert.equal(cmd[0], app.application)
  assert(cmd.includes(file))
  const stat = await readFile('/proc/' + pid + '/stat', 'utf8')
  process.kill(pid, 'SIGKILL')
  return { pid, cmd, birth: stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19] }
}
for (const kind of ['untitled', 'existing', 'large']) {
  const dir = root + '/' + kind
  await mkdir(dir, { recursive: true })
  const file = dir + '/original.md',
    original =
      kind === 'large' ? 'BASE\n' + 'row abcdefghijklmnopqrstuvwxyz\n'.repeat(75000) : 'ORIGINAL\n'
  await writeFile(file, original)
  let app = await startProduction(file, dir)
  if (kind === 'untitled') {
    await app.key('ctrl+n')
    await app.until(
      () => app.execute('return document.querySelector("[data-title]").textContent==="未命名"'),
      'new draft',
    )
  }
  await app.text('UNSAVED17')
  await app.until(async () => (await app.probe()).dirty, 'dirty')
  const before = await app.probe()
  const files = await readdir(dir)
  for (const name of files.filter((n) => n.endsWith('.work'))) {
    await copyFile(dir + '/' + name, dir + '/' + name + '.preserved')
  }
  const owned = await killOwned(app, file)
  await app.close()
  app = await startProduction(file, dir)
  const after = await app.probe()
  assert.equal(await readFile(file, 'utf8'), original)
  results.push({
    kind,
    before,
    after,
    owned,
    originalUnchanged: true,
    recoveryPrompt: await app.execute(
      'return /恢复草稿|恢复记录|恢复副本/.test(document.body.innerText)',
    ),
    artifacts: await readdir(dir),
  })
  await app.shot('after-crash')
  await app.close()
  await writeFile(root + '/results.json', JSON.stringify(results, null, 2))
}
