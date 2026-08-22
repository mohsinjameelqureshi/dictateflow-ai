import { UiohookKey, uIOhook } from 'uiohook-napi'

/**
 * The global keyboard hook (§6.1).
 *
 * Electron's `globalShortcut` fires on key-down only, has no key-up event, and
 * cannot express a modifier-only combo — hold-to-record is impossible with it.
 * `uiohook-napi` exposes both edges, verified in spike 1.
 *
 * It holds every binding in the app: one HOLD binding for dictation, and one
 * TAP binding per armed transform rule. This file stays a pure wrapper — it
 * emits binding ids and knows nothing about dictation, transforms, settings or
 * the database. `index.ts` decides what an id means.
 */

/**
 * 'hold' — fires `onPress` when the combo completes and `onRelease` when it
 *          breaks. Dictation, where the release is what says "stop recording".
 * 'tap'  — fires once per press. A transform, which has nothing to wait for.
 */
export type BindingMode = 'hold' | 'tap'

export interface Binding {
  /** 'dictation', or 'transform:<row id>'. Opaque to this file. */
  id: string
  shortcut: string
  mode: BindingMode
}

export interface HookHandlers {
  /** A hold binding completed. */
  onPress(id: string): void
  /** A hold binding broke. */
  onRelease(id: string): void
  /** A tap binding completed AND every key has since been released (§4.2). */
  onTap(id: string): void
  /**
   * A tap binding completed, but the keys are still down.
   *
   * Split from `onTap` purely so the widget can appear on the press. The press
   * has to feel registered, and the work cannot start yet — see below.
   */
  onTapArmed(id: string): void
  /** Esc must abort at any point — recording, upload or transcription (§11). */
  onCancel(): void
}

const ESCAPE = UiohookKey.Escape

/**
 * 'Ctrl+Meta' -> the set of keycodes that must all be physically down.
 * Unknown names are dropped rather than thrown on, so a corrupt setting
 * degrades to "no shortcut" instead of crashing the main process at boot.
 */
export function parseCombo(shortcut: string): Set<number> {
  const codes = new Set<number>()
  for (const name of shortcut.split('+')) {
    const code = (UiohookKey as Record<string, number | undefined>)[name.trim()]
    if (typeof code === 'number') codes.add(code)
  }
  return codes
}

interface Armed {
  id: string
  mode: BindingMode
  codes: Set<number>
}

export class ShortcutHook {
  /** Physical keys currently down — uiohook has no "is this key down" query. */
  #down = new Set<number>()
  #bindings: Armed[] = []
  /** The hold binding currently firing, if any. */
  #held: string | null = null
  /**
   * A tap that has completed but is waiting for the keys to come up.
   *
   * This is the load-bearing detail of the whole tap path. `uiohook-napi`
   * LISTENS; it does not swallow. The focused app sees Ctrl+Alt+E too — and if
   * the transform session simulates Ctrl+C while the user is still physically
   * holding Alt, the app receives Ctrl+Alt+C, which is a different command in
   * most editors. So the work waits for `#down` to empty.
   */
  #pendingTap: string | null = null
  #started = false
  #suspended = false

  constructor(
    bindings: Binding[],
    private handlers: HookHandlers,
  ) {
    this.setBindings(bindings)
  }

  /**
   * Replace the whole binding set.
   *
   * Whole-set rather than incremental: the callers that change bindings —
   * rebinding dictation, editing a transform — already know the full list, and
   * a diff would be three more states for the same answer.
   */
  setBindings(bindings: Binding[]): void {
    // Releasing mid-change would strand a held binding; reset the world first.
    this.#reset()

    this.#bindings = bindings
      .map((b) => ({ id: b.id, mode: b.mode, codes: parseCombo(b.shortcut) }))
      .filter((b) => b.codes.size > 0)
      // Most specific first. Two bindings in a subset relation are rejected at
      // save time (shared/shortcut.ts), so this cannot normally matter — but a
      // hand-edited database should pick the longer combo rather than
      // whichever happened to be inserted first.
      .sort((a, b) => b.codes.size - a.codes.size)
  }

  /**
   * Deafen the hook without unhooking it.
   *
   * The settings dialog records a new combo by listening for real key presses,
   * and the OLD combos are still armed while it does — without this, rebinding
   * away from Ctrl+Win starts a dictation the moment the user presses Ctrl+Win
   * to demonstrate what they are replacing.
   */
  setSuspended(suspended: boolean): void {
    if (this.#suspended === suspended) return
    this.#suspended = suspended
    // Keys pressed while deafened were never recorded, so the map is stale
    // either way; drop it rather than trust it.
    this.#reset()
  }

  /**
   * Forget everything that was in flight.
   *
   * Cancels rather than releasing: `onRelease` means "the user finished
   * speaking, transcribe it", and a rebind or a suspension is not that. The
   * distinction matters — releasing here would upload audio the user never
   * meant to send.
   */
  #reset(): void {
    // A pending tap counts as in flight. It has already put the widget on
    // screen, so dropping it silently would strand that widget with nothing
    // coming to dismiss it.
    const wasBusy = this.#held !== null || this.#pendingTap !== null
    this.#down.clear()
    this.#held = null
    this.#pendingTap = null
    if (wasBusy) this.handlers.onCancel()
  }

  #satisfied(binding: Armed): boolean {
    for (const code of binding.codes) if (!this.#down.has(code)) return false
    return true
  }

  /** The most specific binding whose keys are all down, or null. */
  #match(): Armed | null {
    return this.#bindings.find((b) => this.#satisfied(b)) ?? null
  }

  start(): void {
    if (this.#started) return
    this.#started = true

    uIOhook.on('keydown', (e) => {
      if (this.#suspended) return

      // Auto-repeat fires keydown continuously while a key is held. The Set
      // makes that idempotent; `#held` and `#pendingTap` guard the callbacks.
      this.#down.add(e.keycode)

      if (e.keycode === ESCAPE) {
        // Not `onRelease` — that means "finished speaking, transcribe it".
        // Esc means throw it away. It also still fires after the keys are up,
        // so it can cancel in-flight work: a transcription, or a transform
        // waiting on the model.
        this.#held = null
        this.#pendingTap = null
        this.handlers.onCancel()
        return
      }

      if (this.#held || this.#pendingTap) return

      const match = this.#match()
      if (!match) return

      if (match.mode === 'hold') {
        this.#held = match.id
        this.handlers.onPress(match.id)
      } else {
        this.#pendingTap = match.id
        this.handlers.onTapArmed(match.id)
      }
    })

    uIOhook.on('keyup', (e) => {
      if (this.#suspended) return
      this.#down.delete(e.keycode)

      // Stop as soon as the combo is broken, not only when every key is up —
      // the user lifting one finger means they have stopped speaking.
      if (this.#held) {
        const binding = this.#bindings.find((b) => b.id === this.#held)
        if (!binding || !this.#satisfied(binding)) {
          const id = this.#held
          this.#held = null
          this.handlers.onRelease(id)
        }
      }

      // A tap, by contrast, waits for EVERY key to lift before doing anything.
      // See #pendingTap.
      if (this.#pendingTap && this.#down.size === 0) {
        const id = this.#pendingTap
        this.#pendingTap = null
        this.handlers.onTap(id)
      }
    })

    uIOhook.start()
  }

  stop(): void {
    if (!this.#started) return
    this.#started = false
    try {
      uIOhook.stop()
    } catch {
      // Already torn down by the OS during shutdown.
    }
  }
}
