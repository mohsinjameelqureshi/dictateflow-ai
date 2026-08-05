/**
 * Spike 3 renderer — 16kHz mono capture, raw PCM, WAV on disk.
 *
 * MediaRecorder is deliberately not used: it yields webm/opus, and we want
 * to prove we control sample rate and can measure amplitude for the silence
 * guard (§6.6). That needs raw Float32 frames.
 */

const TARGET_RATE = 16000

// AudioWorklet must be loaded from a URL. A Blob avoids a separate file and
// the file:// origin issues that come with it.
const WORKLET_SRC = `
class TapProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0][0]
    if (ch) this.port.postMessage(ch.slice(0))
    return true
  }
}
registerProcessor('tap', TapProcessor)
`

/** Int16 PCM mono WAV. */
function encodeWav(frames, sampleRate) {
  const total = frames.reduce((n, f) => n + f.length, 0)
  const buf = new ArrayBuffer(44 + total * 2)
  const view = new DataView(buf)

  const ascii = (off, s) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i))
  }

  ascii(0, 'RIFF')
  view.setUint32(4, 36 + total * 2, true)
  ascii(8, 'WAVE')
  ascii(12, 'fmt ')
  view.setUint32(16, 16, true) // PCM chunk size
  view.setUint16(20, 1, true) // format = PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true) // byte rate
  view.setUint16(32, 2, true) // block align
  view.setUint16(34, 16, true) // bits per sample
  ascii(36, 'data')
  view.setUint32(40, total * 2, true)

  let off = 44
  for (const f of frames) {
    for (let i = 0; i < f.length; i++) {
      const s = Math.max(-1, Math.min(1, f[i]))
      view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true)
      off += 2
    }
  }
  return new Uint8Array(buf)
}

class Recorder {
  #ctx = null
  #stream = null
  #node = null
  #source = null
  frames = []
  peak = 0
  startedAt = 0

  async start(deviceId) {
    this.frames = []
    this.peak = 0

    this.#stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        channelCount: 1,
        sampleRate: TARGET_RATE,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    })

    // Asking the AudioContext for 16kHz makes Chromium resample for us; the
    // mic's native rate does not have to match.
    this.#ctx = new AudioContext({ sampleRate: TARGET_RATE })

    const url = URL.createObjectURL(new Blob([WORKLET_SRC], { type: 'text/javascript' }))
    await this.#ctx.audioWorklet.addModule(url)
    URL.revokeObjectURL(url)

    this.#source = this.#ctx.createMediaStreamSource(this.#stream)
    this.#node = new AudioWorkletNode(this.#ctx, 'tap')
    this.#node.port.onmessage = (e) => {
      const f = e.data
      this.frames.push(f)
      for (let i = 0; i < f.length; i++) {
        const a = Math.abs(f[i])
        if (a > this.peak) this.peak = a
      }
      onLevel(this.peak, this.#currentLevel(f))
    }

    this.#source.connect(this.#node)
    // Worklet must reach a destination to be pulled. Gain 0 keeps it silent.
    const mute = this.#ctx.createGain()
    mute.gain.value = 0
    this.#node.connect(mute).connect(this.#ctx.destination)

    this.startedAt = performance.now()
    return { actualRate: this.#ctx.sampleRate }
  }

  #currentLevel(f) {
    let sum = 0
    for (let i = 0; i < f.length; i++) sum += f[i] * f[i]
    return Math.sqrt(sum / f.length)
  }

  async stop() {
    const durationMs = Math.round(performance.now() - this.startedAt)
    const rate = this.#ctx?.sampleRate ?? TARGET_RATE

    this.#node?.port.close()
    this.#source?.disconnect()
    this.#node?.disconnect()
    this.#stream?.getTracks().forEach((t) => t.stop())
    await this.#ctx?.close()
    this.#ctx = null

    const samples = this.frames.reduce((n, f) => n + f.length, 0)
    return {
      bytes: encodeWav(this.frames, rate),
      meta: {
        sampleRate: rate,
        channels: 1,
        durationMs,
        samples,
        peak: this.peak,
      },
    }
  }
}

/* ---------------------------------------------------------------- UI ---- */

const $ = (id) => document.getElementById(id)
const rec = new Recorder()
let recording = false

function log(msg, cls = '') {
  const line = document.createElement('div')
  line.className = `line ${cls}`
  line.textContent = msg
  $('log').prepend(line)
}

function onLevel(peak, rms) {
  $('meter').style.setProperty('--level', Math.min(1, rms * 4))
  $('peak').textContent = peak.toFixed(4)
}

async function listMics() {
  const devices = await navigator.mediaDevices.enumerateDevices()
  const mics = devices.filter((d) => d.kind === 'audioinput')
  const sel = $('mic')
  sel.innerHTML = ''
  for (const m of mics) {
    const o = document.createElement('option')
    o.value = m.deviceId
    o.textContent = m.label || `(unlabelled ${m.deviceId.slice(0, 8)})`
    sel.append(o)
  }
  log(`${mics.length} input device(s) found`)
}

async function toggle() {
  if (!recording) {
    try {
      const { actualRate } = await rec.start($('mic').value)
      recording = true
      $('btn').textContent = 'Stop'
      $('btn').classList.add('rec')
      log(`recording… context rate ${actualRate}Hz`, actualRate === TARGET_RATE ? 'ok' : 'warn')
      if (actualRate !== TARGET_RATE) {
        log(`asked for ${TARGET_RATE}Hz, got ${actualRate}Hz — resample needed`, 'warn')
      }
      if (!$('mic').selectedOptions[0]?.textContent.startsWith('(unlabelled')) {
        // labels only populate after permission is granted
      } else {
        listMics()
      }
    } catch (err) {
      log(`getUserMedia failed: ${err.name} — ${err.message}`, 'err')
    }
    return
  }

  recording = false
  $('btn').textContent = 'Record'
  $('btn').classList.remove('rec')

  const { bytes, meta } = await rec.stop()

  // §6.6 — the guards that stop Whisper hallucinating on silence.
  const tooShort = meta.durationMs < 400
  const tooQuiet = meta.peak < 0.01

  const { file, size } = await window.spike.saveWav(bytes, meta)

  log(
    `${meta.durationMs}ms · ${meta.samples} samples · ${meta.sampleRate}Hz · ` +
      `${(size / 1024).toFixed(1)} KB · peak ${meta.peak.toFixed(4)}`,
    'ok',
  )
  const expected = Math.round((meta.samples / meta.sampleRate) * 1000)
  log(`sample-count duration ${expected}ms (drift ${meta.durationMs - expected}ms)`)
  if (tooShort) log('would REJECT: under 400ms', 'warn')
  if (tooQuiet) log('would REJECT: peak below floor — silence', 'warn')
  if (!tooShort && !tooQuiet) log('would SEND to Groq', 'ok')
  log(file)
}

$('btn').addEventListener('click', toggle)
$('open').addEventListener('click', () => window.spike.reveal())
listMics()
navigator.mediaDevices.addEventListener('devicechange', listMics)
