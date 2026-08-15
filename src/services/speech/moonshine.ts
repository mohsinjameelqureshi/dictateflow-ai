import { moonshineReady, transcribeWav } from '../../main/moonshine/host.js'
import {
  SpeechError,
  type SpeechProvider,
  type TranscribeOptions,
  type TranscribeResult,
} from './types.js'

/**
 * Moonshine, running on this machine.
 *
 * No API key, no account, and nothing leaves the device — which is the whole
 * point of it existing alongside Groq. The inference itself happens in a
 * utilityProcess; this class is the boundary that lets `session.ts` stay
 * provider-agnostic.
 *
 * English only. That is a LICENSING constraint rather than a product one — the
 * English weights are MIT, every other language is community-licensed and
 * non-commercial — so `opts.language` is deliberately ignored rather than
 * forwarded. The user's Groq language setting is left untouched, which is what
 * makes switching engines lossless.
 */
export class MoonshineSpeechProvider implements SpeechProvider {
  readonly id = 'moonshine'
  readonly label = 'Moonshine · on this device'
  readonly requiresNetwork = false
  /**
   * False for now. Moonshine has something strictly better than a continuation
   * hint — `setKeyterms`, which biases the decoder directly and is VERIFIED
   * working on this architecture — but wiring the dictionary into it is Phase 4.
   * Until then the hint is not built, so §6.5's stripping never runs on output
   * that could not contain a leak.
   */
  readonly acceptsVocabularyHint = false

  async transcribe(audio: Buffer, opts: TranscribeOptions): Promise<TranscribeResult> {
    // The model is hundreds of MB and is fetched on demand, so "not downloaded
    // yet" is an ordinary state rather than a fault. Say what to do about it.
    if (!moonshineReady()) {
      throw new SpeechError(
        'no-model',
        'The local model is not downloaded. Open Settings to get it.',
      )
    }

    const startedAt = Date.now()
    try {
      // Esc during transcription: the worker cannot abort a pass mid-flight,
      // so the signal is honoured here by discarding the result. The session
      // has already moved on by then, and a wasted pass is cheaper than the
      // machinery to interrupt one.
      const result = await transcribeWav(new Uint8Array(audio))
      if (opts.signal?.aborted) throw new SpeechError('cancelled', 'Cancelled.')

      return {
        text: result.text.trim(),
        durationMs: Date.now() - startedAt,
        providerId: this.id,
      }
    } catch (err) {
      throw classify(err)
    }
  }
}

function classify(err: unknown): SpeechError {
  if (err instanceof SpeechError) return err

  const message = err instanceof Error ? err.message : String(err)
  if (err instanceof Error && (err.name === 'cancelled' || err.name === 'AbortError')) {
    return new SpeechError('cancelled', 'Cancelled.', err)
  }
  // Every remaining failure is local — a missing file, a corrupted model, a
  // dead worker. None of them are network conditions, so none of them map onto
  // the offline or rate-limited widget states.
  if (/incomplete|corrupted|not loaded|re-download/i.test(message)) {
    return new SpeechError('no-model', message, err)
  }
  return new SpeechError('unknown', message, err)
}
