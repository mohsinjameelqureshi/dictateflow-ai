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
  'app:info': [void, AppInfo]
}

/** §8 metric definitions — a word is a whitespace token, empties filtered. */
export function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length
}
