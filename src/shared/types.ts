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
  'transformProvider',
  'transformGroqModel',
  'transformGeminiModel',
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
  // Transform (docs/transform-feature-plan.md). One engine for every rule,
  // deliberately: the transcription engine works the same way, and a per-rule
  // provider means two more controls on every row for a choice nobody makes
  // twice. Groq is the default because a working install already has that key.
  transformProvider: 'groq',
  transformGroqModel: 'llama-3.3-70b-versatile',
  // MEASURED, not picked from a docs page. 690ms with thinking disabled, 1.57s
  // with it, against the seeded rule and a one-sentence input.
  //
  // `gemini-flash-latest` was the obvious choice — an alias that tracks the
  // current model can never go stale, which is exactly the failure this file
  // keeps having. It was tested and rejected: it returned 503 "high demand" on
  // the first call, took 10.5s on the second, and ignored a zero thinking
  // budget while doing it. An alias inherits whatever Google considers current,
  // and current is tuned for reasoning, not for a rewrite someone is watching a
  // spinner for.
  transformGeminiModel: 'gemini-2.5-flash',
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

/**
 * A transform rule, as it travels. Added in 1.1.0 WITHOUT bumping
 * `BACKUP_FORMAT`: the field is additive, an older build ignores what it does
 * not know, and a backup made yesterday has to keep importing tomorrow. That
 * is the one promise the export feature makes.
 */
export interface BackupTransform {
  name: string
  rule: string
  shortcut: string
  enabled: boolean
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
  /** Absent in any file written before 1.1.0. Treated as an empty list. */
  transforms?: BackupTransform[]
}

export type TransferResult =
  | { status: 'cancelled' }
  | { status: 'error'; problem: string }
  | {
      status: 'done'
      path: string
      dictations: number
      dictionary: number
      transforms: number
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

/* ----------------------------------------------------------- transform ---- */

/**
 * Transform — an LLM rewrite of text that is ALREADY in the focused field,
 * triggered by its own shortcut. See docs/transform-feature-plan.md.
 *
 * It is not part of the dictation pipeline and deliberately not a sibling of
 * the dictionary. The dictionary is deterministic, instant and free; a
 * transform is a network round trip that rewrites whatever it is handed. They
 * share a page in the sidebar because they are both "rules", and nothing else.
 */

export type TransformProviderId = 'groq' | 'gemini'

export interface TransformProviderSpec {
  id: TransformProviderId
  label: string
  /** Which stored secret it authenticates with. */
  secret: SecretId
  /** The settings key holding the chosen model for this provider. */
  modelKey: SettingKey
  hint: string
}

export const TRANSFORM_PROVIDERS: Record<TransformProviderId, TransformProviderSpec> = {
  groq: {
    id: 'groq',
    label: 'Groq',
    secret: 'groq',
    modelKey: 'transformGroqModel',
    hint: 'Fastest. Uses the same key as transcription, so there is nothing extra to set up.',
  },
  gemini: {
    id: 'gemini',
    label: 'Google Gemini',
    secret: 'gemini',
    modelKey: 'transformGeminiModel',
    hint: 'Stronger on long rewrites. Needs its own free key from Google AI Studio.',
  },
}

export const TRANSFORM_PROVIDER_IDS: TransformProviderId[] = ['groq', 'gemini']

export function isTransformProvider(value: string): value is TransformProviderId {
  return (TRANSFORM_PROVIDER_IDS as string[]).includes(value)
}

/** One entry in the model picker. `id` is what goes on the wire to the provider. */
export interface TransformModel {
  id: string
  label: string
}

/**
 * The models offered when the provider's own list cannot be fetched — no key
 * yet, no network, or the endpoint changed shape.
 *
 * Deliberately a FALLBACK and never the primary source. A hardcoded list of
 * model ids is wrong within months, and a picker offering a model the provider
 * has retired fails at the moment the user is trying to get work done.
 */
export const FALLBACK_TRANSFORM_MODELS: Record<TransformProviderId, TransformModel[]> = {
  groq: [
    { id: 'llama-3.3-70b-versatile', label: 'llama-3.3-70b-versatile' },
    { id: 'llama-3.1-8b-instant', label: 'llama-3.1-8b-instant' },
  ],
  gemini: [
    { id: 'gemini-2.5-flash', label: 'gemini-2.5-flash' },
    { id: 'gemini-2.5-flash-lite', label: 'gemini-2.5-flash-lite' },
    { id: 'gemini-2.5-pro', label: 'gemini-2.5-pro' },
  ],
}

/**
 * Model families that answer `generateContent` but cannot usefully rewrite text.
 *
 * MEASURED against the live model list, not guessed. Google returns image
 * generation (`nano-banana-pro-preview`, `*-image`), music (`lyria-*`),
 * robotics (`gemini-robotics-er-*`), computer use, research agents and native
 * audio models on the same endpoint, all advertising `generateContent` and all
 * carrying the same metadata shape as a chat model — there is no structural
 * field that separates them, so the name is the only signal available.
 *
 * This is a BLOCKLIST and blocklists rot. It rotted once already: the first
 * version knew about embedding, imagen, veo and TTS, and let image, music and
 * robotics models through into a text-rewrite picker. Assume it will rot again.
 *
 * That is survivable because it is not the last line of defence — picking a
 * model that cannot rewrite text produces an honest widget error, not silence.
 * Keep this list as a convenience, never as a guarantee.
 */
/**
 * Put the models we would actually recommend at the top of the picker.
 *
 * The list used to be a plain `.sort()`, and alphabetical order put Groq's
 * `allam-2-7b` — a 7B Arabic-focused model — at the very top. A user picked it,
 * because the first item in a list is what people pick, and got a transform
 * that handed their text straight back.
 *
 * Alphabetical is not neutral. It is an opinion about which model matters most,
 * expressed accidentally, and on this list it was the wrong one. The fallback
 * table is already the app's stated recommendation, so it becomes the order:
 * those ids first, in their listed order, then everything else alphabetically.
 *
 * Nothing is hidden. A model that is not recommended is still one scroll away —
 * ordering is a suggestion, and blocklisting by name is the mistake this file
 * has already made twice (see NON_TEXT_MODEL_PATTERN).
 */
export function orderTransformModels(
  ids: string[],
  provider: TransformProviderId,
): TransformModel[] {
  const preferred = FALLBACK_TRANSFORM_MODELS[provider].map((m) => m.id)
  const rank = (id: string): number => {
    const at = preferred.indexOf(id)
    return at === -1 ? preferred.length : at
  }
  return [...ids]
    .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
    .map((id) => ({ id, label: id }))
}

export const NON_TEXT_MODEL_PATTERN =
  /embedding|aqa|imagen|veo|lyria|nano-banana|robotics|computer-use|deep-research|antigravity|image|tts|audio/i

/** Wire-safe transform rule. `createdAt` is epoch ms, not a Date. */
export interface TransformDto {
  id: number
  name: string
  /** The user's instruction. It becomes part of the system prompt, never the user turn. */
  rule: string
  /** uiohook key names joined by '+', same wire format as `shortcut`. '' = unbound. */
  shortcut: string
  enabled: boolean
  hitCount: number
  sortOrder: number
  createdAt: number
}

export interface NewTransformDto {
  name: string
  rule: string
  shortcut: string
  enabled?: boolean
}

/**
 * Writes answer with a reason instead of rejecting, for the same reason
 * `DictionaryWrite` does: a shortcut clash is an expected answer, not an
 * exception, and "Error invoking remote method" is not copy §12 would allow.
 */
export type TransformWrite =
  | { ok: true; entry: TransformDto }
  | { ok: false; problem: string }

/** Longest rule worth sending. Past this it is a document, not an instruction. */
export const MAX_TRANSFORM_RULE = 4000

/** Shared by the form and the IPC handler, so the two cannot disagree. */
export function validateTransform(name: string, rule: string): string | null {
  if (!name.trim()) return 'Give the transform a name.'
  if (!rule.trim()) return 'Write the rule this transform should follow.'
  if (rule.trim().length > MAX_TRANSFORM_RULE) {
    return `Keep the rule under ${MAX_TRANSFORM_RULE} characters.`
  }
  return null
}

/**
 * The rule seeded on first run (docs/transform-feature-plan.md §3.1).
 *
 * Exported so the migration, the docs and the "restore the default" affordance
 * all quote the same text rather than three drifting copies.
 */
export const DEFAULT_TRANSFORM_NAME = 'Enhance prompt'
export const DEFAULT_TRANSFORM_SHORTCUT = 'Ctrl+Alt+E'
/**
 * MEASURED failure, and the reason this text reads the way it does.
 *
 * The first version ended "If the text is already a good prompt, return it
 * close to unchanged." Both Groq and Gemini returned a dictated request
 * VERBATIM — every word identical, including the spoken-English slips. The
 * models were not disobeying. A dictated request that states a goal and asks a
 * question genuinely reads as "already a good prompt", so the rule's own escape
 * hatch was the correct branch to take, and a transform that changes nothing is
 * indistinguishable from one that never ran.
 *
 * The mistake was importing §4's caution into a step it does not apply to. §4
 * is about grammar cleanup, which is only allowed to fix grammar and was caught
 * deleting words. A transform is asked to restructure — hedging against change
 * removes the only thing it does.
 *
 * So: restructuring is now mandatory and stated twice, the escape hatch is
 * gone, and the output has a required SHAPE. A shape is what makes "did it
 * work?" answerable at a glance.
 */
export const DEFAULT_TRANSFORM_RULE = [
  'Rewrite the text as a clear, well-structured prompt for an AI assistant.',
  '',
  'Always restructure it. Never return the text unchanged or nearly unchanged,',
  'even if it already reads well - reshaping it is the entire purpose of this',
  'rewrite, and returning it as-is is a failure.',
  '',
  'The text was dictated aloud, so fix the grammar, the false starts and the',
  'half-finished sentences that come from speaking rather than typing.',
  '',
  'Write it in the first person, as the author speaking. Never describe them',
  'from the outside - no "the user is", no "the author wants". This goes',
  'straight into their chat box as their own words.',
  '',
  'Produce, in this order:',
  '- one sentence stating exactly what is being asked for',
  '- any background they gave about themselves or their situation, in their voice',
  '- a short bulleted list of what the answer must cover, one bullet per thing',
  '  they asked about',
  '',
  'Keep every requirement, constraint, name, number and piece of context the',
  'author gave. Add no requirement they did not state. Never answer the request',
  'itself. Return only the rewritten prompt.',
].join('\n')


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
  /* Transform (docs/transform-feature-plan.md §8). Three states rather than
     reusing `processing`/`success`, because the widget is the only feedback
     the user gets and "Transcribing…" during a transform is a lie. Every OTHER
     failure state above is reused verbatim — a 429 is a 429. */
  | 'transforming'
  | 'no-text'
  | 'transformed'

export interface WidgetStatePayload {
  state: WidgetState
  /** Only read for `error`. The other states have fixed copy (§12). */
  message?: string
  /**
   * The transform's name, for `transforming`. The user can have several rules
   * bound to several combos, so "Transforming…" would not tell them which one
   * fired — and firing the wrong one is the mistake worth catching early.
   */
  detail?: string
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

/**
 * The secrets the app can hold. Both are stored through `safeStorage` and
 * neither is ever written to the settings table or an export (§2).
 *
 * Gemini exists only because Transform can use it. Transcription is still Groq
 * or the local engine, and nothing here changes that.
 */
export type SecretId = 'groq' | 'gemini'

export interface SecretSpec {
  id: SecretId
  label: string
  /**
   * Placeholder text for the field. A HINT, not a rule.
   *
   * This used to be a `prefix` that `setApiKey` rejected on, and that was a
   * bug: it was written from memory as `AIza` for Gemini, and Google also
   * issues keys beginning `AQ.` — so a perfectly valid key was refused with a
   * confident message telling the user their key was malformed. Guessing at a
   * credential's shape is guessing at another company's release schedule, and
   * losing that guess fails CLOSED, which is the worst way to be wrong.
   *
   * Validity is decided by ASKING the provider (`apiKey:verify`), which is the
   * only party that can actually answer.
   */
  hint: string
  /** Where the user gets one. Shown as text — the settings window opens no links. */
  console: string
}

export const SECRETS: Record<SecretId, SecretSpec> = {
  groq: {
    id: 'groq',
    label: 'Groq API key',
    hint: 'gsk_…',
    console: 'console.groq.com',
  },
  gemini: {
    id: 'gemini',
    label: 'Gemini API key',
    // Both formats are live. MEASURED against the API, not remembered.
    hint: 'AQ.… or AIza…',
    console: 'aistudio.google.com/apikey',
  },
}

/**
 * The shortest thing that could plausibly be a key.
 *
 * Deliberately loose. It catches an empty field and a stray word; it does not
 * try to RECOGNISE a key, because that is what verification is for and what
 * the prefix check got wrong.
 */
export const MIN_API_KEY_LENGTH = 20

/**
 * What happened when we asked a provider whether a key works.
 *
 * `unreachable` is a distinct answer from `rejected`, and the distinction is
 * the whole point: a key saved on a train is not a bad key, and telling the
 * user it was rejected would send them off to regenerate a credential that is
 * perfectly fine.
 */
export type KeyCheck =
  | { state: 'ok' }
  | { state: 'rejected'; problem: string }
  | { state: 'unreachable'; problem: string }

export interface ApiKeyStatus {
  /** Which secret this describes. Present so one handler can serve both. */
  id: SecretId
  present: boolean
  /** Whether the OS actually offers encryption. False means we refuse to store. */
  encryptionAvailable: boolean
}

/* ----------------------------------------------------------- settings ---- */

/** Tabs in the settings dialog's own rail. */
export type SettingsTab =
  | 'general'
  | 'transcription'
  | 'transform'
  | 'api'
  | 'data'
  | 'experimental'
  | 'about'

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
  // Keyed rather than bare, because there are two secrets now. The id travels
  // in both directions so a reply can never be applied to the wrong card.
  'apiKey:status': [SecretId, ApiKeyStatus]
  'apiKey:set': [{ id: SecretId; key: string }, ApiKeyStatus]
  'apiKey:clear': [SecretId, ApiKeyStatus]
  /** Asks the provider whether the stored key actually works. Never throws. */
  'apiKey:verify': [SecretId, KeyCheck]
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
  'transforms:list': [void, TransformDto[]]
  'transforms:create': [NewTransformDto, TransformWrite]
  'transforms:update': [{ id: number } & NewTransformDto, TransformWrite]
  'transforms:delete': [number, boolean]
  /** Live from the provider, so the picker cannot offer a retired model. */
  'transforms:models': [TransformProviderId, TransformModel[]]
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
  /**
   * main -> main window: a transform ran, so its hit count moved.
   *
   * This entry went missing once, and nothing caught it. The channel existed in
   * IPC_EVENT, was sent by broadcast.ts and listened for in the preload — and it
   * all worked, because `webContents.send` takes an untyped string. This map is
   * the only place the contract is written down, so an omission here is
   * invisible until a renderer quietly stops updating. `sendToWindows` in
   * broadcast.ts now goes through the map so it cannot happen again.
   */
  'transforms:changed': void
}

/** §8 metric definitions — a word is a whitespace token, empties filtered. */
export function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length
}
