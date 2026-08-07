import { BrowserWindow } from 'electron'
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
  type DictionaryRule,
} from '../../services/enhance/dictionary.js'
import { insertText } from '../insert/clipboard.js'
import { captureTarget, type InsertTarget } from '../insert/target.js'
import { getApiKey } from '../secrets.js'
import { readSettings } from '../settings.js'
import { getWidgetWindow, hideWidget, sendToWidget, showWidget } from '../windows/widget-window.js'

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
    // §6.2 — capture the target BEFORE the widget is shown. Once it is up,
    // "what had focus" is no longer answerable. This costs a few milliseconds,
    // unlike waiting on getUserMedia, which is what §11 actually forbids.
    const target = await captureTarget()

    // A very short tap can cancel before this resolves; do not resurrect it.
    if (gen !== this.#gen) return
    this.#target = target

    // §11 — Listening appears immediately, before the mic is ready. The widget
    // is the feedback that the key registered.
    this.#state('listening')
    showWidget()

    sendToWidget(IPC_EVENT.widgetCommand, {
      type: 'start',
      deviceId: readSettings().microphoneId ?? '',
    })
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
      rawText = result.text
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

    // §6.4 — a non-elevated process cannot send input to an elevated window.
    // Detect it and say so, rather than appearing to succeed.
    const blocked = this.#target ? await this.#target.elevated : false
    if (this.#phase !== 'working') return // cancelled while the probe finished
    if (blocked) {
      persist(rawText, replaced.text, meta.durationMs, providerId, replaced.fixes)
      this.#settle('blocked')
      return
    }

    this.#state('inserting')
    try {
      await insertText(replaced.text)
    } catch (err) {
      persist(rawText, replaced.text, meta.durationMs, providerId, replaced.fixes)
      this.#settle('error', err instanceof Error ? err.message : 'Could not insert the text.')
      return
    }

    persist(rawText, replaced.text, meta.durationMs, providerId, replaced.fixes)
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

function persist(
  rawText: string,
  finalText: string,
  durationMs: number,
  providerId: string,
  dictionaryFixes: number,
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
    })
    const widget = getWidgetWindow()
    for (const win of BrowserWindow.getAllWindows()) {
      if (win !== widget) win.webContents.send(IPC_EVENT.dictationsChanged)
    }
  } catch {
    // A failed write must not swallow text the user already has inserted.
  }
}

export const session = new DictationSession()
