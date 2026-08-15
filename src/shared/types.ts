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
  'keepRecordings',
  'recordingRetentionDays',
  'pressEnterCommand',
  'moonshineModelSize',
  'moonshineLivePreview',
  'moonshineHighAccuracyFinal',
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
  keepRecordings: 'true', // §8 — on by default; hearing the clip is the point
  recordingRetentionDays: '0', // §8 — 0 means keep everything
  // §9 lists voice commands as deferred; this is the first one, so it lives
  // behind Experimental and starts off. It removes words from what gets typed,
  // which is the one thing §4 is emphatic about never doing by surprise.
  pressEnterCommand: 'false',
  // Moonshine, the local engine. These are read only when `speechProvider` is
  // 'moonshine'; `language` above stays the GROQ language and is deliberately
  // never written by the local engine, so switching engines is lossless.
  moonshineModelSize: 'medium', // beats Whisper Large v3 at 245M params
  moonshineLivePreview: 'true',
  moonshineHighAccuracyFinal: 'true',
}

/* ---------------------------------------------------------- moonshine ---- */

/**
 * The local engine (see docs/moonshine-integration-plan.md).
 *
 * English only, and that is a LICENSING boundary rather than a preference:
 * Moonshine's English weights are MIT, every other language is under a
 * community licence that is non-commercial and terminates above $1M revenue.
 * The language is a constant in the worker, never a parameter.
 */
export const MOONSHINE_LANGUAGE = 'en'

export type MoonshineModelSize = 'medium' | 'small' | 'tiny'

export interface MoonshineModelSpec {
  size: MoonshineModelSize
  label: string
  /** `ModelArch` value the WASM binding expects. Passed as a string. */
  arch: number
  /**
   * Total download. MEASURED from the live manifest, not estimated — the
   * integration spec guessed Tiny at ~30MB and it is actually 50.6MB.
   */
  bytes: number
  /** Word error rate, from the Moonshine model card. */
  wer: string
  hint: string
}

export const MOONSHINE_MODELS: Record<MoonshineModelSize, MoonshineModelSpec> = {
  medium: {
    size: 'medium',
    label: 'Medium',
    arch: 5,
    bytes: 306_356_461,
    wer: '6.65%',
    hint: 'Best accuracy. Beats Whisper Large v3 at a sixth of the size.',
  },
  small: {
    size: 'small',
    label: 'Small',
    arch: 4,
    bytes: 167_154_628,
    wer: '7.84%',
    hint: 'Half the download, close to Medium. For older machines.',
  },
  tiny: {
    size: 'tiny',
    label: 'Tiny',
    arch: 2,
    bytes: 53_107_313,
    wer: '12.00%',
    hint: 'Fastest and smallest. Noticeably weaker on names.',
  },
}

export const MOONSHINE_SIZES: MoonshineModelSize[] = ['medium', 'small', 'tiny']

export function isMoonshineSize(value: string): value is MoonshineModelSize {
  return (MOONSHINE_SIZES as string[]).includes(value)
}

/**
 * What Settings knows about a local model.
 *
 * `absent` and `partial` are deliberately distinct: a partial model resumes
 * rather than restarting, and saying so is the difference between "downloading
 * 292MB again" and "picking up where it left off".
 */
export type MoonshineModelState = 'absent' | 'partial' | 'downloading' | 'ready' | 'error'

export interface MoonshineStatus {
  size: MoonshineModelSize
  state: MoonshineModelState
  /** Bytes present on disk for this model. */
  bytes: number
  /** Total the model needs. From the manifest once known, else the spec table. */
  totalBytes: number
  /** Only set on `error`. */
  problem?: string
  /** Whether the engine is loaded and ready to transcribe right now. */
  loaded: boolean
}

/** Pushed while a download runs, so the card can show real progress (§7.5). */
export interface MoonshineProgress {
  size: MoonshineModelSize
  bytes: number
  totalBytes: number
  /** The file currently in flight, for the "downloading encoder.ort" line. */
  file: string
}

/** §8 — the offered retention windows. 0 is "keep everything", not "delete now". */
export const RETENTION_DAYS = [0, 7, 30, 90] as const

/**
 * What Settings shows about `recordings/` (§8). At ~1.9MB per spoken minute
 * this number grows quietly, so it is surfaced rather than left for the user
 * to discover in Explorer.
 */
export interface RecordingsStats {
  files: number
  bytes: number
}

/**
 * How a recording is addressed (§6.8). Main registers the scheme and serves
 * it; the renderer puts the result in an <audio src>. Spelled once, here, so
 * the two cannot drift — they did once, and every recording 404'd.
 *
 * The `clip` host is load-bearing. The scheme is `standard`, so Chromium
 * canonicalises the host as a hostname, and an all-numeric host becomes an
 * IPv4 address:
 *
 *     dictateflow-audio://123      ->  dictateflow-audio://0.0.0.123/
 *     dictateflow-audio://clip/123 ->  unchanged
 *
 * The id therefore lives in the PATH. Never move it back to the host.
 */
export const AUDIO_SCHEME = 'dictateflow-audio'
export const AUDIO_HOST = 'clip'

export function audioUrl(dictationId: number): string {
  return `${AUDIO_SCHEME}://${AUDIO_HOST}/${dictationId}`
}

/** Bytes as something a person reads. Binary units — this is disk. */
export function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 MB'
  const mb = bytes / (1024 * 1024)
  if (mb < 1) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  if (mb < 1024) return `${mb.toFixed(mb < 10 ? 1 : 0)} MB`
  return `${(mb / 1024).toFixed(1)} GB`
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
  /**
   * Whether a recording exists for this row (§8). Deliberately a boolean and
   * not the filename: the renderer plays `dictateflow-audio://<id>` and never names
   * a file, so handing it one would only be an invitation.
   *
   * False for every row written before Phase 6 — those render a disabled
   * control, not a broken one.
   */
  hasAudio: boolean
  /** Bytes on disk, for the row's tooltip. Null when there is no recording. */
  audioBytes: number | null
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
  /** Filename only, never a path — see main/audio/store.ts. */
  audioFile?: string | null
  audioBytes?: number | null
  audioMime?: string | null
}

export interface ListDictationsQuery {
  limit?: number
  offset?: number
  search?: string
  favoritesOnly?: boolean
}

/* --------------------------------------------------------------- theme ---- */

/** What the user picked. 'system' follows the OS and changes with it. */
export type ThemeChoice = 'light' | 'dark' | 'system'

/** What that actually resolves to right now. Only the main process decides. */
export type ResolvedTheme = 'light' | 'dark'

export const THEME_CHOICES: ThemeChoice[] = ['system', 'light', 'dark']

export function isThemeChoice(value: string): value is ThemeChoice {
  return (THEME_CHOICES as string[]).includes(value)
}

/* ----------------------------------------------------------- transfer ---- */

/**
 * Export and import (§9). The file is plain JSON so it can be read, diffed and
 * edited by hand — it is the user's data and there is nothing to hide in it.
 *
 * `dailyStats` is deliberately absent: it is derived, and rebuilding it on
 * import is both smaller and safer than trusting a number in a file.
 * The API key is absent too — safeStorage only, never JSON (§2).
 */
export const BACKUP_FORMAT = 1
export const BACKUP_APP = 'dictateflow-ai'

/**
 * The app id this file was written under before the project was renamed. Only
 * ever accepted on import, never written — a backup the user made yesterday
 * has to keep importing tomorrow, or the export feature quietly broke the one
 * promise it makes.
 */
export const BACKUP_APP_LEGACY = ['wispr-ai', 'typeflow-ai'] as const

export interface BackupDictation {
  rawText: string
  finalText: string
  durationMs: number
  language: string
  providerId: string
  enhanced: boolean
  grammarFixes: number
  dictionaryFixes: number
  favorite: boolean
  createdAt: number
}

export interface BackupRule {
  from: string
  to: string
  hitCount: number
  createdAt: number
}

export interface BackupFile {
  app: typeof BACKUP_APP
  format: number
  exportedAt: string
  settings: Settings
  dictionary: BackupRule[]
  dictations: BackupDictation[]
}

export type TransferResult =
  | { status: 'cancelled' }
  | { status: 'error'; problem: string }
  | {
      status: 'done'
      path: string
      dictations: number
      dictionary: number
      /** Import only: rows already present, so not added twice. */
      skipped: number
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
  /** Open (or release) a capture stream before key-down. External mics are slow. */

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

/** Tabs in the settings dialog's own rail. */
export type SettingsTab = 'general' | 'transcription' | 'api' | 'data' | 'experimental' | 'about'

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
  'stats:rebuild': [void, void]
  'theme:get': [void, ResolvedTheme]
  'data:export': [void, TransferResult]
  'data:import': [void, TransferResult]
  'dictionary:list': [void, DictionaryDto[]]
  'dictionary:create': [NewDictionaryDto, DictionaryWrite]
  'dictionary:update': [{ id: number } & NewDictionaryDto, DictionaryWrite]
  'dictionary:delete': [number, boolean]
  'recordings:stats': [void, RecordingsStats]
  'recordings:clear': [void, RecordingsStats]
  'clipboard:write': [string, void]
  'apiKey:status': [void, ApiKeyStatus]
  'apiKey:set': [string, ApiKeyStatus]
  'apiKey:clear': [void, ApiKeyStatus]
  'widget:clip': [ClipPayload, void]
  'widget:micError': [{ name: string; message: string }, void]
  'widget:devices': [{ requestId: number; devices: AudioInputDevice[] }, void]
  'widget:devicesChanged': [AudioInputDevice[], void]
  'devices:list': [void, AudioInputDevice[]]
  'settings:open': [SettingsTab | undefined, void]
  'shortcut:suspend': [boolean, void]
  'app:info': [void, AppInfo]
  'moonshine:status': [MoonshineModelSize | undefined, MoonshineStatus]
  'moonshine:download': [MoonshineModelSize, MoonshineStatus]
  'moonshine:cancel': [void, MoonshineStatus]
  'moonshine:delete': [MoonshineModelSize, MoonshineStatus]
}

/**
 * Destinations in the main window. Settings is deliberately absent: it is a
 * dialog over whichever of these you are on, not a page of its own.
 */
export type AppRoute = 'history' | 'insights' | 'dictionary' | 'transform'

/** Channel -> payload for main-initiated pushes. See IPC_EVENT. */
export interface IpcEventMap {
  'widget:command': WidgetCommand
  'widget:state': WidgetStatePayload
  'widget:enumerate': { requestId: number }
  'dictations:changed': void
  'app:navigate': AppRoute
  'settings:navigate': SettingsTab
  /** main -> every renderer, including the widget: the resolved theme. */
  'app:theme': ResolvedTheme
  /**
   * Settings live in their own window, so anything else showing a setting —
   * the shortcut hint on the dictation page — would otherwise go stale the
   * moment it was rebound, with both windows visible at once.
   */
  'settings:changed': Settings
  'devices:changed': void
  /** main -> main window: local model download progress (§7.5). */
  'moonshine:progress': MoonshineProgress
  /** main -> main window: the model's state changed (ready, failed, deleted). */
  'moonshine:statusChanged': MoonshineStatus
}

/** §8 metric definitions — a word is a whitespace token, empties filtered. */
export function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length
}
