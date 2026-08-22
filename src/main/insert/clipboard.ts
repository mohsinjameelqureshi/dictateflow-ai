import { clipboard, type NativeImage } from 'electron'
import { Key, keyboard } from '@nut-tree-fork/nut-js'

/**
 * §6.4 — insert by clipboard, never by simulated typing. Character-by-character
 * typing is visibly slow on long text and mangles non-ASCII and emoji.
 *
 * MEASURED (spikes/README.md): 56–120ms end to end against a real Notepad
 * window, and the source window never loses focus.
 *
 * Since 1.1.0 this module also lends its pieces to the transform session,
 * which needs ONE snapshot/restore around a whole read-modify-write cycle
 * rather than the nested pair `insertText` would give it. Dictation's
 * behaviour is unchanged; it is now assembled from the exported parts.
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

export interface ClipboardSnapshot {
  text: string
  image: NativeImage | null
}

export function snapshotClipboard(): ClipboardSnapshot {
  const image = clipboard.readImage()
  return {
    text: clipboard.readText(),
    // A copied screenshot is exactly the kind of clipboard loss §6.4 calls a
    // real annoyance, so it is preserved rather than only text.
    image: image.isEmpty() ? null : image,
  }
}

/**
 * Put the user's clipboard back, unless they have since replaced it.
 *
 * `wrote` is the last thing we put there. If the clipboard no longer holds it,
 * the user copied something during the paste and theirs wins — do not stomp a
 * fresh clipboard with a stale snapshot.
 */
export function restoreClipboard(prev: ClipboardSnapshot, wrote: string): void {
  if (clipboard.readText() !== wrote) return

  if (prev.image) clipboard.writeImage(prev.image)
  else if (prev.text) clipboard.writeText(prev.text)
  else clipboard.clear()
}

export function clampRestoreDelay(restoreDelayMs?: number): number {
  return Number.isFinite(restoreDelayMs)
    ? Math.min(Math.max(restoreDelayMs as number, MIN_RESTORE_DELAY_MS), MAX_RESTORE_DELAY_MS)
    : DEFAULT_RESTORE_DELAY_MS
}

/* --------------------------------------------------------- key sends ---- */

const chord = async (...keys: Key[]): Promise<void> => {
  await keyboard.pressKey(...keys)
  await keyboard.releaseKey(...keys)
}

export const sendPaste = (): Promise<void> => chord(Key.LeftControl, Key.V)
export const sendCopy = (): Promise<void> => chord(Key.LeftControl, Key.C)
export const sendCut = (): Promise<void> => chord(Key.LeftControl, Key.X)
export const sendSelectAll = (): Promise<void> => chord(Key.LeftControl, Key.A)

export const settle = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Write text and paste it. No snapshot, no restore — the caller owns those.
 *
 * Split out so the transform session can hold one snapshot across a cut, an
 * LLM round trip and a paste. Nesting `insertText`'s own snapshot inside that
 * would capture the CUT TEXT as "the user's clipboard" and faithfully restore
 * it, which is the opposite of the intent.
 */
export async function pasteText(text: string): Promise<void> {
  if (!text) return
  clipboard.writeText(text)
  await sendPaste()
}

/**
 * The dictation insert path: save the clipboard, paste, give the target time
 * to read it, then put the clipboard back.
 */
export async function insertText(text: string, restoreDelayMs?: number): Promise<void> {
  if (!text) return

  const delay = clampRestoreDelay(restoreDelayMs)
  const previous = snapshotClipboard()

  await pasteText(text)

  setTimeout(() => {
    try {
      restoreClipboard(previous, text)
    } catch {
      // Another process can hold the clipboard open. Not worth surfacing —
      // the text the user asked for is already inserted.
    }
  }, delay)
}

/**
 * Long enough for the target to have serviced the paste before Enter arrives.
 *
 * SendInput preserves queue order, so a well-behaved app would see Ctrl+V and
 * Enter in the right sequence with no wait at all. Not every app is one:
 * anything that debounces input or repaints between the two can act on Enter
 * against a field it has not finished filling — and for the apps this command
 * exists for, that means sending a half-empty message.
 *
 * Cheap insurance against an unrecoverable failure, and small against the §3
 * budget.
 */
const PASTE_SETTLE_MS = 60

/**
 * Send Enter to whatever window the text just went into (§9 voice commands).
 *
 * Waits out PASTE_SETTLE_MS first, so this is only ever called after the paste
 * it belongs to. It carries no UIPI guard of its own — the caller has already
 * probed the target, and an elevated window rejects this the same silent way
 * it rejects the paste (§6.4).
 */
export async function pressEnter(): Promise<void> {
  await settle(PASTE_SETTLE_MS)
  await keyboard.pressKey(Key.Enter)
  await keyboard.releaseKey(Key.Enter)
}
