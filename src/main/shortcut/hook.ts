import { UiohookKey, uIOhook } from 'uiohook-napi'

/**
 * Global hold-to-talk (§6.1).
 *
 * Electron's `globalShortcut` fires on key-down only, has no key-up event, and
 * cannot express a modifier-only combo — hold-to-record is impossible with it.
 * `uiohook-napi` exposes both edges, verified in spike 1.
 */

export interface HookHandlers {
  onPress(): void
  onRelease(): void
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

export class ShortcutHook {
  /** Physical keys currently down — uiohook has no "is this key down" query. */
  #down = new Set<number>()
  #combo: Set<number>
  #held = false
  #started = false
  #suspended = false

  constructor(
    shortcut: string,
    private handlers: HookHandlers,
  ) {
    this.#combo = parseCombo(shortcut)
  }

  setShortcut(shortcut: string): void {
    const next = parseCombo(shortcut)
    if (next.size === 0) return
    // Releasing mid-change would strand `held`; reset the world instead.
    if (this.#held) {
      this.#held = false
      this.handlers.onCancel()
    }
    this.#down.clear()
    this.#combo = next
  }

  /**
   * Deafen the hook without unhooking it.
   *
   * The settings window records a new combo by listening for real key presses,
   * and the OLD combo is still armed while it does — without this, rebinding
   * away from Ctrl+Win starts a dictation the moment the user presses Ctrl+Win
   * to demonstrate what they are replacing.
   */
  setSuspended(suspended: boolean): void {
    if (this.#suspended === suspended) return
    this.#suspended = suspended

    // Keys pressed while deafened were never recorded, so the map is stale
    // either way; drop it rather than trust it.
    this.#down.clear()
    if (this.#held) {
      this.#held = false
      this.handlers.onCancel()
    }
  }

  #satisfied(): boolean {
    if (this.#combo.size === 0) return false
    for (const code of this.#combo) if (!this.#down.has(code)) return false
    return true
  }

  start(): void {
    if (this.#started) return
    this.#started = true

    uIOhook.on('keydown', (e) => {
      if (this.#suspended) return

      // Auto-repeat fires keydown continuously while a key is held. The Set
      // makes that idempotent; `#held` is what actually guards the callback.
      this.#down.add(e.keycode)

      if (e.keycode === ESCAPE && this.#held) {
        this.#held = false
        this.handlers.onCancel()
        return
      }
      if (e.keycode === ESCAPE) {
        // Esc after release still cancels an in-flight transcription.
        this.handlers.onCancel()
        return
      }

      if (!this.#held && this.#satisfied()) {
        this.#held = true
        this.handlers.onPress()
      }
    })

    uIOhook.on('keyup', (e) => {
      if (this.#suspended) return
      this.#down.delete(e.keycode)

      // Stop as soon as the combo is broken, not only when every key is up.
      if (this.#held && !this.#satisfied()) {
        this.#held = false
        this.handlers.onRelease()
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
