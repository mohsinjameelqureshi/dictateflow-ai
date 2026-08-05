/**
 * Drives spike 1 with synthetic input.
 *
 * nut.js sends real OS-level key events and uiohook listens at the OS level,
 * so this is a genuine end-to-end test of the hook — not a mock.
 *
 * Uses Ctrl+Alt rather than Ctrl+Win: synthesising a Win keypress pops the
 * Start menu. Both are modifier-only combos, so the thing being proved is
 * the same.
 *
 * Not covered here: auto-repeat. The OS only repeats physically held keys,
 * so that case still needs a human finger.
 */
import { spawn } from 'node:child_process'
import { keyboard, Key, sleep } from '@nut-tree-fork/nut-js'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
keyboard.config.autoDelayMs = 0

const child = spawn(process.execPath, ['01-hook.mjs', 'Ctrl+Alt'], { cwd: HERE })

let out = ''
child.stdout.on('data', (d) => {
  out += d.toString()
  process.stdout.write('  │ ' + d.toString().replace(/\n(?!$)/g, '\n  │ '))
})
child.stderr.on('data', (d) => process.stderr.write('  ! ' + d.toString()))

const waitFor = (re, ms = 5000) =>
  new Promise((res, rej) => {
    const t0 = Date.now()
    const tick = setInterval(() => {
      if (re.test(out)) { clearInterval(tick); res() }
      else if (Date.now() - t0 > ms) { clearInterval(tick); rej(new Error(`timeout waiting for ${re}`)) }
    }, 50)
  })

const hold = async (ms) => {
  await keyboard.pressKey(Key.LeftControl)
  await keyboard.pressKey(Key.LeftAlt)
  await sleep(ms)
  await keyboard.releaseKey(Key.LeftAlt)
  await keyboard.releaseKey(Key.LeftControl)
}

console.log('Spike 1 — driven with synthetic Ctrl+Alt\n')

try {
  await waitFor(/READY/)
  await sleep(300)

  console.log('\n  → hold 900ms')
  await hold(900)
  await sleep(400)

  console.log('\n  → hold 150ms (should trip the <400ms note)')
  await hold(150)
  await sleep(400)

  console.log('\n  → press Ctrl only (must NOT start)')
  await keyboard.pressKey(Key.LeftControl)
  await sleep(300)
  await keyboard.releaseKey(Key.LeftControl)
  await sleep(400)

  const starts = (out.match(/▶ START/g) ?? []).length
  const stops = (out.match(/■ STOP/g) ?? []).length
  const holds = [...out.matchAll(/held (\d+)ms/g)].map((m) => Number(m[1]))
  const shortNote = /under 400ms/.test(out)

  console.log('\n─── results ───')
  const checks = [
    ['two STARTs, no more', starts === 2, `got ${starts}`],
    ['two STOPs, no more', stops === 2, `got ${stops}`],
    ['first hold ~900ms', holds[0] >= 850 && holds[0] <= 1100, `${holds[0]}ms`],
    ['second hold ~150ms', holds[1] >= 100 && holds[1] <= 350, `${holds[1]}ms`],
    ['short-clip note fired', shortNote, String(shortNote)],
    ['partial combo ignored', starts === 2, `${starts} starts total`],
  ]
  let bad = 0
  for (const [name, ok, detail] of checks) {
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(24)} ${detail}`)
    if (!ok) bad++
  }
  console.log(`\n${bad === 0 ? 'spike 1 PASSES' : `${bad} check(s) failed`}`)
  child.kill()
  process.exit(bad === 0 ? 0 : 1)
} catch (err) {
  console.error('\nERROR', err.message)
  child.kill()
  process.exit(1)
}
