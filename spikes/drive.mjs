/**
 * Drives spike 3 without a human or a microphone.
 *
 * Chromium can fake the capture device from a WAV file
 * (--use-file-for-fake-audio-capture), so the §6.6 guards can be tested
 * deterministically instead of depending on a quiet room and fast fingers.
 *
 *   node drive.mjs
 */
import { _electron as electron } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FIX = path.join(os.tmpdir(), 'dictateflow-spike-fixtures')

/** Chromium's fake capture wants 48k stereo; it resamples down for us. */
function writeWav(file, seconds, fill) {
  const rate = 48000
  const n = Math.floor(rate * seconds)
  const buf = Buffer.alloc(44 + n * 2)
  buf.write('RIFF', 0, 'ascii')
  buf.writeUInt32LE(36 + n * 2, 4)
  buf.write('WAVE', 8, 'ascii')
  buf.write('fmt ', 12, 'ascii')
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20)
  buf.writeUInt16LE(1, 22)
  buf.writeUInt32LE(rate, 24)
  buf.writeUInt32LE(rate * 2, 28)
  buf.writeUInt16LE(2, 32)
  buf.writeUInt16LE(16, 34)
  buf.write('data', 36, 'ascii')
  buf.writeUInt32LE(n * 2, 40)
  for (let i = 0; i < n; i++) buf.writeInt16LE(fill(i, rate), 44 + i * 2)
  fs.writeFileSync(file, buf)
  return file
}

fs.mkdirSync(FIX, { recursive: true })
const SILENCE = writeWav(path.join(FIX, 'silence.wav'), 4, () => 0)
const SPEECH = writeWav(path.join(FIX, 'tone.wav'), 4, (i, r) =>
  // Amplitude-modulated tone. Loud enough to clear the floor, varying enough
  // to be a fair stand-in for speech.
  Math.round(12000 * Math.sin((2 * Math.PI * 220 * i) / r) * (0.6 + 0.4 * Math.sin((2 * Math.PI * 3 * i) / r))),
)

async function run(name, { audioFile, holdMs }) {
  const args = ['03-audio/main.cjs', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream']
  if (audioFile) args.push(`--use-file-for-fake-audio-capture=${audioFile}%noloop`)

  const app = await electron.launch({ args, cwd: HERE })
  const win = await app.firstWindow()
  await win.waitForSelector('#btn')

  await win.click('#btn')
  await win.waitForFunction(() => document.getElementById('btn').textContent === 'Stop', null, { timeout: 5000 })
  if (holdMs) await win.waitForTimeout(holdMs)
  await win.click('#btn')

  // Wait for the verdict line rather than a fixed sleep.
  await win.waitForFunction(
    () => /would (SEND|REJECT)/.test(document.getElementById('log').textContent),
    null,
    { timeout: 10000 },
  )

  const lines = await win.evaluate(() =>
    [...document.querySelectorAll('#log .line')].map((l) => l.textContent).reverse(),
  )
  const shot = path.join(FIX, `${name}.png`)
  await win.screenshot({ path: shot })
  await app.close()

  return { lines, shot }
}

const CASES = [
  ['fast-tap', { audioFile: SPEECH, holdMs: 0 }, /under 400ms/],
  ['silence', { audioFile: SILENCE, holdMs: 1500 }, /peak below floor/],
  ['speech', { audioFile: SPEECH, holdMs: 1500 }, /would SEND/],
]

let failed = 0
for (const [name, opts, expect] of CASES) {
  process.stdout.write(`\n=== ${name} ===\n`)
  try {
    const { lines, shot } = await run(name, opts)
    for (const l of lines) console.log('   ' + l)
    const ok = lines.some((l) => expect.test(l))
    console.log(`   -> ${ok ? 'PASS' : 'FAIL'}  (expected ${expect})`)
    console.log(`   screenshot: ${shot}`)
    if (!ok) failed++
  } catch (err) {
    console.log(`   ERROR ${err.message}`)
    failed++
  }
}

console.log(`\n${failed === 0 ? 'all cases passed' : `${failed} case(s) failed`}`)
process.exit(failed === 0 ? 0 : 1)
