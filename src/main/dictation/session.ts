import { desc, eq, sql } from 'drizzle-orm'
import { getDb, schema } from '../../db/client.js'
import { createDictation } from '../../db/dictations.js'
import { IPC_EVENT } from '../../shared/ipc-channels.js'
import {
  MIN_CLIP_MS,
  MIN_CLIP_PEAK,
  type ClipPayload,
  type WidgetState,
} from '../../shared/types.js'
import { getSpeechProvider } from '../../services/speech/index.js'
import { SpeechError } from '../../services/speech/types.js'
import {
  applyDictionary,
  buildVocabularyHint,
  stripVocabularyHint,
  type DictionaryRule,
} from '../../services/enhance/dictionary.js'
import { writeRecording, type WrittenRecording } from '../audio/store.js'
import { broadcastDictationsChanged } from '../broadcast.js'
import { insertText, pressEnter } from '../insert/clipboard.js'
import { parsePressEnter } from '../insert/commands.js'
import { captureTarget, type InsertTarget } from '../insert/target.js'
import { getApiKey } from '../secrets.js'
import { readSettings } from '../settings.js'
import { hideWidget, sendToWidget, showWidget } from '../windows/widget-window.js'

/**
 * The capture loop (§13 Phase 2). Key-down to inserted text.
 *
 * One session at a time. Every exit path — success, guard rejection, network
 * failure, cancellation — must land the widget on a terminal state and then
 * hide it, or the user is left with a floating spinner that never resolves.
 */

type Phase = 'idle' | 'recording' | 'awaiting-clip' | 'working'

/** §11 — Success auto-dismisses at ~800ms. Errors linger longer to be read. */
const DISMISS_MS: Record<string, number> = {
  success: 800,
  cancelled: 400,
  'no-speech': 1600,
  offline: 2400,
  'rate-limited': 2400,
  blocked: 3200,
  error: 3200,
}

class DictationSession {
  #phase: Phase = 'idle'
  #target: InsertTarget | null = null
  #abort: AbortController | null = null
  #dismissTimer: NodeJS.Timeout | null = null
  #clip: ((payload: ClipPayload | null) => void) | null = null
  /** Bumped on every begin and cancel, so late async work can tell it is stale. */
  #gen = 0
  #beginning: Promise<void> = Promise.resolve()

  get busy(): boolean {
    return this.#phase !== 'idle'
  }

  /* -------------------------------------------------------- key down ---- */

  async begin(): Promise<void> {
    if (this.busy) return
    this.#phase = 'recording'
    this.#gen += 1
    this.#clearDismiss()

    this.#beginning = this.#openMic(this.#gen)
    await this.#beginning
  }

  async #openMic(gen: number): Promise<void> {
    const deviceId = readSettings().microphoneId ?? ''

    // §11 — Listening appears immediately, before the mic is ready. The widget
    // is the feedback that the key registered. Start capture in parallel with
    // target resolution — external mics can take hundreds of ms on
    // getUserMedia, and that delay must not eat the first syllable.
    this.#state('listening')
    showWidget()
    sendToWidget(IPC_EVENT.widgetCommand, { type: 'start', deviceId })

    // §6.2 — the widget is focusable:false, so showing it does not steal the
    // insert target. Capture in parallel rather than blocking on it first.
    const target = await captureTarget()
    if (gen !== this.#gen) return
    this.#target = target
  }

  /* ---------------------------------------------------------- key up ---- */

  async finish(): Promise<void> {
    if (this.#phase !== 'recording') return

    // A quick tap can release before `start` was ever sent. Without this the
    // widget receives `stop` first and returns an empty clip while its
    // recorder is still spinning up.
    await this.#beginning

    if (this.#phase !== 'recording') return
    this.#phase = 'awaiting-clip'
    this.#state('processing')

    const clip = await this.#requestClip()
    if (this.#phase !== 'awaiting-clip') return // cancelled while waiting
    if (!clip) {
      this.#settle('error', 'Microphone failed.')
      return
    }

    this.#phase = 'working'
    await this.#process(clip)
  }

  /* ------------------------------------------------------------- esc ---- */

  cancel(): void {
    if (!this.busy) return

    // Invalidates any in-flight #openMic, so a cancelled tap cannot start
    // recording after the fact.
    this.#gen += 1

    this.#abort?.abort()
    this.#abort = null
    sendToWidget(IPC_EVENT.widgetCommand, { type: 'cancel' })
    this.#clip?.(null)
    this.#clip = null

    // §11 — Cancelled fades out and inserts nothing. It is not an error.
    this.#settle('cancelled')
  }

  /** Called by the IPC handler when the widget returns its buffer. */
  receiveClip(payload: ClipPayload): void {
    this.#clip?.(payload)
    this.#clip = null
  }

  /** Called when getUserMedia rejects — no device, or permission denied. */
  micError(message: string): void {
    this.#clip?.(null)
    this.#clip = null
    if (this.busy) this.#settle('error', message)
  }

  /* ----------------------------------------------------------- inner ---- */

  #requestClip(): Promise<ClipPayload | null> {
    return new Promise((resolve) => {
      this.#clip = resolve
      sendToWidget(IPC_EVENT.widgetCommand, { type: 'stop' })

      // The widget renderer could be gone or wedged. Never hang forever.
      setTimeout(() => {
        if (this.#clip === resolve) {
          this.#clip = null
          resolve(null)
        }
      }, 5000)
    })
  }

  async #process(clip: ClipPayload): Promise<void> {
    const { meta } = clip

    // §6.6 — Whisper hallucinates on silence. An accidental shortcut tap with
    // no speech produces phantom text like "Thank you", so both guards run
    // before anything is uploaded.
    if (meta.durationMs < MIN_CLIP_MS || meta.peak < MIN_CLIP_PEAK) {
      this.#settle('no-speech')
      return
    }

    const settings = readSettings()
    const rules = readDictionary()

    this.#abort = new AbortController()

    let rawText: string
    let providerId: string
    try {
      const provider = getSpeechProvider(settings.speechProvider ?? 'groq', getApiKey())
      const hint = buildVocabularyHint(rules)
      const result = await provider.transcribe(Buffer.from(clip.bytes), {
        language: settings.language ?? 'en',
        ...(hint ? { vocabularyHint: hint } : {}),
        signal: this.#abort.signal,
      })
      // §6.5 — the hint can come back inside the transcript. Cut it before
      // anything else sees the text, including `rawText`: the leak is our
      // sentence echoed back, not something the user said, so storing it as
      // the "source of truth" would pollute their history and their search.
      const cleaned = stripVocabularyHint(result.text, hint)
      if (cleaned.stripped > 0) {
        console.warn(`[speech] vocabulary hint leaked into the transcript (${cleaned.stripped} words); removed`)
      }

      rawText = cleaned.text
      providerId = result.providerId
    } catch (err) {
      this.#failed(err)
      return
    } finally {
      this.#abort = null
    }

    if (this.#phase !== 'working') return // cancelled during the round trip

    if (!rawText.trim()) {
      this.#settle('no-speech')
      return
    }

    // §9 — dictionary runs after transcription (and would run after the LLM
    // step, if the LLM step were enabled; §4 keeps it off by default).
    const replaced = applyDictionary(rawText, rules)
    bumpHitCounts(replaced.hitIds)

    // Last transform before the text leaves, and deliberately so: the command
    // has to be matched against the words that are actually about to be typed,
    // after the dictionary has had its say. Off unless the user turned it on
    // in Experimental.
    //
    // `command.text` is what gets inserted and stored as finalText, so a fired
    // command is visible as the difference between raw and final in history —
    // rawText still has "press enter" in it, because it was said.
    const command = parsePressEnter(replaced.text, settings.pressEnterCommand === 'true')

    // §8 — the file is written HERE, past every guard that can still decide no
    // row gets created. Everything below this line persists on all three of its
    // exits, so there is no path where a clip is kept for a session that
    // produced nothing: cancelled, too short and too quiet all returned above.
    //
    // File before row (§6.8). A stray file is swept on the next start; a row
    // pointing at nothing is a Play button that is permanently broken.
    const recording = keepRecording(settings, clip)

    // §6.4 — a non-elevated process cannot send input to an elevated window.
    // Detect it and say so, rather than appearing to succeed.
    const blocked = this.#target ? await this.#target.elevated : false
    if (this.#phase !== 'working') return // cancelled while the probe finished
    if (blocked) {
      persist(rawText, command.text, meta.durationMs, providerId, replaced.fixes, recording)
      this.#settle('blocked')
      return
    }

    this.#state('inserting')
    try {
      // Empty when the whole utterance was the command — insertText returns
      // early on that, so nothing is pasted and only the key is sent.
      await insertText(command.text, Number(settings.typingDelayMs))
      if (command.pressEnter) await pressEnter()
    } catch (err) {
      persist(rawText, command.text, meta.durationMs, providerId, replaced.fixes, recording)
      this.#settle('error', err instanceof Error ? err.message : 'Could not insert the text.')
      return
    }

    persist(rawText, command.text, meta.durationMs, providerId, replaced.fixes, recording)
    this.#settle('success')
  }

  #failed(err: unknown): void {
    if (!(err instanceof SpeechError)) {
      this.#settle('error', err instanceof Error ? err.message : 'Transcription failed.')
      return
    }

    switch (err.kind) {
      case 'cancelled':
        this.#settle('cancelled')
        return
      case 'offline':
        this.#settle('offline')
        return
      case 'rate-limited':
        this.#settle('rate-limited')
        return
      case 'no-key':
        this.#settle('error', 'Add your Groq API key in Settings.')
        return
      case 'unauthorized':
        this.#settle('error', 'Groq rejected the API key.')
        return
      default:
        this.#settle('error', err.message)
    }
  }

  #state(state: WidgetState, message?: string): void {
    sendToWidget(IPC_EVENT.widgetState, message === undefined ? { state } : { state, message })
  }

  /** Terminal state: show it, then hide the widget and return to idle. */
  #settle(state: WidgetState, message?: string): void {
    this.#state(state, message)
    this.#phase = 'idle'
    this.#target = null

    this.#clearDismiss()
    this.#dismissTimer = setTimeout(() => {
      this.#dismissTimer = null
      hideWidget()
    }, DISMISS_MS[state] ?? 1600)
  }

  #clearDismiss(): void {
    if (this.#dismissTimer) clearTimeout(this.#dismissTimer)
    this.#dismissTimer = null
  }
}

/* ------------------------------------------------------------ helpers ---- */

function readDictionary(): DictionaryRule[] {
  return getDb()
    .select({ id: schema.dictionary.id, from: schema.dictionary.from, to: schema.dictionary.to })
    .from(schema.dictionary)
    .orderBy(desc(schema.dictionary.hitCount))
    .all()
}

function bumpHitCounts(ids: number[]): void {
  if (ids.length === 0) return
  getDb().transaction((tx) => {
    for (const id of ids) {
      // Incremented in SQL rather than read-modify-write, so the count cannot
      // be lost to a concurrent dictation.
      tx.update(schema.dictionary)
        .set({ hitCount: sql`${schema.dictionary.hitCount} + 1` })
        .where(eq(schema.dictionary.id, id))
        .run()
    }
  })
}

/**
 * Write the clip to disk, or null if recordings are off or the write failed.
 *
 * §8 — the EXACT bytes that were sent to the provider, never re-encoded. The
 * reason to keep a recording is to hear what actually happened when a
 * transcript is wrong, and a re-encode destroys that evidence.
 *
 * A failure here is not a dictation failure. The user has their text; a full
 * disk should not turn that into an error state.
 */
function keepRecording(
  settings: ReturnType<typeof readSettings>,
  clip: ClipPayload,
): WrittenRecording | null {
  if (settings.keepRecordings !== 'true') return null
  try {
    // Passed straight through, not copied into a new view: these are the exact
    // bytes handed to the provider, and §8 wants that identity preserved.
    return writeRecording(clip.bytes)
  } catch (err) {
    console.warn('[audio] could not write the recording:', err)
    return null
  }
}

function persist(
  rawText: string,
  finalText: string,
  durationMs: number,
  providerId: string,
  dictionaryFixes: number,
  recording: WrittenRecording | null,
): void {
  try {
    createDictation({
      rawText,
      finalText,
      durationMs,
      providerId,
      // §4 — enhancement is off in v1, so grammarFixes is 0 by definition.
      enhanced: false,
      grammarFixes: 0,
      dictionaryFixes,
      audioFile: recording?.file ?? null,
      audioBytes: recording?.bytes ?? null,
      audioMime: recording?.mime ?? null,
    })
    broadcastDictationsChanged()
  } catch {
    // A failed write must not swallow text the user already has inserted.
    // The orphaned file this leaves behind is collected by the startup sweep.
  }
}

export const session = new DictationSession()
