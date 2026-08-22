# DictateFlow AI 1.1.0

Adds **Transform**: shortcuts that rewrite the text already in your input
field, using a rule you wrote.

Windows 10 and 11, 64-bit. Upgrades in place — your history, dictionary,
settings and Groq API key all carry over.

## Transform

Dictation puts text into a field. Transform changes text that is already
there.

Write a rule — an instruction like _"rewrite this as a clear, well-structured
prompt"_ or _"make this formal"_ — and bind it to a shortcut. Press that
shortcut and the text in the focused field is taken out, sent to an LLM with
your rule, and pasted back in place.

**One transform ships ready to use.** "Enhance prompt", on `Ctrl` + `Alt` +
`E`. Dictate a rough prompt into ChatGPT, Claude or any other assistant, press
it, and the rough prompt becomes a structured one — without leaving the input
box. The rule is editable, and you can add as many more as you want.

### How it decides what to rewrite

- **Something selected?** Only the selection is transformed, and the result
  replaces it. This is how you rewrite one paragraph of a long draft.
- **Nothing selected?** The whole field is taken.

Be deliberate about the second case in a document — with nothing selected, a
transform in Word or an IDE takes the whole file.

### Your text is never lost

If the model is unreachable, rate limited, returns nothing, or you press `Esc`
part way through, the original text goes straight back where it was. The
missing-key check runs *before* anything is cut, so a transform with no API
key configured does nothing at all rather than emptying your field and
refilling it.

Your clipboard is saved and restored around the whole operation, images
included.

### Choose your engine

Settings → Transform. Two options, and the choice applies to every rule:

- **Groq** — fastest, and uses the API key you already have.
- **Google Gemini** — stronger on long rewrites. Needs its own free key from
  [Google AI Studio](https://aistudio.google.com/apikey).

The model list is read live from whichever provider you pick, so a model that
gets retired never sits in the dropdown waiting to fail. Image, music and
robotics models are filtered out — Google returns them on the same endpoint as
chat models, and none of them can rewrite text.

Gemini transforms run with thinking disabled. A rewrite is not a reasoning
task, and it measurably halves the wait: 690ms instead of 1.57s on
`gemini-2.5-flash`, for the same result. Models that require a thinking budget
still work — the request is retried once with it.

**Both key formats are accepted.** Google issues Gemini keys beginning `AQ.`
and `AIza`; both are fine. Rather than guessing at the format, DictateFlow asks
the provider whether your key works and shows you the answer — with a **Check
it works** button on the card if you want to test it again later. A key entered
while you are offline is still saved, and reported as unchecked rather than
rejected.

Both keys are encrypted with Windows DPAPI and tied to your Windows account.
Neither is ever written to an export.

### Shortcuts

A transform shortcut is a **tap**, not a hold — press and release. It needs a
letter or number plus at least one modifier, or a function key on its own.

It cannot contain your dictation combo or another transform's. If dictation is
`Ctrl` + `Win`, then `Ctrl` + `Win` + `E` is refused, because pressing it would
start a recording before the `E` ever registered. You get told which shortcut
is in the way rather than a rule that silently never fires.

**One thing worth knowing:** the app listens for shortcuts, it does not
intercept them. Whatever you are typing into receives the combo too, so pick
one it does not already use.

## Also in this release

- Transform rules are included in JSON export and import. A backup written by
  1.0.0 still imports; a rule whose shortcut is already taken on the machine
  you import to arrives unbound rather than being rejected.
- New Settings tab: **Transform**, for the engine, the model and its key.
- Settings → API now shows both keys.
- Three new widget states — the rule's name while it runs, "Transformed", and
  "Nothing to transform" for an empty field.
- The widget is slightly wider so a rule's name fits without truncating.
- API keys are verified against the provider instead of being pattern-matched.
  Settings → API and Settings → Transform both show whether the saved key
  actually works.
- The model picker lists the recommended model first rather than alphabetically.
  Alphabetical order put a small Arabic-focused model at the top of the Groq
  list, and the first item in a list is what gets picked.

### Clean output, whatever model you pick

Reasoning models such as Qwen emit a `<think>` block containing their working.
Left alone, that lands in your input field along with the answer. Every reply
is now stripped of reasoning blocks, code fences, "Sure! Here's the rewritten
prompt:" openers, "Let me know if you'd like changes" sign-offs and wrapping
quotes — before anything is pasted.

The stripping is deliberately conservative, because deleting your own text
would be far worse than leaving a stray "Sure!" behind. A heading that ends in
a colon, a code block in the middle of your text, and a quoted phrase inside a
sentence are all left alone. If stripping would empty the result, the original
is pasted instead.

Rewrites are also now written in your own voice — first person, as you would
have said it — rather than describing you from the outside.

## A note on the "Enhance prompt" rule

If you installed an earlier build of 1.1.0, the seeded rule ended with *"if the
text is already a good prompt, return it close to unchanged"* — and on a
dictated question, both providers reasonably decided it already was, and handed
the text straight back. That clause is gone; the rule now requires
restructuring and specifies the shape of the result.

The upgrade repairs the rule automatically **only if you have not edited it**.
If you changed the wording, your version is kept — open Transform → Edit to see
it, and delete the "Never return the text unchanged" hedge if yours still has
it.

## Install

1. Download `dictateflow-ai.exe` below.
2. Run it. It installs per-user and does not ask for administrator rights.
3. SmartScreen will warn you. See below.

Upgrading over 1.0.0 keeps everything. The database migration adds one table
and seeds the "Enhance prompt" rule; nothing existing is touched.

## Setup

Unchanged if you already have DictateFlow AI working. Transforms run on your
existing Groq key out of the box.

To use Gemini instead, get a free key at
[aistudio.google.com/apikey](https://aistudio.google.com/apikey) and paste it
into **Settings → Transform**.

## This installer is not code signed

A certificate costs a few hundred dollars a year, which is not justified for a
personal project. So Windows SmartScreen shows:

> **Windows protected your PC**
> Microsoft Defender SmartScreen prevented an unrecognised app from starting.

Click **More info**, then **Run anyway**.

That warning means "nobody has paid to vouch for this file", not "this file is
known to be malicious". If you would rather not take that on faith, verify the
download against the SHA256 published with this release:

```powershell
Get-FileHash .\dictateflow-ai.exe -Algorithm SHA256
```

Or build it yourself from source. It takes about five minutes.

## Known limitations

New in this release:

- **Transforms are not local.** Both engines are cloud services. If you
  transcribe on-device with Moonshine, a transform is the one action that
  leaves your machine — the Transform tab says so rather than burying it.
- **A transform shortcut also reaches the app underneath.** Pick a combo that
  app does not use. Dictation has always worked this way.
- **`Ctrl+A` means the whole document in a document.** Select first when the
  field is large.
- **Transforms are not saved to history.** They are counted per rule, and
  deliberately kept out of the dictation table: words per minute is defined
  against recording length, and a transform has no recording.

Carried over from 1.0.0:

- **Cannot type into elevated windows.** A non-elevated process cannot send
  input to a process running as administrator. This is Windows UIPI, not a
  bug. You get a clear error rather than silent failure — including on
  transforms, which detect it without touching your text.
- **Cloud transcription needs a network connection.** Expect 1 to 2 seconds
  between releasing the key and the text appearing. Most of that is network
  round-trip and free-tier queueing, not transcription. Moonshine runs
  offline.
- **Grammar cleanup is off by default.** An LLM pass over Whisper's output
  measurably deletes words, so it ships disabled. The raw transcript is always
  stored and always shown. This does not apply to transforms, where rewriting
  is the point.
- **Very short or very quiet clips are dropped.** Whisper invents confident
  text out of silence, so an accidental tap is rejected rather than typed.
- **Windows only.** The keyboard hook, the insertion path and the packaging
  are all Windows-specific. No macOS or Linux build, and none planned.

Full details in the [README](https://github.com/mohsinjameelqureshi/dictateflow-ai#readme).

MIT licensed.
