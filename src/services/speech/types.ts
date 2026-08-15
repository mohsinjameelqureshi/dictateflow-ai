/**
 * The speech-to-text boundary (§7).
 *
 * Groq's free tier could change, and NVIDIA Parakeet and local whisper.cpp
 * exist. Everything above this interface is provider-agnostic so that
 * swapping is a one-line change in `index.ts` rather than a rewrite.
 */

export interface TranscribeOptions {
  language?: string
  /**
   * Phrased as natural speech, never as an instruction (§6.5). Whisper's
   * prompt is a continuation hint: "Terms: TypeScript, Electron" was
   * MEASURED being transcribed verbatim into the output.
   */
  vocabularyHint?: string
  /** Esc must cancel during upload and transcription, not just recording. */
  signal?: AbortSignal
}

export interface TranscribeResult {
  text: string
  /** Wall-clock for the provider call. Feeds the §15.1 latency question. */
  durationMs: number
  providerId: string
}

export interface SpeechProvider {
  readonly id: string
  readonly label: string
  readonly requiresNetwork: boolean
  /**
   * Whether `vocabularyHint` means anything to this provider.
   *
   * Whisper takes a continuation hint and can echo it into the transcript
   * (§6.5), which is why the caller also has to strip it afterwards. A provider
   * that never sees the hint must not have that stripping applied to its
   * output, so the caller checks this rather than passing a hint to everyone
   * and hoping it is ignored.
   */
  readonly acceptsVocabularyHint: boolean
  transcribe(audio: Buffer, opts: TranscribeOptions): Promise<TranscribeResult>
}

/**
 * Failure kinds that map onto a widget state (§11). Anything a provider
 * cannot classify becomes `unknown`, which surfaces as the generic error
 * state rather than a silent stall.
 */
export type SpeechErrorKind =
  | 'offline'
  | 'rate-limited'
  | 'unauthorized'
  | 'no-key'
  /** Local engine only: the model is missing, partial or corrupted on disk. */
  | 'no-model'
  | 'cancelled'
  | 'too-large'
  | 'unknown'

export class SpeechError extends Error {
  constructor(
    readonly kind: SpeechErrorKind,
    message: string,
    override readonly cause?: unknown,
  ) {
    super(message)
    this.name = 'SpeechError'
  }
}
