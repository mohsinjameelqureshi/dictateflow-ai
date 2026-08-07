/**
 * Personal dictionary — deterministic replacement (§9).
 *
 * Ships in v1 because it is instant, free, and fixes the exact proper-noun
 * failures observed in testing. Wispr Flow transcribed "Groq" as "grog"
 * during the same session; this is the cheap fix for that class of error.
 *
 * **Ordering matters:** run this AFTER any LLM step, never before, or the LLM
 * "corrects" the corrections back into errors.
 */

export interface DictionaryRule {
  id: number
  from: string
  to: string
}

export interface DictionaryResult {
  text: string
  /** §8 — count of replacements that actually fired, not rules considered. */
  fixes: number
  /** Rule ids that matched, for the `hit_count` bump. */
  hitIds: number[]
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Whisper decides capitalisation from sentence position, so matching is
 * case-insensitive — but a replacement at the start of a sentence has to keep
 * its capital or the fix introduces a new error.
 */
function matchCase(replacement: string, matched: string): string {
  const first = matched[0]
  if (!first || first !== first.toUpperCase() || first === first.toLowerCase()) {
    return replacement
  }
  return replacement.charAt(0).toUpperCase() + replacement.slice(1)
}

export function applyDictionary(text: string, rules: DictionaryRule[]): DictionaryResult {
  let out = text
  let fixes = 0
  const hitIds: number[] = []

  for (const rule of rules) {
    if (!rule.from.trim()) continue

    // Word boundaries stop "cat" rewriting the middle of "concatenate".
    // \b is unreliable next to punctuation in phrases, so the boundary is
    // asserted against whitespace and string edges instead.
    const pattern = new RegExp(`(^|[^\\p{L}\\p{N}'])(${escape(rule.from)})(?=$|[^\\p{L}\\p{N}'])`, 'giu')

    out = out.replace(pattern, (_m, lead: string, matched: string) => {
      fixes += 1
      if (!hitIds.includes(rule.id)) hitIds.push(rule.id)
      return lead + matchCase(rule.to, matched)
    })
  }

  return { text: out, fixes, hitIds }
}

/**
 * §6.5 — Whisper's `prompt` is a continuation hint, not an instruction.
 *
 * MEASURED failure: `"Technical dictation. Terms: TypeScript, Electron..."`
 * was transcribed verbatim into the output as "Terms & Tm.". Phrasing it as
 * natural speech is what stops that. Preventing the error beats correcting it.
 */
export function buildVocabularyHint(rules: DictionaryRule[]): string | undefined {
  const terms = [...new Set(rules.map((r) => r.to.trim()).filter(Boolean))]
  if (terms.length === 0) return undefined

  // Whisper's prompt window is ~224 tokens; a runaway dictionary would push
  // the audio's own context out.
  const capped = terms.slice(0, 40)
  const list =
    capped.length === 1
      ? capped[0]
      : `${capped.slice(0, -1).join(', ')}, and ${capped[capped.length - 1]}`

  return `${HINT_PREFIX} ${list}.`
}

/**
 * The boilerplate opening, shared by every hint. Named because the leak
 * detector below has to know where the generic part ends and the user's own
 * terms begin — matching the opening proves nothing.
 */
const HINT_PREFIX = "I'm dictating notes about"

/**
 * Cut the vocabulary hint back out if Whisper transcribed it.
 *
 * §6.5 is a MEASURED failure: the prompt `"Technical dictation. Terms:
 * TypeScript, Electron..."` came back inside the transcript as `"Terms & Tm."`.
 * Phrasing it as natural speech makes that rare, not impossible — the prompt
 * is a continuation hint, and a model given one can always continue it.
 *
 * The consequence here is worse than in a test script. This text goes to the
 * clipboard and is pasted into whatever the user was typing into, so a leak
 * means our sentence lands in their document.
 *
 * The bar is deliberately high, because §4 is emphatic that silently deleting
 * words is the worst failure this app can have. The evidence has to come from
 * the TERM LIST, never from the opening: "I'm dictating notes about" is
 * ordinary English that someone really could say, and with a one-term
 * dictionary that opening is four fifths of the whole hint — a ratio test on
 * its own would have eaten "I'm dictating notes about the weekend" and left
 * "the weekend". So a strip requires either the entire hint, or a match that
 * runs past the opening into the user's own terms and still covers most of it.
 */
const MIN_LEAK_RATIO = 0.7

const bare = (word: string) => word.toLowerCase().replace(/[^\p{L}\p{N}']/gu, '')

export function stripVocabularyHint(
  text: string,
  hint: string | undefined,
): { text: string; stripped: number } {
  if (!hint) return { text, stripped: 0 }

  const hintWords = (hint.match(/\S+/g) ?? []).map(bare).filter(Boolean)
  if (hintWords.length === 0) return { text, stripped: 0 }

  // Compared on normalised words but sliced on the ORIGINAL tokens, so the
  // surviving text keeps its punctuation and capitalisation untouched.
  const tokens = text.match(/\S+/g) ?? []

  let matched = 0
  while (
    matched < tokens.length &&
    matched < hintWords.length &&
    bare(tokens[matched] ?? '') === hintWords[matched]
  ) {
    matched += 1
  }

  // The whole hint came back — the terms are all there, so it is a leak.
  const whole = matched === hintWords.length

  // Or a mangled leak: it ran past the boilerplate into the user's own terms
  // and still covers most of the sentence. `>` not `>=` is the load-bearing
  // part — matching the opening exactly and stopping is ordinary speech.
  const prefixWords = HINT_PREFIX.split(/\s+/).length
  const partial = matched > prefixWords && matched / hintWords.length >= MIN_LEAK_RATIO

  if (!whole && !partial) return { text, stripped: 0 }

  return { text: tokens.slice(matched).join(' '), stripped: matched }
}
