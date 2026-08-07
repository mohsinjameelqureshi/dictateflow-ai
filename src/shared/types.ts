/**
 * The contract between main and renderer. Renderer must never import from
 * src/db or src/main — only from here.
 */

/** Settings keys per §8. `apiKey` is deliberately absent: safeStorage only. */
export const SETTING_KEYS = [
  'shortcut',
  'microphoneId',
  'theme',
  'language',
  'launchOnStartup',
  'minimizeToTray',
  'typingDelayMs',
  'speechProvider',
  'enhanceEnabled',
] as const

export type SettingKey = (typeof SETTING_KEYS)[number]
export type Settings = Partial<Record<SettingKey, string>>

export const DEFAULT_SETTINGS: Record<SettingKey, string> = {
  shortcut: 'Ctrl+Meta',
  microphoneId: '',
  theme: 'light',
  language: 'en',
  launchOnStartup: 'false',
  minimizeToTray: 'true',
  typingDelayMs: '150',
  speechProvider: 'groq',
  enhanceEnabled: 'false', // §4 — off by default, it deletes words
}

/** Wire-safe dictation. `createdAt` is epoch ms, not a Date — IPC serialises. */
export interface DictationDto {
  id: number
  rawText: string
  finalText: string
  durationMs: number
  words: number
  language: string
  providerId: string
  enhanced: boolean
  grammarFixes: number
  dictionaryFixes: number
  favorite: boolean
  createdAt: number
}

export interface NewDictationDto {
  rawText: string
  finalText: string
  durationMs: number
  language?: string
  providerId: string
  enhanced?: boolean
  grammarFixes?: number
  dictionaryFixes?: number
}

export interface ListDictationsQuery {
  limit?: number
  offset?: number
  search?: string
  favoritesOnly?: boolean
}

/* ------------------------------------------------------------ insights ---- */

/** One day in the heatmap. `day` is a local-time 'YYYY-MM-DD' key (§8). */
export interface DayStat {
  day: string
  words: number
  sessions: number
  durationMs: number
}

/**
 * §8 fixes these definitions so the numbers mean something:
 *   - WPM is words over RECORDING duration, not speech duration.
 *   - A word is a whitespace-delimited token, empties filtered.
 *   - A streak is consecutive days with ≥1 session, in local time.
 *
 * There is no `statistics` table. All of this is derived on read, because a
 * denormalised totals row drifts from reality for no benefit at this volume.
 */
export interface InsightsDto {
  totalWords: number
  totalSessions: number
  totalDurationMs: number
  wpm: number
  currentStreak: number
  longestStreak: number
  /** Contiguous, oldest first — days with no activity are present as zeroes. */
  days: DayStat[]
}

/* ---------------------------------------------------------- dictionary ---- */

/** A personal dictionary rule. `createdAt` is epoch ms — IPC serialises. */
export interface DictionaryDto {
  id: number
  from: string
  to: string
  hitCount: number
  createdAt: number
}

export interface NewDictionaryDto {
  from: string
  to: string
}

/**
 * Writes answer with a reason instead of rejecting.
 *
 * A rejected `ipcMain.handle` reaches the renderer wrapped in "Error invoking
 * remote method…", which is not something §12 would let near a user. Expected
 * failures — a duplicate term, an empty field — are values, not exceptions.
 */
export type DictionaryWrite =
  | { ok: true; entry: DictionaryDto }
  | { ok: false; problem: string }

/** Shared by the form and the IPC handler, so the two cannot disagree. */
export function validateRule(from: string, to: string): string | null {
  if (!from.trim()) return 'Enter the word as it is heard.'
  if (!to.trim()) return 'Enter what it should become.'
  if (from.trim().toLowerCase() === to.trim().toLowerCase()) {
    return 'Those are the same. A rule needs something to change.'
  }
  return null
}

export interface AppInfo {
  version: string
  electron: string
  chrome: string
  node: string
  platform: string
  dbPath: string
}

/* ------------------------------------------------------------ capture ---- */

/**
 * The nine widget states from §11, plus `error` for the unexpected. §14
 * requires every failure path to surface somewhere; a generic state is what
 * stops an unhandled rejection from leaving the widget stuck on "Transcribing".
 */
export type WidgetState =
  | 'listening'
  | 'processing'
  | 'inserting'
  | 'success'
  | 'no-speech'
  | 'offline'
  | 'rate-limited'
  | 'blocked'
  | 'cancelled'
  | 'error'

export interface WidgetStatePayload {
  state: WidgetState
  /** Only read for `error`. The other states have fixed copy (§12). */
  message?: string
}

/** main -> widget. `cancel` discards the buffer; `stop` returns it. */
export type WidgetCommand =
  | { type: 'start'; deviceId: string }
  | { type: 'stop' }
  | { type: 'cancel' }

export interface ClipMeta {
  sampleRate: number
  durationMs: number
  samples: number
  /** Peak absolute amplitude, 0–1. The §6.6 silence guard reads this. */
  peak: number
}

/** Structured-cloned over IPC — Uint8Array survives, Buffer does not. */
export interface ClipPayload {
  bytes: Uint8Array
  meta: ClipMeta
}

/** §6.6 guards. Measured margins are in spikes/README.md — do not loosen. */
export const MIN_CLIP_MS = 400
export const MIN_CLIP_PEAK = 0.01

export interface ApiKeyStatus {
  present: boolean
  /** Whether the OS actually offers encryption. False means we refuse to store. */
  encryptionAvailable: boolean
}

/* ----------------------------------------------------------- settings ---- */

/** Tabs in the settings window's own sidebar. */
export type SettingsTab = 'general' | 'transcription' | 'about'

/**
 * A microphone, as offered to the picker. Enumerated by the widget renderer —
 * it is the only surface holding media permission (§6.7), so it is the only
 * one that sees device labels rather than empty strings.
 */
export interface AudioInputDevice {
  deviceId: string
  label: string
}

/**
 * Channel -> [request, response]. This is what makes the preload bridge
 * type-safe end to end.
 */
export interface IpcMap {
  'window:minimize': [void, void]
  'window:maximize': [void, boolean]
  'window:close': [void, void]
  'window:isMaximized': [void, boolean]
  'settings:getAll': [void, Settings]
  'settings:set': [{ key: SettingKey; value: string }, void]
  'dictations:list': [ListDictationsQuery | undefined, DictationDto[]]
  'dictations:count': [ListDictationsQuery | undefined, number]
  'dictations:create': [NewDictationDto, DictationDto]
  'dictations:setFavorite': [{ id: number; favorite: boolean }, DictationDto | null]
  'dictations:delete': [number, boolean]
  'insights:get': [void, InsightsDto]
  'dictionary:list': [void, DictionaryDto[]]
  'dictionary:create': [NewDictionaryDto, DictionaryWrite]
  'dictionary:update': [{ id: number } & NewDictionaryDto, DictionaryWrite]
  'dictionary:delete': [number, boolean]
  'clipboard:write': [string, void]
  'apiKey:status': [void, ApiKeyStatus]
  'apiKey:set': [string, ApiKeyStatus]
  'apiKey:clear': [void, ApiKeyStatus]
  'widget:clip': [ClipPayload, void]
  'widget:micError': [{ name: string; message: string }, void]
  'widget:devices': [{ requestId: number; devices: AudioInputDevice[] }, void]
  'devices:list': [void, AudioInputDevice[]]
  'settings:open': [SettingsTab | undefined, void]
  'shortcut:suspend': [boolean, void]
  'app:info': [void, AppInfo]
}

/**
 * Destinations in the main window. Settings is deliberately absent: it is a
 * separate window now, not a page here.
 */
export type AppRoute = 'history' | 'insights' | 'dictionary'

/** Channel -> payload for main-initiated pushes. See IPC_EVENT. */
export interface IpcEventMap {
  'widget:command': WidgetCommand
  'widget:state': WidgetStatePayload
  'widget:enumerate': { requestId: number }
  'dictations:changed': void
  'app:navigate': AppRoute
  'settings:navigate': SettingsTab
}

/** §8 metric definitions — a word is a whitespace token, empties filtered. */
export function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length
}
