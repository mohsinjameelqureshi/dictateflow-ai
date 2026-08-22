# DictateFlow AI

**Local-first desktop dictation for Windows.** Hold `Ctrl` + `Win` (the
default, rebindable to anything), speak, release. The text appears in whatever
application had focus: your editor, a browser field, Slack, anything.

No account. No login. No cloud database. Your dictation history, statistics
and recordings live in a SQLite file on your machine and never leave it.

Transcription runs either in the cloud through Groq, or
[entirely on your machine](#two-engines-cloud-or-local) with no key and no
network at all. That choice is yours and you can change it at any time.

It works the other way round too. **[Transform](#transform)** rules are
instructions you write - "rewrite this as a clear prompt", "make this formal" -
each bound to its own shortcut. Press one and an LLM rewrites the text already
sitting in your input field, in place.

![The Dictation view: every session you have dictated, stored locally](docs/screenshots/dictation.png)

> **Status:** v1.1.0, Windows x64 only. Built by one person for their own
> daily use, then opened up. It works, it is not polished for scale, and there
> is no support commitment.

---

## Two engines: cloud or local

Transcription is the one part of this app that can involve someone else's
computer, so it is a choice rather than an assumption. Pick either in the
title bar or in **Settings → Transcription**, and switch whenever you like.

|                          | **Groq** (cloud)              | **Moonshine** (local)             |
| ------------------------ | ----------------------------- | --------------------------------- |
| Where it runs            | Groq's servers                | your machine                      |
| Audio leaves your computer | yes, the clip                | never                             |
| Needs an API key         | yes, free                     | no                                |
| Needs a connection       | every dictation               | once, to download the model       |
| Languages                | around 99                     | English only                      |
| One-time download        | none                          | 292 MB for Medium                 |
| Speed                    | 1 to 2 seconds                | around half the length of the clip |

**Groq** is the default and the faster of the two on short dictations. It
sends your audio to Whisper large-v3-turbo and sends text back.

**Moonshine** runs entirely on your machine, in a separate process, with no
account and no key. Once the model is downloaded the app never contacts the
network again: airplane mode changes nothing about how it behaves. The cost is
a one-time download and slower transcription. Half real time means a 10 second
dictation is roughly 5 seconds of local compute, against 1 to 2 seconds for
the cloud. Longer clips close that gap.

Three model sizes are available. Bigger is more accurate and slower:

| Size   | Download | Word error rate | Notes                             |
| ------ | -------- | --------------- | --------------------------------- |
| Medium | 292 MB   | 6.65%           | default, beats Whisper large-v3   |
| Small  | 159 MB   | 7.84%           | close to Medium, half the size    |
| Tiny   | 51 MB    | 12.00%          | noticeably weaker on proper nouns |

Selecting a model you do not have starts the download, and the title bar shows
its progress. Models live in `%APPDATA%\dictateflow-ai\models` and survive app
updates.

Moonshine is **English only**, and that is a licensing boundary rather than a
missing feature. Its English weights are MIT licensed; every other language is
released under a non-commercial licence, so this app does not ship them. Your
Groq language setting is kept untouched while you use Moonshine, so switching
back restores it.

---

## What actually leaves your computer

That depends on the engine, and it is the only thing the choice changes.

**With Moonshine, nothing does.** After the one-time model download the app
makes no network requests at all.

**With Groq, one thing does:** the audio clip, sent to
[Groq](https://groq.com) to be transcribed by Whisper. That is the entire
network surface.

**Transforms are the exception, on either engine.** A transform is a request
you make explicitly, by pressing a key, and the text you transform is sent to
whichever provider you selected - Groq or Google Gemini. If you chose Moonshine
for the offline guarantee, running a transform is you deciding to give it up
for that one action. The app says so in **Settings → Transform** rather than
burying it here.

What never leaves, on either engine:

- your transcripts and history: SQLite, `%APPDATA%\dictateflow-ai`
- your recordings: WAV files in the same folder
- your settings, personal dictionary and transform rules
- your API keys - Groq and, if you set one, Gemini - encrypted at rest with
  Windows DPAPI via Electron's `safeStorage`, keyed to your Windows account,
  stored outside the database and never included in an export

There is no telemetry, no analytics, and no crash reporting.

---

## Install

Download `dictateflow-ai.exe` from the
[Releases](../../releases) page and run it. It installs per-user and does not
ask for administrator rights.

### Windows will warn you, and it is right to

The installer is **not code signed**. A certificate costs a few hundred
dollars a year, which is not justified for a personal project. So
Windows SmartScreen shows:

> **Windows protected your PC**
> Microsoft Defender SmartScreen prevented an unrecognised app from starting.

Click **More info**, then **Run anyway**.

This warning means "nobody has paid to vouch for this file", not "this file is
known to be malicious". If you would rather not take that on faith, every
release lists a SHA256 checksum, and you can
[build it yourself](#build-from-source) from this source in about five
minutes.

---

## Setup

**Using Moonshine? There is no setup.** Open **Settings → Transcription**,
choose Moonshine, wait for the model to download, and dictate. Skip the rest
of this section.

For Groq you need a free API key. There is no bundled key and no server in
front of the API. You talk to Groq directly with your own credentials.

1. Sign up at [console.groq.com](https://console.groq.com). Free tier, no
   card required.
2. Create an API key. It starts with `gsk_`.
3. In DictateFlow AI, open **Settings → API** and paste it.

The key is encrypted immediately and written to `groq-key.bin` in the app's
data folder. Copying that file to another machine gets you nothing: DPAPI ties
it to your Windows user account.

**For transforms**, the same Groq key works with no extra setup. If you would
rather use Google Gemini, get a free key at
[aistudio.google.com/apikey](https://aistudio.google.com/apikey) and paste it
into **Settings → Transform**. It is stored the same way, in `gemini-key.bin`.
Neither key is ever included in an export.

Google issues Gemini keys beginning `AQ.` and `AIza`; both are accepted. The
app does not pattern-match your key - it asks the provider whether the key
works and shows you the answer, with a **Check it works** button on the card.
A key entered while offline is still saved, and reported as unchecked rather
than rejected.

---

## Using it

| Action                    | How                                            |
| ------------------------- | ---------------------------------------------- |
| Dictate                   | Hold your shortcut, speak, release              |
| Cancel mid-sentence       | `Esc` while recording                           |
| Change the shortcut       | Settings → General                              |
| Switch cloud or local     | Title bar, or Settings → Transcription          |
| Review or replay history  | Dictation tab, with audio for every session     |
| Fix recurring misspellings| Dictionary tab, deterministic replacements      |
| Rewrite text in place     | Tap a transform shortcut - `Ctrl`+`Alt`+`E` by default |
| Manage rewrite rules      | Transform tab                                   |

The floating widget appears on whichever monitor your cursor is on, and never
takes focus. That is what makes inserting into the app behind it possible.

The shortcut is yours to pick. Hold it, don't tap it. One key plus modifiers,
or a function key on its own.

![Settings: shortcut, microphone and theme](docs/screenshots/settings.png)

### Insights

Words per minute, total words, sessions and streaks, all derived from your
local history. Nothing is uploaded to produce these. They are queries against
your own database.

![Insights: words per minute, totals, streaks and a year-long activity heatmap](docs/screenshots/insights.png)

### Personal dictionary

Whisper reliably mangles proper nouns. The dictionary is a plain list of
find-and-replace rules applied after transcription, so `grog` → `Groq` once
and it stays fixed. Entries also seed Whisper's vocabulary hint, which
prevents some errors instead of correcting them.

Matching ignores case and only ever replaces whole words, so a rule for `cat`
leaves `concatenate` alone.

![Dictionary: find-and-replace rules for words the transcriber keeps getting wrong](docs/screenshots/dictionary.png)

### Transform

Dictation puts text into a field. Transform changes text that is already
there - whether you dictated it, typed it or pasted it.

A transform is a rule you write in plain English, bound to a shortcut. Press
the shortcut and the text in the focused field is taken out, sent to an LLM
with your rule, and pasted back in place. No window to switch to, nothing to
copy.

One ships ready to use: **Enhance prompt**, on `Ctrl` + `Alt` + `E`. Dictate a
rough prompt into ChatGPT or Claude, press it, and the rough prompt becomes a
structured one before you hit send. Edit the rule, or add as many more as you
want.

- **Selection-aware.** With something selected, only that is rewritten. With
  nothing selected, the whole field.
- **Your text is never lost.** A dead network, a rate limit, an empty response
  or `Esc` part way through all put the original straight back. Your clipboard
  is restored too, images included.
- **Groq or Gemini**, switchable in **Settings → Transform**. The model list is
  read live from the provider, so a retired model never sits in the dropdown
  waiting to fail - and image, music and robotics models are filtered out,
  because Google returns those on the same endpoint as chat models.
- **Fast enough to be worth a keystroke.** Gemini transforms run with thinking
  disabled: a rewrite is not a reasoning task, and turning it off measurably
  halves the wait (690ms against 1.57s on `gemini-2.5-flash`). Models that
  require a thinking budget still work - the request is retried once with it.

A transform shortcut is a **tap**, not a hold, and it cannot contain your
dictation combo or another transform's - if dictation is `Ctrl` + `Win`, then
`Ctrl` + `Win` + `E` is refused, because pressing it would start a recording
before the `E` ever registered.

---

## Known limitations

These are real and documented rather than hidden:

- **It cannot type into elevated windows.** A non-elevated process cannot send
  input to a process running as administrator. This is Windows UIPI, not a
  bug. Dictating into an admin terminal shows "Can't type into this window"
  rather than pretending it worked.
- **Groq needs a network connection.** Expect 1 to 2 seconds between releasing
  the key and text appearing. Roughly 95% of that is network round-trip and
  free-tier queueing, not transcription. Moonshine has no such dependency, but
  is slower per clip and English only.
- **Grammar cleanup is off by default.** An LLM pass over Whisper's output
  measurably deletes words. It has to cut something to make ungrammatical
  input read cleanly. It ships in **Settings → Experimental**, guarded by a
  detector that discards the result and keeps your raw transcript whenever a
  word carrying meaning goes missing. Note that it is a Groq call regardless
  of which engine transcribed, so turning it on while using Moonshine gives up
  the offline guarantee for that step.
- **Transforms are not local.** Both transform engines are cloud services. If
  you transcribe on-device with Moonshine, a transform is the one action that
  leaves your machine. **Settings → Transform** says so rather than burying it.
- **A transform shortcut also reaches the app underneath.** `uiohook-napi`
  listens for keys rather than intercepting them, so whatever you are typing
  into receives the combo too. Pick one it does not already use. Dictation has
  always worked this way.
- **`Ctrl`+`A` means the whole document in a document.** A transform with
  nothing selected takes the entire field, which in Word or an IDE is the
  whole file. Select first when the field is large.
- **Transforms are not saved to history.** They are counted per rule. Keeping
  them out of the dictation table is deliberate: words per minute is defined
  against recording length, and a transform has no recording.
- **Very short or very quiet clips are dropped.** Whisper hallucinates
  confident text out of silence ("Thank you."), so clips under 400ms or below
  an amplitude floor are rejected with "Didn't catch that".
- **Windows only.** The keyboard hook, the insertion path and the packaging
  are all Windows-specific. There is no macOS or Linux build and none planned.

---

## Build from source

Requires Node 20+ and the Windows build tools that native modules need
(Visual Studio Build Tools with the C++ workload).

```bash
git clone https://github.com/mohsinjameelqureshi/dictateflow-ai.git
cd dictateflow-ai
npm install          # postinstall runs electron-rebuild, do not skip it
npm run dev          # development, with hot reload
npm run dist         # produces release/dictateflow-ai.exe
```

`better-sqlite3` and `uiohook-napi` are native modules and must be compiled
against Electron's ABI, not Node's. That is what the `postinstall` step does.
If you ever see a `NODE_MODULE_VERSION` mismatch error, run
`npx electron-rebuild` and it goes away.

Other scripts:

| Script              | Does                                          |
| ------------------- | --------------------------------------------- |
| `npm run typecheck` | Strict TypeScript over main, preload, renderer |
| `npm run build`     | Typecheck, then bundle                         |
| `npm run pack`      | Unpacked build in `release/`, no installer     |
| `npm run db:generate` | Generate a Drizzle migration from the schema |

---

## How it works

```
Ctrl+Win held  →  uiohook-napi keydown  →  widget shown (never focused)
                                        →  16kHz mono WAV captured

Key released   →  silence/amplitude gate
                        ├─ Groq       →  Whisper large-v3-turbo, over the network
                        └─ Moonshine  →  ONNX in a utilityProcess, on this machine
                                        →  grammar cleanup, if you turned it on
                                        →  personal dictionary replacement
                                        →  clipboard save → paste → restore
                                        →  row + WAV written to SQLite


Ctrl+Alt+E tapped  →  uiohook-napi, fires on RELEASE (see below)
                   →  Ctrl+C - was anything selected?
                        ├─ yes  →  transform the selection
                        └─ no   →  Ctrl+A, Ctrl+X, transform the whole field
                   →  rule + text  →  Groq or Gemini
                   →  paste the result over it
                   →  clipboard restored; on ANY failure, original pasted back
```

- **Electron** main process owns the keyboard hook, the database, the network
  call and the insertion. The renderer is sandboxed with
  `contextIsolation: true`, `nodeIntegration: false` and a typed preload
  bridge. It never touches the filesystem or the API key.
- **Insertion is via the clipboard**, not simulated typing. Typing character
  by character is visibly slow on long text and mangles non-ASCII and emoji.
  Your clipboard contents are restored afterwards.
- **Audio playback** goes through a custom `dictateflow-audio://` protocol that
  resolves files in the main process from a dictation id. The renderer can
  never name a path.
- **A transform tap fires on key RELEASE, not press.** `uiohook-napi` listens
  rather than intercepts, so the focused app receives the combo too. Simulating
  `Ctrl+C` while the user is still holding `Alt` would send it `Ctrl+Alt+C`.
  The binding is armed on press - which is what shows the widget, so the press
  feels registered - and fires when the last key lifts.
- **No two shortcuts may be subsets of one another.** Keydowns arrive one at a
  time, so if dictation is `Ctrl+Win`, a transform on `Ctrl+Win+E` would start a
  recording before `E` was ever seen. Rejected at save time with a reason, not
  left to fail silently.
- **Speech providers are behind an interface** (`src/services/speech/types.ts`)
  with two implementations, `groq.ts` and `moonshine.ts`. Everything above that
  boundary is engine-agnostic: switching is a one-line change in the factory,
  and the capture loop does not know which one it is talking to.
- **The local engine runs in its own process.** A batch pass is seconds of
  solid CPU, so it is forked into an Electron `utilityProcess` rather than run
  in main, where it would stall the keyboard hook and the tray, or in a
  renderer, which would mean weakening the sandbox and the CSP to allow WASM
  and a CDN. Renderers are untouched by it. The model heap lives in the child.
- **Transform providers are behind their own interface**
  (`src/services/transform/types.ts`), with `groq.ts` and `gemini.ts`. Gemini
  talks plain `fetch` - two REST calls against a versioned endpoint did not
  justify an SDK - and both classify their failures onto the same error union
  the speech layer uses, so the widget renders both with no new copy.
- **API keys are validated by asking the provider**, not by checking a prefix.
  An earlier version did check a prefix and refused a valid Gemini key for
  starting `AQ.` instead of `AIza`. A credential's format belongs to the
  company that issues it; guessing at it fails closed, which is the worst way
  to be wrong. Listing models is free, authenticated, and answers the question
  properly - `unreachable` stays a distinct answer from `rejected`, so a key
  saved offline is never reported as bad.

[`CLAUDE.md`](CLAUDE.md) is the real build specification: measured latency
numbers, the constraints that silently break Electron dictation apps, and why
each decision went the way it did. Read it before contributing.

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Issues welcome; open one before
starting a large pull request.

## Security

See [SECURITY.md](SECURITY.md) for the threat model and how to report a
vulnerability privately.

## License

[MIT](LICENSE) © 2026 Mohsin Jameel Qureshi
