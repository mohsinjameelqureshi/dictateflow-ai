import { clipboard, type NativeImage } from 'electron'
import { Key, keyboard } from '@nut-tree-fork/nut-js'

/**
 * §6.4 — insert by clipboard, never by simulated typing. Character-by-character
 * typing is visibly slow on long text and mangles non-ASCII and emoji.
 *
 * MEASURED (spikes/README.md): 56–120ms end to end against a real Notepad
 * window, and the source window never loses focus.
 */

/**
 * nut.js defaults `autoDelayMs` to 300, applied to BOTH pressKey and
 * releaseKey — 600ms per insertion, spent on nothing, against a §3 budget of
 * 800–1200ms. This single line is worth half the latency budget.
 */
keyboard.config.autoDelayMs = 0

/**
 * Long enough for the target app to service WM_PASTE, short enough not to
 * annoy. Restoring too early takes the text back before the target has read
 * it, and the paste silently produces nothing.
 */
const DEFAULT_RESTORE_DELAY_MS = 150

/** Clamped: a stored 0 would race the paste, and a huge value would strand it. */
const MIN_RESTORE_DELAY_MS = 50
const MAX_RESTORE_DELAY_MS = 2000

interface ClipboardSnapshot {
  text: string
  image: NativeImage | null
}

function snapshot(): ClipboardSnapshot {
  const image = clipboard.readImage()
  return {
    text: clipboard.readText(),
    // A copied screenshot is exactly the kind of clipboard loss §6.4 calls a
    // real annoyance, so it is preserved rather than only text.
    image: image.isEmpty() ? null : image,
  }
}

function restore(prev: ClipboardSnapshot, wrote: string): void {
  // If the user copied something during the paste, theirs wins — do not
  // stomp a fresh clipboard with a stale snapshot.
  if (clipboard.readText() !== wrote) return

  if (prev.image) clipboard.writeImage(prev.image)
  else if (prev.text) clipboard.writeText(prev.text)
  else clipboard.clear()
}

export async function insertText(text: string, restoreDelayMs?: number): Promise<void> {
  if (!text) return

  const delay = Number.isFinite(restoreDelayMs)
    ? Math.min(Math.max(restoreDelayMs as number, MIN_RESTORE_DELAY_MS), MAX_RESTORE_DELAY_MS)
    : DEFAULT_RESTORE_DELAY_MS

  const previous = snapshot()
  clipboard.writeText(text)

  await keyboard.pressKey(Key.LeftControl, Key.V)
  await keyboard.releaseKey(Key.LeftControl, Key.V)

  setTimeout(() => {
    try {
      restore(previous, text)
    } catch {
      // Another process can hold the clipboard open. Not worth surfacing —
      // the text the user asked for is already inserted.
    }
  }, delay)
}
