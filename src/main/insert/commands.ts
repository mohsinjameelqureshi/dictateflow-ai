/**
 * Voice commands — the trailing kind, spoken at the end of a dictation.
 *
 * §9 defers voice commands generally. "Press enter" is the exception because
 * it needs no model, no round trip and no ambiguity resolution: it is a suffix
 * match on text that has already been transcribed. It stays behind the
 * Experimental tab regardless, for the reason below.
 *
 * **This deletes words from what gets typed.** §4 is emphatic that silently
 * dropping words is the worst failure this app can have, so the matching is
 * deliberately narrow — anchored to the end of the utterance, no fuzzy
 * matching, no synonyms. `rawText` keeps the command either way, so history
 * always shows what was actually said.
 */

export interface ParsedCommand {
  /** What to insert. Empty when the whole utterance was the command. */
  text: string
  /** Whether to send Enter once the paste has landed. */
  pressEnter: boolean
}

/**
 * Anchored to the end, because a command is only a command in the position the
 * setting's label promises. "I'll press enter myself" keeps every word.
 *
 * The three parts before and after the phrase are what stop the strip from
 * leaving debris:
 *
 *   - A leading comma, semicolon, colon or dash is eaten. Whisper writes
 *     "send it, press enter" and that comma only existed because more speech
 *     followed it.
 *   - A leading full stop is NOT eaten. "Send it. Press enter." is a finished
 *     sentence plus a command, and the sentence keeps its punctuation.
 *   - Trailing punctuation Whisper added to the command itself goes with it.
 *
 * `\b` before `press` is load-bearing: without it "decompress enter" matches.
 */
const TRAILING_PRESS_ENTER = /[,;:—–-]?\s*\bpress\s+enter\b\s*[.!?]*\s*$/i

export function parsePressEnter(text: string, enabled: boolean): ParsedCommand {
  if (!enabled) return { text, pressEnter: false }

  const stripped = text.replace(TRAILING_PRESS_ENTER, '')
  if (stripped === text) return { text, pressEnter: false }

  return { text: stripped.trimEnd(), pressEnter: true }
}
