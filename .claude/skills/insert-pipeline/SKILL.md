---
name: insert-pipeline
description: Correctness rules for the Wispr AI audio-to-text-insertion path — silence rejection, transcription, dictionary/LLM ordering, clipboard insertion, and failure detection. Read before editing anything under src/services/speech/, src/services/enhance/, src/services/audio/, or src/main/insert/.
---

# Insert pipeline

The path from key-release to text on screen. Each stage has a specific failure
mode that produces *plausible wrong output* rather than an error — which is
why the ordering and the guards below are not stylistic preferences.

```
audio buffer
  → silence guard        reject before spending a network call
  → transcribe           SpeechProvider, always store rawText
  → [enhance]            OFF by default; word-loss detector mandatory
  → dictionary           deterministic replacement — AFTER the LLM
  → clipboard insert     save → paste → restore
  → persist              rawText always, finalText as convenience
```

## 1. Silence guard — before any network call

Whisper hallucinates on silence. An accidental shortcut tap with no speech
produces phantom text like "Thank you." (§6.6)

- Reject clips under **400ms**
- Reject clips whose **peak amplitude never exceeds a floor**

Both are cheap and both run before upload. A rejected clip shows the **"Didn't
catch that"** widget state (§11) — not an error, not silence, not a spinner
that resolves into nothing.

## 2. Transcription — behind the provider interface

Groq's free tier could change. NVIDIA Parakeet, local whisper.cpp and others
exist. Swapping must stay a one-line change.

```ts
export interface SpeechProvider {
  readonly id: string
  readonly label: string
  readonly requiresNetwork: boolean
  transcribe(audio: Buffer, opts: TranscribeOptions): Promise<TranscribeResult>
}
```

Ship one implementation (`groq.ts`). Nothing outside `services/speech/` may
import `groq-sdk` or reference Groq-specific types.

**The `signal: AbortSignal` is load-bearing.** Esc cancels at any point (§11),
which only works if the signal reaches the actual fetch. Dropping it at the
provider boundary makes Esc a lie.

### Whisper's `prompt` is a continuation hint, not an instruction

**MEASURED failure:** the prompt `"Technical dictation. Terms: TypeScript,
Electron..."` was transcribed verbatim into the output as `"Terms & Tm."`

Phrase it as natural speech:

```ts
prompt: "I'm dictating notes about TypeScript, Electron, SQLite, and React."
```

Build the string from the user's dictionary entries at runtime. Preventing an
error beats correcting it afterward.

## 3. Enhancement is OFF by default and deletes words

**MEASURED, three times, including with an explicit `NEVER DELETE A WORD`
instruction:**

```
Spoken:  "...that interface. Training creates the possibility,
          interface creates the value."
Whisper: "...that interface, training create the possibility,
          interface create the value."
LLM:     "...that interface creates the possibility; the interface
          creates the value."
                    ↑ "training" silently deleted, every time
```

The LLM is not disobeying. Whisper's output is genuinely ungrammatical, and
making it coherent *requires* cutting something. Prompt engineering cannot fix
a model reasoning over broken input. Do not attempt another prompt fix.

Whenever enhancement is enabled, run the word-loss detector and log drops:

```ts
const norm = (s: string) =>
  s.toLowerCase().replace(/[^\w\s']/g, '').split(/\s+/).filter(Boolean)

export function droppedWords(raw: string, clean: string): string[] {
  const after = new Map<string, number>()
  for (const w of norm(clean)) after.set(w, (after.get(w) ?? 0) + 1)

  const lost: string[] = []
  for (const w of norm(raw)) {
    const n = after.get(w) ?? 0
    if (n === 0) lost.push(w)
    else after.set(w, n - 1)
  }
  return lost
}
```

If it returns anything, log it and consider falling back to `rawText`.

**`rawText` is the source of truth.** Always stored, always shown in history.
`finalText` is a convenience.

## 4. Dictionary runs AFTER the LLM

Ordering is not arbitrary. Run replacement before the LLM and the LLM
"corrects" your corrections back into errors.

Replacement is deterministic, instant, and free — it fixes exactly the
proper-noun failures observed in testing, which is why it ships in v1 rather
than being deferred. Count only replacements that **actually fired** into
`dictionaryFixes`; a rule that matched nothing is not a fix.

Calibration: Wispr Flow, a funded commercial product, transcribed "Groq" as
"grog" during testing. Perfect accuracy is not the bar. Fast draft plus quick
manual fix is the product.

## 5. Clipboard insertion — save, paste, restore

Character-by-character typing is visibly slow on long text and mangles
non-ASCII and emoji.

```ts
const previous = clipboard.readText()
clipboard.writeText(finalText)
await keyboard.pressKey(Key.LeftControl, Key.V)
await keyboard.releaseKey(Key.LeftControl, Key.V)
setTimeout(() => clipboard.writeText(previous), 150)
```

Restore the user's clipboard. Losing it is a real annoyance.

Note `readText()` only preserves text — restoring over a copied image or file
is lossy. Acceptable for v1; do not pretend otherwise in comments.

### UIPI: the failure that looks like success

A non-elevated process cannot send input to an elevated window. Dictating into
an admin terminal **fails silently** — the paste goes nowhere and the app
otherwise behaves as though it worked.

Detect it and show the **"Can't type into this window"** state (§11). An
error the user can act on beats a success that produced nothing.

## 6. Persist with correct metrics

Ambiguity here produces meaningless numbers. Fixed definitions:

- **WPM** = `finalText` word count ÷ **recording** duration (not speech duration)
- **Word** = whitespace-delimited token, empties filtered
- **Grammar fixes** = word-level Levenshtein between `rawText` and `finalText`;
  **zero when enhancement is off**
- **Dictionary fixes** = replacements that actually fired
- **Streak** = consecutive days with ≥1 session, local timezone

Write to `dictations` and update `dailyStats` in the **same transaction**.
Aggregates that can drift from their source will drift.

There is no `statistics` table. Totals, averages and streaks derive from
`dailyStats` and `dictations`. Do not add a denormalised totals row.

**The API key never touches SQLite.** `safeStorage` only (§2).

## Every failure path is a visible state

No stage may fail into silence. Each maps to a widget state (§11):

| Failure | State |
|---|---|
| Clip too short / too quiet | "Didn't catch that" |
| Network unreachable | "No connection" |
| HTTP 429 | "Rate limited — try again" |
| Elevated target window | "Can't type into this window" |
| Esc pressed | fade, no text, no error |

Errors state what happened and what to do. They do not apologise and are never
vague (§12).
