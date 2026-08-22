/**
 * Shortcut strings, shared by the capture UI and the global hook.
 *
 * The wire format is uiohook-napi key names joined by '+' — 'Ctrl+Meta'. The
 * hook resolves those names to keycodes via `UiohookKey`; this module never
 * imports uiohook, because it also runs in the renderer and uiohook is a
 * native main-process module.
 *
 * Keeping the mapping and the validation in one file is what stops the
 * settings window from recording a combo the hook then silently drops.
 */

/** Left and right variants are distinct keycodes to uiohook, so they are here too. */
export const MODIFIER_NAMES = [
  'Ctrl',
  'CtrlRight',
  'Shift',
  'ShiftRight',
  'Alt',
  'AltRight',
  'Meta',
  'MetaRight',
] as const

const MODIFIERS = new Set<string>(MODIFIER_NAMES)

/**
 * DOM `KeyboardEvent.code` -> uiohook name.
 *
 * This table doubles as the allowlist: a key with no entry cannot be bound,
 * which is how Escape stays reserved for cancellation (§11).
 */
function buildCodeMap(): Record<string, string> {
  const map: Record<string, string> = {
    ControlLeft: 'Ctrl',
    ControlRight: 'CtrlRight',
    ShiftLeft: 'Shift',
    ShiftRight: 'ShiftRight',
    AltLeft: 'Alt',
    AltRight: 'AltRight',
    MetaLeft: 'Meta',
    MetaRight: 'MetaRight',
  }

  for (const letter of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') map[`Key${letter}`] = letter
  for (let d = 0; d <= 9; d++) map[`Digit${d}`] = String(d)
  for (let f = 1; f <= 24; f++) map[`F${f}`] = `F${f}`
  for (let n = 0; n <= 9; n++) map[`Numpad${n}`] = `Numpad${n}`

  // Same spelling on both sides — listed rather than inferred so that adding
  // one is a deliberate act.
  for (const name of [
    'Space',
    'Tab',
    'Enter',
    'Backspace',
    'CapsLock',
    'Insert',
    'Delete',
    'Home',
    'End',
    'PageUp',
    'PageDown',
    'ArrowLeft',
    'ArrowRight',
    'ArrowUp',
    'ArrowDown',
    'Semicolon',
    'Equal',
    'Comma',
    'Minus',
    'Period',
    'Slash',
    'Backquote',
    'BracketLeft',
    'Backslash',
    'BracketRight',
    'Quote',
    'NumLock',
    'ScrollLock',
    'PrintScreen',
    'NumpadMultiply',
    'NumpadAdd',
    'NumpadSubtract',
    'NumpadDecimal',
    'NumpadDivide',
  ]) {
    map[name] = name
  }

  return map
}

const CODE_TO_KEY = buildCodeMap()
const KEY_NAMES = new Set(Object.values(CODE_TO_KEY))

/** Modifiers first, in a fixed order, so 'Meta+Ctrl' and 'Ctrl+Meta' are one thing. */
const ORDER = new Map<string, number>(MODIFIER_NAMES.map((name, i) => [name, i]))

export function isModifier(name: string): boolean {
  return MODIFIERS.has(name)
}

/** `KeyboardEvent.code` -> uiohook name, or null if the key cannot be bound. */
export function codeToKeyName(code: string): string | null {
  return CODE_TO_KEY[code] ?? null
}

export function parseShortcut(shortcut: string): string[] {
  return shortcut
    .split('+')
    .map((s) => s.trim())
    .filter(Boolean)
}

export function normalizeShortcut(keys: readonly string[]): string {
  const seen = new Set<string>()
  const unique = keys.filter((k) => (seen.has(k) ? false : (seen.add(k), true)))
  return [...unique]
    .sort((a, b) => (ORDER.get(a) ?? ORDER.size) - (ORDER.get(b) ?? ORDER.size))
    .join('+')
}

/** Windows spelling. `Meta` is the Windows key and calling it "Meta" helps nobody. */
const LABELS: Record<string, string> = {
  Ctrl: 'Ctrl',
  CtrlRight: 'Right Ctrl',
  Shift: 'Shift',
  ShiftRight: 'Right Shift',
  Alt: 'Alt',
  AltRight: 'Right Alt',
  Meta: 'Win',
  MetaRight: 'Right Win',
  ArrowLeft: '←',
  ArrowRight: '→',
  ArrowUp: '↑',
  ArrowDown: '↓',
  Semicolon: ';',
  Equal: '=',
  Comma: ',',
  Minus: '-',
  Period: '.',
  Slash: '/',
  Backquote: '`',
  BracketLeft: '[',
  Backslash: '\\',
  BracketRight: ']',
  Quote: "'",
  PrintScreen: 'Print Screen',
  CapsLock: 'Caps Lock',
  PageUp: 'Page Up',
  PageDown: 'Page Down',
  NumLock: 'Num Lock',
  ScrollLock: 'Scroll Lock',
}

export function keyLabel(name: string): string {
  return LABELS[name] ?? name
}

export function formatShortcut(shortcut: string): string {
  const keys = parseShortcut(shortcut)
  return keys.length ? keys.map(keyLabel).join(' + ') : 'Not set'
}

/**
 * How a combo is triggered.
 *
 *   'hold' — dictation. Held down for the length of the utterance, because the
 *            release is what says "stop recording".
 *   'tap'  — a transform. Pressed and let go; there is nothing to wait for.
 *
 * The distinction is not cosmetic: it changes what shapes are safe. Two bare
 * modifiers are fine to HOLD and unusable as a TAP — see below.
 */
export type ShortcutMode = 'hold' | 'tap'

/**
 * Returns the reason a combo is unusable, or null if it is fine.
 *
 * The rules exist because these shortcuts compete with ordinary typing: a bare
 * modifier would fire every time the user pressed Ctrl+C, and a bare letter
 * would fire while typing a sentence.
 */
export function validateShortcut(shortcut: string, mode: ShortcutMode = 'hold'): string | null {
  const keys = parseShortcut(shortcut)
  if (keys.length === 0) {
    return mode === 'hold' ? 'Press and hold the keys you want to use.' : 'Press the keys you want to use.'
  }
  if (keys.length > 4) return 'Use at most four keys.'

  const unknown = keys.find((k) => !KEY_NAMES.has(k))
  if (unknown) return `${keyLabel(unknown)} can't be used as a shortcut.`

  const plain = keys.filter((k) => !isModifier(k))
  if (plain.length > 1) return 'Use one key plus modifiers.'

  const lone = plain[0] ?? ''
  const functionKey = /^F\d{1,2}$/.test(lone)

  if (plain.length === 0) {
    // A tap fires the instant the combo is complete, so a modifier-only tap
    // would go off on the way to every OTHER shortcut that starts the same way
    // — Ctrl+Alt+Delete, Ctrl+Alt+anything. Holding two modifiers is a
    // deliberate act; passing through them is not.
    if (mode === 'tap') return 'Add a letter or number. Modifiers alone fire while you reach for other shortcuts.'
    if (keys.length < 2) {
      return 'One modifier on its own would fire during ordinary typing. Hold two.'
    }
    return null
  }

  if (keys.length === 1 && !functionKey) {
    return 'Add a modifier, or use a function key on its own.'
  }

  return null
}

/**
 * Whether two combos are in a subset relation, either direction.
 *
 * This is the whole conflict rule, and it exists because keydowns arrive ONE
 * AT A TIME. If dictation is Ctrl+Win and a transform is Ctrl+Win+E, then
 * pressing Ctrl, then Win, satisfies dictation and starts recording before E
 * is ever seen — the transform is unreachable, not merely ambiguous.
 *
 * Equality is the degenerate case, so this one predicate also rejects exact
 * duplicates and there is no separate check for them.
 */
export function shortcutsConflict(a: string, b: string): boolean {
  const left = new Set(parseShortcut(a))
  const right = new Set(parseShortcut(b))
  if (left.size === 0 || right.size === 0) return false

  const [small, large] = left.size <= right.size ? [left, right] : [right, left]
  for (const key of small) if (!large.has(key)) return false
  return true
}

/** A combo already in use, for the conflict message. */
export interface ShortcutClaim {
  shortcut: string
  /** What holds it, in the user's words: 'dictation', 'Enhance prompt'. */
  owner: string
}

/**
 * The reason a combo cannot be used, given everything else already bound.
 *
 * Separate from `validateShortcut` because it needs the world, not just the
 * combo — and because the renderer and the main process check it against
 * different snapshots of that world. Both call this function.
 */
export function findShortcutConflict(
  shortcut: string,
  claims: readonly ShortcutClaim[],
): string | null {
  const clash = claims.find((c) => shortcutsConflict(shortcut, c.shortcut))
  if (!clash) return null

  const taken = `${formatShortcut(clash.shortcut)} is already used for ${clash.owner}.`

  // An exact match needs no explanation. A subset relation does — "Ctrl+Win is
  // already used" reads like a non-sequitur when what you typed was
  // Ctrl+Win+E, so the second sentence says what to change.
  const identical = parseShortcut(shortcut).length === parseShortcut(clash.shortcut).length
  return identical ? taken : `${taken} Pick a combo that doesn't contain it.`
}
