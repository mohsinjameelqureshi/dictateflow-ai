import type { ClipPayload } from '@shared/types.js'

/**
 * 16kHz mono capture, raw PCM, WAV out. Promoted from spike 3 with the
 * findings in spikes/README.md folded in.
 *
 * `MediaRecorder` is deliberately not used: it yields webm/opus and hides the
 * sample rate, and the §6.6 silence guard needs raw Float32 amplitude.
 */

const TARGET_RATE = 16000

/** Loaded from a Blob URL so there is no separate asset to resolve under file://. */
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
function encodeWav(frames: Float32Array[], sampleRate: number): Uint8Array {
  const total = frames.reduce((n, f) => n + f.length, 0)
  const buf = new ArrayBuffer(44 + total * 2)
  const view = new DataView(buf)

  const ascii = (off: number, s: string) => {
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
      const s = Math.max(-1, Math.min(1, f[i] ?? 0))
      view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true)
      off += 2
    }
  }
  return new Uint8Array(buf)
}

export class Recorder {
  #ctx: AudioContext | null = null
  #workletReady: Promise<void> | null = null
  #stream: MediaStream | null = null
  #node: AudioWorkletNode | null = null
  #source: MediaStreamAudioSourceNode | null = null
  #frames: Float32Array[] = []
  #peak = 0
  #startedAt = 0
  #recording = false

  constructor(private onLevel: (rms: number) => void) {}

  /**
   * Build the AudioContext and compile the worklet without touching the
   * microphone. spikes/README.md measured 38–74ms of audio lost to graph
   * startup; this moves the compile off the critical path while still
   * leaving the mic indicator dark until the user actually presses the key.
   */
  async warm(): Promise<void> {
    if (this.#workletReady) return this.#workletReady

    this.#ctx = new AudioContext({ sampleRate: TARGET_RATE })
    // Autoplay policy suspends a fresh context; it resumes on start().
    const url = URL.createObjectURL(new Blob([WORKLET_SRC], { type: 'text/javascript' }))
    this.#workletReady = this.#ctx.audioWorklet.addModule(url).finally(() => {
      URL.revokeObjectURL(url)
    })
    return this.#workletReady
  }

  async start(deviceId: string): Promise<void> {
    this.#frames = []
    this.#peak = 0

    await this.warm()
    const ctx = this.#ctx
    if (!ctx) throw new Error('AudioContext unavailable')
    if (ctx.state === 'suspended') await ctx.resume()

    this.#stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
        channelCount: 1,
        sampleRate: TARGET_RATE,
        echoCancellation: true,
        // Gates the noise floor BEFORE AGC can lift it. This is what keeps
        // the 0.01 peak guard working — see spikes/README.md.
        noiseSuppression: true,
        autoGainControl: true,
      },
    })

    this.#source = ctx.createMediaStreamSource(this.#stream)
    this.#node = new AudioWorkletNode(ctx, 'tap')
    this.#node.port.onmessage = (e: MessageEvent<Float32Array>) => {
      const f = e.data
      this.#frames.push(f)

      let sum = 0
      for (let i = 0; i < f.length; i++) {
        const v = f[i] ?? 0
        const a = Math.abs(v)
        if (a > this.#peak) this.#peak = a
        sum += v * v
      }
      this.onLevel(Math.sqrt(sum / f.length))
    }

    this.#source.connect(this.#node)
    // A worklet is only pulled if it reaches a destination. Gain 0 keeps it
    // silent — without this the user hears themselves.
    const mute = ctx.createGain()
    mute.gain.value = 0
    this.#node.connect(mute).connect(ctx.destination)

    this.#startedAt = performance.now()
    this.#recording = true
  }

  /** Tear down the graph and release the mic, keeping the context warm. */
  #teardown(): number {
    // A stop can arrive before start() ever resolved — a mic error, or a tap
    // so short the graph never came up. Report 0 rather than the time since
    // the epoch, which would sail past the §6.6 duration guard.
    const durationMs = this.#recording ? Math.round(performance.now() - this.#startedAt) : 0
    this.#recording = false

    if (this.#node) this.#node.port.onmessage = null
    this.#source?.disconnect()
    this.#node?.disconnect()
    this.#stream?.getTracks().forEach((t) => t.stop())

    this.#source = null
    this.#node = null
    this.#stream = null

    return durationMs
  }

  stop(): ClipPayload {
    const durationMs = this.#teardown()
    const sampleRate = this.#ctx?.sampleRate ?? TARGET_RATE
    const samples = this.#frames.reduce((n, f) => n + f.length, 0)
    const bytes = encodeWav(this.#frames, sampleRate)
    this.#frames = []

    return {
      bytes,
      meta: { sampleRate, durationMs, samples, peak: this.#peak },
    }
  }

  /** Esc — drop the buffer without encoding it. */
  cancel(): void {
    this.#teardown()
    this.#frames = []
    this.#peak = 0
  }
}
