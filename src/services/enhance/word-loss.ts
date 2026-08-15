/**
 * §10 — the word-loss detector.
 *
 * Required whenever enhancement is enabled, and the reason the feature can
 * ship at all. §4 measured the LLM deleting a word from the same sentence on
 * three consecutive runs, including with an explicit `NEVER DELETE A WORD`
 * instruction, and diagnosed why: Whisper's output is genuinely ungrammatical,
 * so making it coherent REQUIRES cutting something. That is not a prompt bug
 * and no prompt fixes it.
 *
 * So the model is not trusted to obey. It is checked. But the check has to
 * separate two things a naive comparison cannot:
 *
 *   "I have saw that movie for three times"
 *     -> "I have seen that movie three times"
 *
 * `saw` became `seen` and `for` went away, and BOTH are the correction. A
 * detector that counts missing words rejects this — MEASURED, it reported
 * ["saw", "for"] and threw away a perfect result.
 *
 *   "...that interface, training create the possibility..."
 *     -> "...that interface creates the possibility..."
 *
 * Here `create` became `creates` and `training` went away, and only the second
 * one is a fault. The words tell you nothing; the ALIGNMENT does. So the text
 * is aligned first, and only words that align to nothing are losses at all.
 * Of those, function words and disfluencies are the ones whose removal is
 * ordinarily the fix; anything else means the model rewrote, and the pass is
 * discarded in favour of the raw transcript.
 */

/**
 * Case- and punctuation-insensitive, because those are exactly what the model
 * is being ASKED to change. Apostrophes survive so "don't" stays one word.
 */
const norm = (s: string): string[] =>
  s
    .toLowerCase()
    .replace(/[^\w\s']/g, '')
    .split(/\s+/)
    .filter(Boolean)

/**
 * Close enough to be the same word wearing a different ending.
 *
 * Four characters of shared opening plus a small length gap covers
 * create/creates, interface/interfaces and possibility/possibilities. It does
 * NOT cover saw/seen — nothing lexical does — which is why this only feeds the
 * alignment's cost function rather than deciding anything on its own.
 */
const MIN_STEM = 4
const MAX_LEN_GAP = 3

function sameWord(a: string, b: string): boolean {
  if (a === b) return true
  if (Math.abs(a.length - b.length) > MAX_LEN_GAP) return false
  if (a.length < MIN_STEM || b.length < MIN_STEM) return false
  return a.slice(0, MIN_STEM) === b.slice(0, MIN_STEM)
}

/**
 * Words whose removal is ordinarily the correction rather than a loss.
 *
 * Articles, prepositions and conjunctions — "for three times" -> "three
 * times" — plus the disfluencies that dictation is full of. Deliberately does
 * NOT include intensifiers like "very" or "really", or any verb: those carry
 * meaning, and losing one changes what the speaker said.
 */
const DELETABLE = new Set([
  'a', 'an', 'the',
  'of', 'for', 'to', 'in', 'on', 'at', 'by', 'with', 'from', 'into', 'onto',
  'and', 'or', 'but', 'so', 'that', 'as', 'than', 'then', 'there',
  'um', 'uh', 'erm', 'er', 'ah', 'oh', 'hmm', 'mm',
  'like', 'yeah', 'yep', 'okay', 'ok', 'anyway', 'basically', 'actually', 'literally',
])

export interface LossReport {
  /** Raw words the alignment shows as removed outright, not replaced. */
  deleted: string[]
  /**
   * The subset that is not safe to lose. Non-empty means discard the pass —
   * this is the §4 failure, and the only thing the caller acts on.
   */
  unsafe: string[]
}

/**
 * Beyond this the full alignment matrix stops being worth the memory, and a
 * dictation that long has bigger problems than a grammar pass. Falls back to
 * treating nothing as aligned, which rejects rather than waves through.
 */
const MAX_ALIGN_WORDS = 4000

export function analyseLoss(raw: string, clean: string): LossReport {
  const x = norm(raw)
  const y = norm(clean)

  if (x.length === 0) return { deleted: [], unsafe: [] }
  if (y.length === 0) return { deleted: [...x], unsafe: x.filter(unsafeToLose) }
  if (x.length > MAX_ALIGN_WORDS || y.length > MAX_ALIGN_WORDS) {
    const missing = multisetMissing(x, y)
    return { deleted: missing, unsafe: missing.filter(unsafeToLose) }
  }

  const deleted = deletedWords(x, y)
  return { deleted, unsafe: deleted.filter(unsafeToLose) }
}

function unsafeToLose(word: string): boolean {
  return !DELETABLE.has(word)
}

/**
 * Levenshtein with a backtrace, so a word that was REPLACED is distinguished
 * from a word that was REMOVED. That distinction is the whole detector.
 */
function deletedWords(x: string[], y: string[]): string[] {
  const n = x.length
  const m = y.length
  const w = m + 1
  const d = new Int32Array((n + 1) * w)

  for (let j = 0; j <= m; j++) d[j] = j
  for (let i = 1; i <= n; i++) {
    d[i * w] = i
    for (let j = 1; j <= m; j++) {
      const cost = sameWord(x[i - 1] as string, y[j - 1] as string) ? 0 : 1
      d[i * w + j] = Math.min(
        (d[(i - 1) * w + j] as number) + 1, // x[i-1] deleted
        (d[i * w + j - 1] as number) + 1, // y[j-1] inserted
        (d[(i - 1) * w + j - 1] as number) + cost, // substituted or matched
      )
    }
  }

  const out: string[] = []
  let i = n
  let j = m
  while (i > 0) {
    if (j > 0) {
      const cost = sameWord(x[i - 1] as string, y[j - 1] as string) ? 0 : 1
      // Substitution is tested first so a tie resolves to "replaced" rather
      // than "removed". §4's own case does not depend on the tiebreak — there
      // the deletion path is strictly cheaper — but "I have saw" -> "I have
      // seen" does, and calling that a deletion is what broke it before.
      if (d[i * w + j] === (d[(i - 1) * w + j - 1] as number) + cost) {
        i--
        j--
        continue
      }
      if (d[i * w + j] === (d[i * w + j - 1] as number) + 1) {
        j--
        continue
      }
    }
    out.push(x[i - 1] as string)
    i--
  }

  return out.reverse()
}

/** The old multiset comparison, kept only for pathologically long input. */
function multisetMissing(x: string[], y: string[]): string[] {
  const after = new Map<string, number>()
  for (const word of y) after.set(word, (after.get(word) ?? 0) + 1)

  const lost: string[] = []
  for (const word of x) {
    const n = after.get(word) ?? 0
    if (n === 0) lost.push(word)
    else after.set(word, n - 1)
  }
  return lost
}

/**
 * §8's "grammar fixes" metric: word-level Levenshtein distance.
 *
 * Two rows rather than the full matrix — this one needs no backtrace, and a
 * long dictation runs it on the insert path where the user is waiting.
 */
export function wordEdits(a: string, b: string): number {
  const x = norm(a)
  const y = norm(b)
  if (x.length === 0) return y.length
  if (y.length === 0) return x.length

  let prev: number[] = Array.from({ length: y.length + 1 }, (_, j) => j)
  let curr: number[] = new Array<number>(y.length + 1).fill(0)

  for (let i = 1; i <= x.length; i++) {
    curr[0] = i
    for (let j = 1; j <= y.length; j++) {
      curr[j] =
        x[i - 1] === y[j - 1]
          ? (prev[j - 1] as number)
          : 1 + Math.min(prev[j] as number, curr[j - 1] as number, prev[j - 1] as number)
    }
    const swap = prev
    prev = curr
    curr = swap
  }

  return prev[y.length] as number
}
