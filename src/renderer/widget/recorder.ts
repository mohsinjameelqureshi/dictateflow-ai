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

const CONSTRAINTS: MediaTrackConstraints = {
  channelCount: 1,
  sampleRate: TARGET_RATE,
  echoCancellation: true,
  // Gates the noise floor BEFORE AGC can lift it. This is what keeps the 0.01
  // peak guard working — see spikes/README.md.
  noiseSuppression: true,
  autoGainControl: true,
}

/**
 * A second stream, for the level meter only. Identical but for AGC.
 *
 * AGC is what makes the widget's waveform look fake. Measured against a
 * stepped-amplitude fixture: over a 7.5x sweep of input amplitude across the
 * normal speaking range, the AGC'd stream's RMS moves 1.28x — that is the
 * whole point of AGC, and it is right for the clip we send to Groq. It is
 * useless to meter.
 *
 *     input amplitude   0.12    0.25    0.5     0.9
 *     capture (AGC on)  0.3331  0.2885  0.3686  0.3560   <- 1.28x, flat
 *     meter   (AGC off) 0.0278  0.0574  0.1193  0.2068   <- 7.45x, true
 *
 * Cloning the capture track and relaxing the constraint does NOT work:
 * `applyConstraints` resolves, `getSettings()` still reports
 * autoGainControl:true, and the samples are identical. The clone shares the
 * source's processing. A separate getUserMedia is the only thing that gives
 * an un-normalised signal.
 *
 * Noise suppression stays ON. Without it a quiet room reads about -47dB and
 * the bars idle visibly high; with it the same room gates to about -59dB and
 * sits flat, which is what "we are hearing nothing" should look like.
 */
const METER_CONSTRAINTS: MediaTrackConstraints = {
  ...CONSTRAINTS,
  autoGainControl: false,
  // Echo cancellation converges over the first seconds of a stream and
  // attenuates while it does. Measured: with it on, the first burst of speech
  // after opening read 12px where an identical later burst read 27px — the
  // bars would under-report the start of every dictation, which is exactly
  // when the user is looking at them. Nothing is being transmitted here, so
  // there is no echo to cancel.
  echoCancellation: false,
}

/**
 * dB window the bars span. Speech through the meter stream lands around
 * -35dB (quiet) to -14dB (loud); the floor sits below a suppressed room so
 * silence reads as silence rather than as a low hum.
 */
const FLOOR_DB = -60
const CEIL_DB = -12

/**
 * Fast attack, slow release — a meter that falls as fast as it rises reads as
 * noise rather than as speech.
 *
 * Time constants, not per-frame fractions. The loop runs on rAF at 60Hz, but
 * the fallback path is driven by the worklet at ~125Hz, and a background or
 * occluded window is throttled further. A per-frame constant would make the
 * meter decay at a different speed in each of those cases.
 */
const ATTACK_MS = 25
const RELEASE_MS = 160

/**
 * `exact` is deliberate — a chosen microphone should be used or nothing — but
 * a device that has been unplugged since it was picked would then fail every
 * dictation until the user opened Settings. Fall back to the system default
 * instead, which is what the picker already tells them will happen.
 */
async function openStream(
  deviceId: string,
  constraints: MediaTrackConstraints = CONSTRAINTS,
): Promise<MediaStream> {
  if (!deviceId) return navigator.mediaDevices.getUserMedia({ audio: constraints })

  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: { ...constraints, deviceId: { exact: deviceId } },
    })
  } catch (err) {
    const name = err instanceof Error ? err.name : ''
    // Only "that device is gone" retries. NotAllowedError is a permission
    // problem and must surface, not be papered over with a different mic.
    if (name !== 'OverconstrainedError' && name !== 'NotFoundError') throw err
    return navigator.mediaDevices.getUserMedia({ audio: constraints })
  }
}

export class Recorder {
  #ctx: AudioContext | null = null
  #workletReady: Promise<void> | null = null
  #stream: MediaStream | null = null
  /** Bumped on cancel so a late start() cannot begin recording. */
  #startGen = 0
  #node: AudioWorkletNode | null = null
  #source: MediaStreamAudioSourceNode | null = null
  #frames: Float32Array[] = []
  #peak = 0
  #startedAt = 0
  #recording = false

  /* Metering. Separate stream, separate graph — see METER_CONSTRAINTS. */
  #meterStream: MediaStream | null = null
  #meterSource: MediaStreamAudioSourceNode | null = null
  #analyser: AnalyserNode | null = null
  #meterBuf = new Float32Array(256)
  #raf = 0
  #level = 0
  /** performance.now() of the last smoothing step, for the dt-based filter. */
  #lastObserved = 0
  /** Set when the meter stream could not be opened; the bars fall back to capture. */
  #meterFallback = false

  /**
   * Smoothed display level, 0..1. Read on a frame loop by the waveform rather
   * than pushed through React state: the worklet fires every 128 samples
   * (~8ms), and a setState per audio frame re-rendered the whole widget about
   * 125 times a second to drive 18 divs.
   */
  get level(): number {
    return this.#level
  }

  /** Device enumeration reads this before opening a probe stream. */
  get recording(): boolean {
    return this.#recording
  }

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
    this.#workletReady = this.#ctx.audioWorklet
      .addModule(url)
      .catch((err: unknown) => {
        // Never cache the rejection: start() awaits this same promise, so a
        // one-off failure would otherwise be permanent for the widget's life.
        this.#workletReady = null
        throw err
      })
      .finally(() => {
        URL.revokeObjectURL(url)
      })
    return this.#workletReady
  }

  async start(deviceId: string): Promise<void> {
    const gen = ++this.#startGen
    this.#frames = []
    this.#peak = 0

    await this.warm()
    const ctx = this.#ctx
    if (!ctx) throw new Error('AudioContext unavailable')
    if (ctx.state === 'suspended') await ctx.resume()

    // Opened per dictation. §11 already covers the cost: the widget appears on
    // key-down, before the mic is ready, so the user has feedback while an
    // external device takes its 200–500ms to come up.
    const stream = await openStream(deviceId)

    if (gen !== this.#startGen) {
      stream.getTracks().forEach((t) => t.stop())
      return
    }

    this.#stream = stream

    this.#source = ctx.createMediaStreamSource(this.#stream)
    this.#node = new AudioWorkletNode(ctx, 'tap')
    this.#node.port.onmessage = (e: MessageEvent<Float32Array>) => {
      const f = e.data
      this.#frames.push(f)

      // Peak only. This is the §6.6 silence guard's input and must keep
      // reading the stream that is actually sent to the provider — the meter
      // is a different stream and would be the wrong thing to guard on.
      let sum = 0
      for (let i = 0; i < f.length; i++) {
        const v = f[i] ?? 0
        const a = Math.abs(v)
        if (a > this.#peak) this.#peak = a
        sum += v * v
      }
      // Only used when the meter stream could not be opened.
      if (this.#meterFallback) this.#observe(Math.sqrt(sum / f.length))
    }

    this.#source.connect(this.#node)
    // A worklet is only pulled if it reaches a destination. Gain 0 keeps it
    // silent — without this the user hears themselves.
    const mute = ctx.createGain()
    mute.gain.value = 0
    this.#node.connect(mute).connect(ctx.destination)

    this.#startedAt = performance.now()
    this.#recording = true

    // Deliberately not awaited: capture is live and the §3 budget is already
    // paying 38-74ms for graph startup. The bars are flat for one extra frame
    // rather than the recording starting later.
    void this.#startMeter(deviceId)
  }

  /**
   * Open the metering stream and run the level loop.
   *
   * Every failure here is silent by design — no microphone permission prompt
   * differs from the capture stream's, and a meter that cannot open is a flat
   * waveform, not a failed dictation.
   */
  async #startMeter(deviceId: string): Promise<void> {
    const ctx = this.#ctx
    if (!ctx || !this.#recording) return

    try {
      this.#meterStream = await openStream(deviceId, METER_CONSTRAINTS)
    } catch {
      // The bars fall back to the AGC'd capture stream: compressed, but alive.
      this.#meterFallback = true
      this.#loop()
      return
    }

    // stop() can land while getUserMedia was in flight.
    if (!this.#recording) {
      this.#meterStream.getTracks().forEach((t) => t.stop())
      this.#meterStream = null
      return
    }

    this.#analyser = ctx.createAnalyser()
    this.#analyser.fftSize = 512
    this.#meterBuf = new Float32Array(this.#analyser.fftSize)
    this.#meterSource = ctx.createMediaStreamSource(this.#meterStream)
    // Not connected onward: an AnalyserNode is pulled by its source, and
    // routing it to the destination would play the room back at the user.
    this.#meterSource.connect(this.#analyser)

    this.#loop()
  }

  /** One smoothing step. dB rather than raw RMS — loudness is logarithmic. */
  #observe(rms: number): void {
    const now = performance.now()
    // First sample of a recording has no previous frame to measure against.
    const dt = this.#lastObserved ? Math.min(now - this.#lastObserved, 250) : 16
    this.#lastObserved = now

    const db = 20 * Math.log10(Math.max(rms, 1e-7))
    const target = Math.min(1, Math.max(0, (db - FLOOR_DB) / (CEIL_DB - FLOOR_DB)))

    const tau = target > this.#level ? ATTACK_MS : RELEASE_MS
    this.#level += (target - this.#level) * (1 - Math.exp(-dt / tau))
  }

  #loop = (): void => {
    if (!this.#recording) return

    // In fallback the worklet drives #observe and there is no analyser here.
    if (this.#analyser) {
      this.#analyser.getFloatTimeDomainData(this.#meterBuf)
      let sum = 0
      for (let i = 0; i < this.#meterBuf.length; i++) {
        const v = this.#meterBuf[i] ?? 0
        sum += v * v
      }
      this.#observe(Math.sqrt(sum / this.#meterBuf.length))
    }

    this.#raf = requestAnimationFrame(this.#loop)
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

    // Released, never held. Keeping a chosen device open between dictations
    // saved a few hundred ms on the next start, but the OS cannot tell an idle
    // open stream from a live one: Windows lights the recording indicator and
    // the microphone's own LED comes on and stays on. For a dictation app that
    // reads as always listening, which is the one impression it cannot afford
    // to give — and it is the same reasoning already applied to the meter
    // stream below.
    this.#stream?.getTracks().forEach((t) => t.stop())

    this.#source = null
    this.#node = null
    this.#stream = null

    // The meter holds a SECOND microphone track. Leaving it open would keep
    // the OS recording indicator lit after the widget had said "Inserted",
    // which reads as the app still listening.
    if (this.#raf) cancelAnimationFrame(this.#raf)
    this.#raf = 0
    this.#meterSource?.disconnect()
    this.#analyser?.disconnect()
    this.#meterStream?.getTracks().forEach((t) => t.stop())

    this.#meterSource = null
    this.#analyser = null
    this.#meterStream = null
    this.#meterFallback = false
    this.#level = 0
    this.#lastObserved = 0

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
    this.#startGen += 1
    this.#teardown()
    this.#frames = []
    this.#peak = 0
  }
}
