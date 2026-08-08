/**
 * The drive.mjs run showed a 0.366-amplitude tone arriving at peak 1.0002.
 * That is ~2.7x gain the app did not ask for — autoGainControl.
 *
 * It matters: §6.6's silence guard is a peak floor. If AGC amplifies a quiet
 * room toward full scale, the floor never trips and Whisper hallucinates.
 *
 * This measures the same fixture with AGC on vs off.
 */
import { _electron as electron } from 'playwright'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FIX = path.join(os.tmpdir(), 'typeflow-spike-fixtures')

const measure = async (file, agc) => {
  const app = await electron.launch({
    args: [
      '03-audio/main.cjs',
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      `--use-file-for-fake-audio-capture=${file}%noloop`,
    ],
    cwd: HERE,
  })
  const win = await app.firstWindow()
  await win.waitForSelector('#btn')

  const peak = await win.evaluate(async (agcOn) => {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        sampleRate: 16000,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: agcOn,
      },
    })
    const ctx = new AudioContext({ sampleRate: 16000 })
    const src = ctx.createMediaStreamSource(stream)
    const an = ctx.createAnalyser()
    an.fftSize = 2048
    src.connect(an)
    const buf = new Float32Array(an.fftSize)
    let peak = 0
    const t0 = performance.now()
    while (performance.now() - t0 < 1200) {
      an.getFloatTimeDomainData(buf)
      for (let i = 0; i < buf.length; i++) peak = Math.max(peak, Math.abs(buf[i]))
      await new Promise((r) => setTimeout(r, 20))
    }
    stream.getTracks().forEach((t) => t.stop())
    await ctx.close()
    return peak
  }, agc)

  await app.close()
  return peak
}

const tone = path.join(FIX, 'tone.wav')
const silence = path.join(FIX, 'silence.wav')

console.log('source tone amplitude in the fixture: 12000/32767 = 0.3663\n')
for (const [label, file] of [['tone', tone], ['silence', silence]]) {
  for (const agc of [true, false]) {
    const p = await measure(file, agc)
    console.log(`  ${label.padEnd(8)} agc=${String(agc).padEnd(5)} peak ${p.toFixed(4)}`)
  }
}
process.exit(0)
