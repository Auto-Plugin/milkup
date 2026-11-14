// Linux test-only process ownership: never signal by name or a guessed PID.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
export async function ownedApplication(application, launchFile) {
  const env = { ...process.env, DISPLAY: process.env.DISPLAY ?? ':99' }
  const ids = execFileSync('xdotool', ['search', '--class', 'milkup-desktop'], {
    encoding: 'utf8',
    env,
  })
    .trim()
    .split('\n')
  const matches = []
  for (const id of ids) {
    const pid = Number(
      /= (\d+)/.exec(
        execFileSync('xprop', ['-id', id, '_NET_WM_PID'], { encoding: 'utf8', env }),
      )?.[1],
    )
    if (!pid || matches.some((match) => match.pid === pid)) continue
    const argv = (await readFile(`/proc/${pid}/cmdline`, 'utf8')).split('\0')
    if (argv[0] !== application || !argv.includes(launchFile)) continue
    const stat = await readFile(`/proc/${pid}/stat`, 'utf8')
    matches.push({ pid, argv, birth: stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19] })
  }
  assert.equal(matches.length, 1, 'exactly one application with the authorized binary and fixture')
  const identity = matches[0]
  return {
    identity,
    async signal(signal) {
      assert(['SIGKILL', 'SIGSTOP', 'SIGCONT'].includes(signal))
      const argv = (await readFile(`/proc/${identity.pid}/cmdline`, 'utf8')).split('\0')
      const stat = await readFile(`/proc/${identity.pid}/stat`, 'utf8')
      assert.deepEqual(argv, identity.argv)
      assert.equal(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19], identity.birth)
      process.kill(identity.pid, signal)
      return { ...identity, signal, at: new Date().toISOString() }
    },
  }
}
