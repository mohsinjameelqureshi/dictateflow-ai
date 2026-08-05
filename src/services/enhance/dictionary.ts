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

  return `I'm dictating notes about ${list}.`
}
