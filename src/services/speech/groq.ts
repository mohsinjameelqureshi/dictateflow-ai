import Groq, {
  APIConnectionError,
  APIUserAbortError,
  AuthenticationError,
  RateLimitError,
  toFile,
} from 'groq-sdk'
import { SpeechError, type SpeechProvider, type TranscribeOptions, type TranscribeResult } from './types.js'

const MODEL = 'whisper-large-v3-turbo'

/** Groq rejects uploads over 25MB. A 16kHz mono WAV reaches it near 13 min (§15.4). */
const MAX_BYTES = 25 * 1024 * 1024

/**
 * Groq Whisper Turbo.
 *
 * §3 measured ~95% of the 1900ms as network round-trip, TLS handshake and
 * free-tier queue time rather than compute. The client is therefore built
 * ONCE and reused for the life of the process — that is the §15.1 hypothesis,
 * and it only holds if nothing here constructs a second one per request.
 */
export class GroqSpeechProvider implements SpeechProvider {
  readonly id = 'groq'
  readonly label = 'Groq · Whisper Large v3 Turbo'
  readonly requiresNetwork = true

  #client: Groq
  #apiKey: string

  constructor(apiKey: string) {
    this.#apiKey = apiKey
    this.#client = new Groq({ apiKey, maxRetries: 0 })
  }

  /** Swap the key without discarding the module — but the connection pool resets. */
  setApiKey(apiKey: string): void {
    if (apiKey === this.#apiKey) return
    this.#apiKey = apiKey
    this.#client = new Groq({ apiKey, maxRetries: 0 })
  }

  async transcribe(audio: Buffer, opts: TranscribeOptions): Promise<TranscribeResult> {
    if (audio.byteLength > MAX_BYTES) {
      throw new SpeechError(
        'too-large',
        `Recording is ${(audio.byteLength / 1024 / 1024).toFixed(1)}MB. The limit is 25MB.`,
      )
    }

    const startedAt = Date.now()
    try {
      const res = await this.#client.audio.transcriptions.create(
        {
          file: await toFile(audio, 'clip.wav', { type: 'audio/wav' }),
          model: MODEL,
          response_format: 'json',
          // Pinned rather than left to the provider's default. The same clip
          // should transcribe to the same words every time — otherwise the
          // dictionary's hit counts, the §15 benchmarks and any "did that
          // change help?" comparison are all measuring sampling noise.
          temperature: 0,
          // Passing the language skips detection and is slightly faster.
          ...(opts.language ? { language: opts.language } : {}),
          ...(opts.vocabularyHint ? { prompt: opts.vocabularyHint } : {}),
        },
        { signal: opts.signal },
      )

      return {
        text: res.text.trim(),
        durationMs: Date.now() - startedAt,
        providerId: this.id,
      }
    } catch (err) {
      throw classify(err)
    }
  }
}

/**
 * Map SDK failures onto the widget states in §11. Retries are disabled above
 * so that a 429 surfaces immediately instead of the user staring at
 * "Transcribing…" through a backoff they cannot see.
 */
function classify(err: unknown): SpeechError {
  if (err instanceof SpeechError) return err

  if (err instanceof APIUserAbortError) {
    return new SpeechError('cancelled', 'Cancelled.', err)
  }
  if (err instanceof RateLimitError) {
    return new SpeechError('rate-limited', 'Rate limited — try again.', err)
  }
  if (err instanceof AuthenticationError) {
    return new SpeechError('unauthorized', 'Groq rejected the API key.', err)
  }
  if (err instanceof APIConnectionError) {
    return new SpeechError('offline', 'No connection.', err)
  }

  // AbortError arrives raw when the signal fires before the SDK wraps it.
  if (err instanceof Error && err.name === 'AbortError') {
    return new SpeechError('cancelled', 'Cancelled.', err)
  }

  const message = err instanceof Error ? err.message : String(err)
  return new SpeechError('unknown', message, err)
}
