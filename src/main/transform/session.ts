import { clipboard } from 'electron'
import { randomUUID } from 'node:crypto'
import { bumpTransform, getTransform } from '../../db/transforms.js'
import { IPC_EVENT } from '../../shared/ipc-channels.js'
import {
  TRANSFORM_PROVIDERS,
  isTransformProvider,
  type TransformProviderId,
  type WidgetState,
} from '../../shared/types.js'
import {
  TransformError,
  getTransformProvider,
  transformReadiness,
} from '../../services/transform/index.js'
import { broadcastTransformsChanged } from '../broadcast.js'
import {
  clampRestoreDelay,
  pasteText,
  restoreClipboard,
  sendCopy,
  sendCut,
  sendSelectAll,
  settle,
  snapshotClipboard,
  type ClipboardSnapshot,
} from '../insert/clipboard.js'
import { captureTarget } from '../insert/target.js'
import { getSecret } from '../secrets.js'
import { readSettings } from '../settings.js'
import { hideWidget, sendToWidget, showWidget } from '../windows/widget-window.js'

/**
 * The transform loop (docs/transform-feature-plan.md §7).
 *
 * A sibling of `dictation/session.ts`, not an extension of it. They share the
 * widget, the clipboard helpers and the target probe; they share no state.
 *
 * Neither may run while the other is, and that check lives in
 * `shortcut/index.ts` rather than in either session. It is the only module that
 * already imports both — putting it here would make the two sessions import
 * each other, and a cycle between two module-level singletons is a boot-order
 * bug waiting for someone to move an import.
 *
 * The single property that governs every branch below: **the user's text must
 * be recoverable on every failure path.** Once the field has been cut, the only
 * copy of what the user wrote lives in a local variable in this process. Every
 * `return` past that point either pastes it back or leaves it on screen.
 */

type Phase = 'idle' | 'arming' | 'reading' | 'working' | 'inserting'

/** How the text was taken, which decides how it is put back on failure. */
type Grab = 'selection' | 'field'

/** §11 — success auto-dismisses quickly. Errors linger long enough to read. */
const DISMISS_MS: Record<string, number> = {
  transformed: 800,
  cancelled: 400,
  'no-text': 1600,
  offline: 2400,
  'rate-limited': 2400,
  blocked: 3200,
  error: 3600,
}

/**
 * How often to re-read the clipboard while waiting for the target to fill it.
 *
 * MEASURED failure: this used to be a single fixed 120ms wait, and it was not
 * enough. Text visibly vanished from the field — the app had clearly processed
 * Ctrl+X — and the transform still reported "Nothing to transform", because the
 * target had not finished putting the data on the clipboard yet. In a browser
 * that write crosses renderer, browser process and OS before it lands.
 *
 * A fixed delay is wrong in both directions: too short and it misses, too long
 * and every transform pays for the worst case. Polling costs neither — it
 * returns the moment the data arrives, so the deadlines below are ceilings
 * rather than waits. `clipboard.readText()` is a cheap local call.
 */
const POLL_MS = 15

/**
 * How long to wait for a SELECTION to appear.
 *
 * The one real cost on the common path: with nothing selected, Ctrl+C
 * legitimately produces nothing, so every whole-field transform waits this out
 * before falling through. Kept short for exactly that reason.
 *
 * What it trades against is mild — on an unusually slow app the probe gives up,
 * the whole field is taken instead of the selection, and the user sees more
 * rewritten than they meant. Recoverable, and the previous behaviour was to
 * fail outright.
 */
const SELECTION_PROBE_MS = 300

/**
 * How long to wait for the CUT to appear.
 *
 * Generous, because this is the one that must not fail: reaching the end of it
 * means telling the user there was nothing in a field they are looking at. It
 * only ever costs this much when the field really is empty.
 */
const CUT_DEADLINE_MS = 1500

/** Between Ctrl+A and Ctrl+X. Selection is local to the app and fast. */
const SELECT_SETTLE_MS = 40

class TransformSession {
  #phase: Phase = 'idle'
  #abort: AbortController | null = null
  #dismissTimer: NodeJS.Timeout | null = null
  /** Bumped on every run and cancel, so late async work can tell it is stale. */
  #gen = 0

  /** The user's clipboard, taken once and put back once, at the very end. */
  #saved: ClipboardSnapshot | null = null
  /**
   * The last thing THIS session put on the clipboard.
   *
   * Tracked because `restoreClipboard` only restores when the clipboard still
   * holds what we wrote — that check is what stops a stale snapshot from
   * stomping something the user copied mid-transform. It only works if the
   * value handed to it is the real last write, which on the "nothing to
   * transform" path is the sentinel, not any text.
   */
  #wrote = ''

  get busy(): boolean {
    return this.#phase !== 'idle'
  }

  /**
   * The keys are down and the combo matched, but nothing may be simulated yet
   * (hook.ts, `#pendingTap`).
   *
   * All this does is put the widget on screen. The press has to feel
   * registered — a shortcut that appears to do nothing for 200ms gets pressed
   * again, and the second press is the one that arrives mid-cut.
   */
  arm(id: number): void {
    if (this.busy) return
    const rule = getTransform(id)
    if (!rule?.enabled) return

    this.#phase = 'arming'
    this.#gen += 1
    this.#clearDismiss()
    this.#state('transforming', rule.name)
    showWidget()
  }

  /* ------------------------------------------------------------ run ---- */

  async run(id: number): Promise<void> {
    if (this.#phase !== 'arming') return
    const gen = this.#gen

    const rule = getTransform(id)
    if (!rule?.enabled) {
      this.#settle('cancelled')
      return
    }

    const settings = readSettings()
    const providerId: TransformProviderId = isTransformProvider(settings.transformProvider ?? '')
      ? (settings.transformProvider as TransformProviderId)
      : 'groq'
    const spec = TRANSFORM_PROVIDERS[providerId]
    const apiKey = getSecret(spec.secret)

    // Checked BEFORE anything is cut. Discovering a missing key afterwards
    // would mean the user's text had been removed and pasted back, which looks
    // like a malfunction rather than a setting that needs filling in.
    const notReady = transformReadiness(providerId, apiKey)
    if (notReady) {
      this.#settle('error', notReady.message)
      return
    }

    // §6.2 — the widget is focusable:false, so showing it in `arm` did not
    // steal the target. The elevation probe starts here and is awaited only on
    // the path that needs it — see below.
    const target = await captureTarget()
    if (gen !== this.#gen) return

    /* ---------------------------------------------------------- read ---- */

    this.#phase = 'reading'
    this.#saved = snapshotClipboard()

    let grabbed: { text: string; grab: Grab } | null
    try {
      grabbed = await this.#read()
    } catch {
      this.#release()
      this.#settle('error', 'Could not read the text.')
      return
    }

    if (gen !== this.#gen) {
      this.#release()
      return
    }

    if (!grabbed) {
      this.#release()

      // Two very different situations look identical from here: an empty field,
      // and a field that never received our Ctrl+X at all. §6.4 — Windows UIPI
      // silently swallows input sent from a non-elevated process to an elevated
      // window, so an admin terminal produces exactly the same nothing as an
      // empty text box.
      //
      // The probe is awaited HERE rather than up front, which is the whole
      // reason it is cheap: a successful read proves our input reached the
      // window, so the happy path never pays for it.
      this.#settle((await target.elevated) ? 'blocked' : 'no-text')
      return
    }

    const { text, grab } = grabbed

    /**
     * Undo the read. Every exit below this line calls it before settling.
     *
     * Selection mode removed nothing — Ctrl+C is not destructive and the
     * selection is still live on screen — so putting it "back" would DUPLICATE
     * the text. Field mode emptied the field and must refill it.
     */
    const putBack = async (): Promise<void> => {
      if (grab === 'selection') return
      try {
        await this.#paste(text)
      } catch {
        // Nothing left to try. The text is still on the clipboard at this
        // point, so the user can paste it themselves — which is the only
        // reason this is survivable. `#release` will not overwrite it: the
        // clipboard no longer holds what we last wrote.
      }
    }

    // No elevation check here on purpose. The read above already sent Ctrl+C
    // or Ctrl+X to this window and got text back, which is proof that our
    // input reaches it — the one thing the probe exists to predict.

    if (gen !== this.#gen) {
      await putBack()
      this.#release()
      return
    }

    /* ----------------------------------------------------------- llm ---- */

    this.#phase = 'working'
    this.#abort = new AbortController()

    let output: string
    try {
      const provider = getTransformProvider(providerId, apiKey)
      output = await provider.transform(rule.rule, text, {
        model: settings[spec.modelKey] ?? '',
        signal: this.#abort.signal,
      })
    } catch (err) {
      await putBack()
      this.#release()
      this.#failed(err)
      return
    } finally {
      this.#abort = null
    }

    if (gen !== this.#gen) {
      await putBack()
      this.#release()
      return
    }

    /* --------------------------------------------------------- paste ---- */

    this.#phase = 'inserting'
    try {
      // In selection mode this replaces the still-live selection; in field mode
      // it fills the field the cut emptied. Same call either way.
      await this.#paste(output)
    } catch (err) {
      await putBack()
      this.#release()
      this.#settle('error', err instanceof Error ? err.message : 'Could not insert the text.')
      return
    }

    this.#release()
    this.#bump(rule.id)
    this.#settle('transformed')
  }

  /* ----------------------------------------------------------- read ---- */

  /**
   * Take the text out of the focused field.
   *
   * Selection first, whole field second. That order is what makes a transform
   * usable on one paragraph of a long draft — and `Ctrl+A` in a document means
   * the whole document, which is a lot to hand to a model by accident.
   *
   * "Did that key take anything?" cannot be answered by comparing the clipboard
   * before and after: the field might legitimately hold exactly what was
   * already on the clipboard, and a read-only field ignores Ctrl+X silently. So
   * a unique sentinel goes on first. If it is still there, the key did nothing.
   * Unambiguous, and it costs one clipboard write.
   */
  async #read(): Promise<{ text: string; grab: Grab } | null> {
    const sentinel = `dictateflow-sentinel:${randomUUID()}`

    this.#write(sentinel)
    await sendCopy()

    const copied = await this.#awaitClipboard(sentinel, SELECTION_PROBE_MS)
    if (copied) {
      // The TARGET process put this there, not us — but `#wrote` has to track
      // what is actually on the clipboard, not what we last wrote, or the
      // restore is skipped. Selection mode has no paste of its own on the
      // failure path, so without this line a failed transform leaves the user's
      // clipboard holding their selection instead of what was there before.
      this.#wrote = copied
      return { text: copied, grab: 'selection' }
    }

    this.#write(sentinel)
    await sendSelectAll()
    await settle(SELECT_SETTLE_MS)
    await sendCut()

    const cut = await this.#awaitClipboard(sentinel, CUT_DEADLINE_MS)
    if (cut) {
      this.#wrote = cut
      return { text: cut, grab: 'field' }
    }

    return null
  }

  /**
   * Wait for the target app to replace the sentinel, or give up.
   *
   * Returns the instant real text lands, so `deadlineMs` is a ceiling and not a
   * cost. Returns null only when the sentinel is STILL there at the end, which
   * is the unambiguous "that key did nothing" signal the sentinel exists for.
   */
  async #awaitClipboard(sentinel: string, deadlineMs: number): Promise<string | null> {
    const until = Date.now() + deadlineMs
    for (;;) {
      let now = sentinel
      try {
        now = clipboard.readText()
      } catch {
        // Another process can hold the clipboard open mid-write. That is a
        // reason to look again, not a reason to conclude the field was empty.
      }
      if (now !== sentinel && now.trim()) return now
      if (Date.now() >= until) return null
      await settle(POLL_MS)
    }
  }

  /* --------------------------------------------------------- cancel ---- */

  /**
   * Esc, at any point (§11).
   *
   * Only the LLM leg is genuinely interruptible — a simulated keystroke is
   * already in the OS input queue and cannot be recalled. `#gen` covers the
   * rest: `run` re-checks it after every await, and each of those checks pastes
   * the text back before returning.
   */
  cancel(): void {
    if (!this.busy) return
    this.#gen += 1
    this.#abort?.abort()
    this.#abort = null
    this.#settle('cancelled')
  }

  /* ------------------------------------------------------ clipboard ---- */

  #write(text: string): void {
    this.#wrote = text
    clipboard.writeText(text)
  }

  async #paste(text: string): Promise<void> {
    this.#wrote = text
    await pasteText(text)
  }

  /**
   * Give the target time to read the last paste, then put the user's clipboard
   * back where it was.
   *
   * Deferred rather than immediate for the reason §6.4 gives: restoring too
   * early takes the text back before the target has serviced WM_PASTE, and the
   * paste silently produces nothing.
   */
  #release(): void {
    const previous = this.#saved
    const wrote = this.#wrote
    this.#saved = null
    this.#wrote = ''
    if (!previous) return

    const delay = clampRestoreDelay(Number(readSettings().typingDelayMs))
    setTimeout(() => {
      try {
        restoreClipboard(previous, wrote)
      } catch {
        // Another process can hold the clipboard open. The user has their
        // text; a lost clipboard restore is not worth an error state.
      }
    }, delay)
  }

  /* ---------------------------------------------------------- inner ---- */

  /**
   * The rule fired. Counted on the row, never in `dictations` — §8 defines WPM
   * as words over RECORDING duration, and a transform has no recording.
   */
  #bump(id: number): void {
    try {
      bumpTransform(id)
      broadcastTransformsChanged()
    } catch {
      // A failed counter must not turn a successful transform into an error.
    }
  }

  #failed(err: unknown): void {
    if (!(err instanceof TransformError)) {
      this.#settle('error', err instanceof Error ? err.message : 'The transform failed.')
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
      default:
        // 'no-key', 'unauthorized', 'empty' and 'failed' each carry a message
        // written for the person looking at the widget.
        this.#settle('error', err.message)
    }
  }

  #state(state: WidgetState, detail?: string, message?: string): void {
    sendToWidget(IPC_EVENT.widgetState, {
      state,
      ...(detail === undefined ? {} : { detail }),
      ...(message === undefined ? {} : { message }),
    })
  }

  /** Terminal state: show it, then hide the widget and return to idle. */
  #settle(state: WidgetState, message?: string): void {
    this.#state(state, undefined, message)
    this.#phase = 'idle'
    this.#abort = null

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

export const transformSession = new TransformSession()
