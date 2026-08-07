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
 * Returns the reason a combo is unusable, or null if it is fine.
 *
 * The rules exist because this is a HOLD shortcut competing with ordinary
 * typing: a bare modifier would start dictating every time the user pressed
 * Ctrl+C, and a bare letter would fire while typing a sentence.
 */
export function validateShortcut(shortcut: string): string | null {
  const keys = parseShortcut(shortcut)
  if (keys.length === 0) return 'Press and hold the keys you want to use.'
  if (keys.length > 4) return 'Use at most four keys.'

  const unknown = keys.find((k) => !KEY_NAMES.has(k))
  if (unknown) return `${keyLabel(unknown)} can't be used as a shortcut.`

  const plain = keys.filter((k) => !isModifier(k))
  if (plain.length > 1) return 'Use one key plus modifiers.'

  if (plain.length === 0 && keys.length < 2) {
    return 'One modifier on its own would fire during ordinary typing. Hold two.'
  }

  if (plain.length === 1 && keys.length === 1 && !/^F\d{1,2}$/.test(plain[0] ?? '')) {
    return 'Add a modifier, or use a function key on its own.'
  }

  return null
}
