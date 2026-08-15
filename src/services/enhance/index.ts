import { GroqLlamaEnhanceProvider } from './groq-llama.js'
import type { EnhanceResult } from './types.js'
import { analyseLoss, wordEdits } from './word-loss.js'

export * from './types.js'
export { analyseLoss, wordEdits } from './word-loss.js'

/**
 * Grammar cleanup, with §10's word-loss detector as a hard gate.
 *
 * The Phase 0 test script that produced the §4 measurement already computed
 * `droppedWords` — and then only printed a warning, still reporting the
 * cleaned text as the answer. In a test harness that is correct, because a
 * human is reading the output. On the insert path nobody is reading: the text
 * goes straight to the clipboard and into whatever the user was typing into.
 * So here the detector decides rather than reports.
 *
 * Everything below fails toward the raw transcript. A rejected pass, a dead
 * network, a 429, a refusal — all of them return the input unchanged, and the
 * dictation continues as though the feature were off. Cleanup is an
 * improvement on text that already exists; it never gets to destroy it.
 */

let provider: GroqLlamaEnhanceProvider | null = null

function getProvider(apiKey: string): GroqLlamaEnhanceProvider {
  if (provider) provider.setApiKey(apiKey)
  else provider = new GroqLlamaEnhanceProvider(apiKey)
  return provider
}

/** Called when the key changes or is cleared, so the next call rebuilds. */
export function resetEnhanceProvider(): void {
  provider = null
}

export async function enhanceText(
  raw: string,
  apiKey: string,
  signal?: AbortSignal,
): Promise<EnhanceResult> {
  const startedAt = Date.now()
  const unchanged = (rejection: EnhanceResult['rejection'], dropped: string[] = []): EnhanceResult => ({
    text: raw,
    enhanced: false,
    fixes: 0,
    ...(rejection ? { rejection } : {}),
    dropped,
    durationMs: Date.now() - startedAt,
  })

  let clean: string
  try {
    clean = await getProvider(apiKey).clean(raw, { ...(signal ? { signal } : {}) })
  } catch (err) {
    // Deliberately swallowed. The transcript is already good; a cleanup that
    // could turn a working dictation into an error state would be a worse
    // feature than no cleanup at all.
    console.warn('[enhance] cleanup call failed, using the raw transcript:', err)
    return unchanged('failed')
  }

  if (!clean.trim()) return unchanged('empty')

  // §10 — the whole reason this is safe to ship. Only words the alignment
  // shows as REMOVED count, and only those that carry meaning: dropping "for"
  // out of "for three times" is the correction, dropping "training" is §4.
  const loss = analyseLoss(raw, clean)
  if (loss.unsafe.length > 0) {
    console.warn(
      `[enhance] rejected: the model removed ${loss.unsafe.length} word(s) — ${loss.unsafe.join(', ')}`,
    )
    return unchanged('word-loss', loss.unsafe)
  }
  if (loss.deleted.length > 0) {
    // Accepted, but say what went: these are the function words and fillers
    // the pass is allowed to remove, and seeing them is how you find out the
    // list needs adjusting.
    console.info(`[enhance] removed filler: ${loss.deleted.join(', ')}`)
  }

  return {
    text: clean,
    enhanced: true,
    // §8 — measured across the cleanup step alone. Dictionary replacements are
    // counted separately as `dictionaryFixes`, so folding them in here would
    // report the same edit twice.
    fixes: wordEdits(raw, clean),
    dropped: [],
    durationMs: Date.now() - startedAt,
  }
}
