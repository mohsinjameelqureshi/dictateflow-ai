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
  'dictations:create': [NewDictationDto, DictationDto]
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
export type AppRoute = 'history' | 'insights'

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
