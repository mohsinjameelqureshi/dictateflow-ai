/**
 * The grammar-cleanup boundary (§4, §7).
 *
 * Shaped like `services/speech/types.ts` on purpose: one interface, one
 * implementation, swappable without a rewrite. The difference is what happens
 * when it fails — a speech provider failing means there is no text, so it
 * throws and the widget shows a state. A cleanup provider failing means there
 * is still perfectly good text, so nothing here is allowed to take the
 * dictation down with it.
 */

export interface EnhanceOptions {
  /** Esc must cancel during the cleanup call, not just during recording. */
  signal?: AbortSignal
}

export interface EnhanceProvider {
  readonly id: string
  readonly label: string
  /**
   * Return the corrected text, or the input unchanged if there was nothing to
   * do. Implementations do NOT judge their own output — the word-loss gate in
   * `index.ts` is what decides whether the result is usable.
   */
  clean(text: string, opts: EnhanceOptions): Promise<string>
}

/** Why a cleanup pass did not produce usable text. Logged, never shown. */
export type EnhanceRejection =
  /** §10 — the model dropped words. The failure this whole file exists for. */
  | 'word-loss'
  /** Empty, whitespace, or a null completion. */
  | 'empty'
  /** Network, 429, auth, abort. Anything that never returned. */
  | 'failed'

export interface EnhanceResult {
  /**
   * The text to actually use. Equals the input whenever the pass was rejected,
   * which is the entire safety property: §4 measured this step deleting words,
   * so the default has to be that nothing happened.
   */
  text: string
  /** True only when the model's output was accepted. Stored on the row. */
  enhanced: boolean
  /** §8 — word-level Levenshtein across the accepted pass. 0 when rejected. */
  fixes: number
  /** Set when `enhanced` is false and a pass was actually attempted. */
  rejection?: EnhanceRejection
  /** The words the model lost, when that is why it was rejected. */
  dropped: string[]
  /** Wall-clock for the call. §3 measured this step at 260–310ms. */
  durationMs: number
}
