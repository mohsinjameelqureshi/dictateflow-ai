# DictateFlow AI — Build Specification

**Version** 2.1
**Updated** 2026-08-07
**Owner** Mohsin Jameel Qureshi
**Status** Pre-Phase 1. Transcription pipeline validated. UI not started.

> This document supersedes the original project document. Every change is
> based on measured results, not assumption. Sections marked **MEASURED**
> contain real numbers from testing — do not re-litigate them.

---

## 1. What this is

A local-first desktop dictation app for Windows. Hold a shortcut, speak,
release, and the transcribed text is inserted into whatever application had
focus. History and statistics are stored locally in SQLite. No account, no
login, no cloud database.

**Single user.** Built by one person for their own use. Do not add
multi-user features, authentication, or account systems.

### Naming

This project was built under the working name _Wispr AI_, which is the legal
name of the company behind Wispr Flow — the commercial product it is modelled
on. It was briefly renamed to TypeFlow AI on 2026-08-08, then to **DictateFlow
AI** before going public.

Do not reintroduce the old product names. They survive in git history, in
`BACKUP_APP_LEGACY`, and in two comments that cite Wispr Flow as a real
product for calibration (§4); those citations are correct and should stay.

---

## 2. Decisions already made

Do not revisit these without new evidence.

| Question          | Decision                           | Reason                                                     |
| ----------------- | ---------------------------------- | ---------------------------------------------------------- |
| Desktop framework | **Electron**                       | Gives React + shadcn. Wispr Flow itself is Electron-class. |
| Speech-to-text    | **Groq, `whisper-large-v3-turbo`** | Free tier, no card, fastest free option                    |
| Grammar cleanup   | **Off by default**                 | Deletes words. See §4.                                     |
| Authentication    | **None**                           | One user, one local DB file. Nothing to authenticate.      |
| API key storage   | **Electron `safeStorage`**         | OS-level encryption via Windows Credential Manager         |
| Cloud database    | **None**                           | SQLite local only                                          |

### Why no auth

Login answers "whose data is this?" — a question that does not exist with one
user and one local file. Adding it would introduce a network dependency at
startup, break the offline story, and provide no security: a login screen does
not encrypt SQLite. Disk encryption (BitLocker) is the actual protection, and
Windows already provides it.

The only secret worth protecting is the Groq API key. Use `safeStorage`.

---

## 3. MEASURED — latency budget

Real numbers from testing on this machine, Groq free tier.

```
Cold single request, ~15s of speech:

  STT (Whisper Turbo)      1900 – 2100 ms
  LLM cleanup (Llama 70B)    260 –  310 ms
  ─────────────────────────────────────────
  Total                    2200 – 2400 ms
```

### What was tested and ruled out

**Audio format is NOT the bottleneck.** Converting 44.1kHz stereo → 16kHz mono
reduced file size 67% and saved roughly 150ms — within run-to-run noise.

At 228x real-time, actual transcription compute for a 15s clip is ~70ms.
**Roughly 95% of the 1900ms is network round-trip, TLS handshake, and free-tier
queue time**, not processing.

### What should still help

1. **Connection reuse.** Each test run paid a cold DNS + TCP + TLS cost. A
   long-lived client in the main process amortises this. Expect 200–400ms.
2. **Chunked upload during recording.** Stream audio in ~5s chunks while the
   user is still speaking, instead of uploading after release. Converts most
   of the wall-clock into perceived-zero time. **This is the single largest
   win available and the main reason the app will feel fast.**

### Design target

- Realistic floor: **800–1200 ms** perceived
- **Do not design the UI as if insertion is instant.** The Processing state
  is visible on every single use. It must be good.

---

## 4. MEASURED — the grammar step deletes words

Tested three times with progressively stricter system prompts, including an
explicit `NEVER DELETE A WORD` instruction.

```
Spoken:  "...that interface. Training creates the possibility,
          interface creates the value."

Whisper: "...that interface, training create the possibility,
          interface create the value."

LLM:     "...that interface creates the possibility; the interface
          creates the value."
                    ↑ "training" silently deleted, every time
```

**Root cause:** the LLM is not disobeying. Whisper's output is genuinely
ungrammatical, and making it coherent requires cutting something. Prompt
engineering cannot fix a model reasoning over broken input.

### Consequence

- Ship v1 **without** the grammar step.
- Add it later as a Settings toggle, **default off**.
- Always store `raw_text` and always show it in history. Raw is the source
  of truth; `final_text` is a convenience.
- When cleanup is enabled, run the word-loss detector (§10) and log drops.

**Calibration:** Wispr Flow, a funded commercial product, transcribed "Groq"
as "grog" during this same session. Perfect accuracy is not the bar. Fast
draft plus quick manual fix is the product.

---

## 5. Tech stack

### Desktop

- Electron (latest stable)
- electron-vite (build tooling)
- electron-builder (packaging)

### Renderer

- React 18 + TypeScript (strict)
- Tailwind CSS
- shadcn/ui
- lucide-react (icons)
- Framer Motion (widget transitions only)
- Zustand (state)
- React Hook Form + Zod (settings forms)

### Main process

- better-sqlite3 + Drizzle ORM
- **`uiohook-napi`** — global keyboard hook. **NOT Electron `globalShortcut`.**
- **`nut.js`** — keyboard simulation. **NOT robotjs** (unmaintained).
- `groq-sdk`

### Native module note

`better-sqlite3` and `uiohook-napi` are native modules. They must be rebuilt
against Electron's ABI:

```bash
npm install --save-dev electron-rebuild
npx electron-rebuild
```

Add this as a `postinstall` script. Forgetting it produces confusing
`NODE_MODULE_VERSION` errors.

---

## 6. Critical implementation constraints

These are the things that silently break. Read before writing code.

### 6.1 Electron `globalShortcut` cannot do hold-to-talk

It fires on key **down** only. There is no key-up event, and modifier-only
combinations are not supported. Hold-to-record is impossible with it.

Use `uiohook-napi`, which exposes both `keydown` and `keyup`.

```ts
import { uIOhook, UiohookKey } from "uiohook-napi";

let held = false;

uIOhook.on("keydown", (e) => {
  if (e.keycode === UiohookKey.Ctrl && e.metaKey && !held) {
    held = true;
    startDictation();
  }
});

uIOhook.on("keyup", (e) => {
  if (
    held &&
    (e.keycode === UiohookKey.Ctrl || e.keycode === UiohookKey.Meta)
  ) {
    held = false;
    stopDictation();
  }
});

uIOhook.start();
```

Guard against auto-repeat with the `held` flag — key-down fires continuously
while a key is held.

### 6.2 The widget must never take focus

If the widget takes focus, the "currently focused application" becomes the
widget, and inserted text goes nowhere.

```ts
new BrowserWindow({
  frame: false,
  transparent: true,
  focusable: false, // ← non-negotiable
  skipTaskbar: true,
  alwaysOnTop: true,
  resizable: false,
  webPreferences: {
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    preload: path.join(__dirname, "preload.js"),
  },
});
win.setAlwaysOnTop(true, "screen-saver");
```

Capture the target window handle **before** showing the widget.

### 6.3 Never hardcode pixel offsets

The original spec said "80px above the taskbar." This breaks with DPI scaling,
side or top taskbars, auto-hide, and mixed-scale multi-monitor setups.

```ts
const point = screen.getCursorScreenPoint();
const { workArea } = screen.getDisplayNearestPoint(point);

const x = workArea.x + Math.round((workArea.width - WIDGET_W) / 2);
const y = workArea.y + workArea.height - WIDGET_H - 24;
```

`workArea` already excludes the taskbar wherever it lives.

### 6.4 Insert via clipboard, not simulated typing

Character-by-character typing is visibly slow on long text and mangles
non-ASCII and emoji.

```ts
const previous = clipboard.readText();
clipboard.writeText(finalText);
await keyboard.pressKey(Key.LeftControl, Key.V);
await keyboard.releaseKey(Key.LeftControl, Key.V);
setTimeout(() => clipboard.writeText(previous), 150);
```

Restore the user's clipboard. Losing it is a real annoyance.

**Known limitation:** a non-elevated process cannot send input to an elevated
window (Windows UIPI). Dictation into an admin terminal will silently fail.
Detect and show an error rather than appearing to succeed.

### 6.5 Whisper's `prompt` is a continuation hint, not an instruction

**MEASURED failure:** the prompt `"Technical dictation. Terms: TypeScript,
Electron..."` was transcribed verbatim into the output as `"Terms & Tm."`

Phrase it as natural speech:

```ts
prompt: "I'm dictating notes about TypeScript, Electron, SQLite, and React.";
```

Build this string from the user's dictionary entries at runtime. It prevents
errors, which is better than correcting them afterward.

### 6.6 Whisper hallucinates on silence

An accidental shortcut tap with no speech can produce phantom text like
"Thank you." Guard before sending:

- Reject clips under 400ms
- Reject clips whose peak amplitude never exceeds a floor

### 6.7 Security defaults

`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, and a
typed preload bridge. This app runs a global keyboard hook and holds an API
key — these are not optional.

### 6.8 The renderer cannot read recordings off disk directly

`sandbox: true` plus `contextIsolation: true` means no `fs` in the renderer,
and `file://` URLs in an `<audio>` element are blocked by the CSP. Do not
weaken either to make playback work.

Register a custom scheme and resolve the file **in the main process**, from a
dictation id — never from a path supplied by the renderer.

```ts
// before app.whenReady()
protocol.registerSchemesAsPrivileged([
  {
    scheme: "dictateflow-audio",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
    },
  },
]);

// after ready
protocol.handle("dictateflow-audio", async (req) => {
  const id = Number(new URL(req.url).hostname); // dictateflow-audio://123
  const row = getDictation(id); // DB is the only source of truth
  if (!row?.audioFile) return new Response(null, { status: 404 });

  const abs = path.join(recordingsDir, path.basename(row.audioFile));
  if (!abs.startsWith(recordingsDir))
    return new Response(null, { status: 403 });

  return net.fetch(pathToFileURL(abs).toString());
});
```

`path.basename` plus the prefix check are both required. One of them alone is
a path-traversal hole.

Add `media-src 'self' dictateflow-audio:;` to the renderer CSP.

**Store the exact bytes that were sent to the provider.** The reason to keep a
recording is to hear what actually happened when a transcript is wrong.
Re-encoding destroys the evidence. 16kHz mono WAV is ~1.9 MB per minute of
speech — see §8 for retention.

**Write the file before the DB row.** Name it with a UUID at capture time,
insert the row referencing that filename, and sweep unreferenced files in
`recordings/` on startup. The reverse order leaves rows pointing at nothing,
which is worse than a stray file.

Never keep audio for a session that produced no row — cancelled (Esc), too
short, or below the amplitude floor (§6.6). Nothing in the UI would ever
reach it.

---

## 7. Architecture

```
src/
├── main/
│   ├── index.ts              app lifecycle, tray
│   ├── windows/
│   │   ├── main-window.ts
│   │   └── widget-window.ts  focusable:false
│   ├── shortcut/
│   │   └── hook.ts           uiohook-napi, key up + down
│   ├── insert/
│   │   └── clipboard.ts      save → paste → restore
│   ├── audio/
│   │   ├── store.ts          write/delete/sweep recordings/
│   │   └── protocol.ts       dictateflow-audio:// handler (§6.8)
│   └── ipc/
│       └── handlers.ts       typed channels only
│
├── preload/
│   └── index.ts              contextBridge surface
│
├── renderer/
│   ├── app/
│   ├── features/
│   │   ├── dictation/
│   │   ├── insights/
│   │   └── settings/
│   ├── widget/               separate entry point
│   └── components/ui/        shadcn
│
├── services/
│   ├── speech/
│   │   ├── types.ts          SpeechProvider interface
│   │   ├── groq.ts
│   │   └── index.ts          factory
│   ├── enhance/
│   │   ├── types.ts
│   │   ├── groq-llama.ts
│   │   └── dictionary.ts     deterministic replacement
│   └── audio/
│       └── recorder.ts       16kHz mono capture
│
├── db/
│   ├── schema.ts
│   ├── migrations/
│   └── client.ts
│
└── shared/
    ├── types.ts
    └── ipc-channels.ts
```

### Provider interface — build this first

Groq's free tier could change. NVIDIA Parakeet, local whisper.cpp, and others
exist. Make swapping a one-line change.

```ts
// services/speech/types.ts
export interface SpeechProvider {
  readonly id: string;
  readonly label: string;
  readonly requiresNetwork: boolean;
  transcribe(audio: Buffer, opts: TranscribeOptions): Promise<TranscribeResult>;
}

export interface TranscribeOptions {
  language?: string;
  vocabularyHint?: string;
  signal?: AbortSignal; // for user cancellation
}

export interface TranscribeResult {
  text: string;
  durationMs: number;
  providerId: string;
}
```

Ship one implementation (`groq.ts`). The interface costs almost nothing now
and saves a rewrite later.

---

## 8. Database schema

Corrected — the original had missing columns and no key structure.

```ts
export const dictations = sqliteTable(
  "dictations",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    rawText: text("raw_text").notNull(),
    finalText: text("final_text").notNull(),
    durationMs: integer("duration_ms").notNull(),
    words: integer("words").notNull(),
    language: text("language").notNull().default("en"),
    providerId: text("provider_id").notNull(),
    enhanced: integer("enhanced", { mode: "boolean" }).notNull().default(false),
    grammarFixes: integer("grammar_fixes").notNull().default(0),
    dictionaryFixes: integer("dictionary_fixes").notNull().default(0),
    favorite: integer("favorite", { mode: "boolean" }).notNull().default(false),
    // Audio. Filename only — never an absolute path. Null = no recording kept.
    audioFile: text("audio_file"),
    audioBytes: integer("audio_bytes"),
    audioMime: text("audio_mime"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (t) => ({
    createdIdx: index("dictations_created_idx").on(t.createdAt),
    favoriteIdx: index("dictations_favorite_idx").on(t.favorite),
  }),
);

// Key-value. The original had bare columns with no primary key.
export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

// Personal dictionary. Must exist in v1 — see §9.
export const dictionary = sqliteTable("dictionary", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  from: text("from_text").notNull().unique(),
  to: text("to_text").notNull(),
  hitCount: integer("hit_count").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

// Pre-aggregated per-day, for the heatmap.
export const dailyStats = sqliteTable("daily_stats", {
  day: text("day").primaryKey(), // 'YYYY-MM-DD' local time
  words: integer("words").notNull().default(0),
  sessions: integer("sessions").notNull().default(0),
  durationMs: integer("duration_ms").notNull().default(0),
});
```

### Notes

- **No `statistics` table.** Totals, averages, and streaks are derived from
  `dailyStats` and `dictations`. A denormalised totals row drifts from reality
  and there is no reason to risk it at this data volume.
- Streaks are computed from `dailyStats` day keys, so no `last_active_date`
  field is needed.
- Settings keys: `shortcut`, `microphoneId`, `theme`, `language`,
  `launchOnStartup`, `minimizeToTray`, `typingDelayMs`, `speechProvider`,
  `enhanceEnabled`, `keepRecordings`, `recordingRetentionDays`.
- **The API key does not go in this table.** `safeStorage` only.

### Recording storage

- Files live in `app.getPath('userData')/recordings/`, one WAV per session,
  named with a UUID. The DB stores the filename; the directory is resolved at
  runtime so a reinstall or a moved profile does not orphan everything.
- The three audio columns are an **additive migration** on a table that
  shipped in Phase 3. All nullable, no backfill. Rows recorded before this
  phase show a disabled Play control, not a broken one.
- Deleting a dictation deletes its file in the same operation. A row without
  its audio is acceptable; a file without its row is a leak.
- `keepRecordings` default **on**. `recordingRetentionDays` default **off**
  (keep everything), with 7 / 30 / 90 as the other options. Favourites are
  exempt from automatic deletion — favouriting is the user saying keep this.
- Settings shows total recording size on disk and a one-click clear. At
  ~1.9 MB per spoken minute this number gets large quietly, so show it rather
  than letting the user discover it in Explorer.
- **JSON export does not include audio.** Text export stays a text file. Offer
  a separate "Export recordings" that writes a zip, and on import treat a
  missing file as a missing recording, not an error.

### Metric definitions

Ambiguity here produces meaningless numbers. Fixed definitions:

- **WPM** = `finalText` word count ÷ recording duration. Recording duration,
  not speech duration.
- **Word** = whitespace-delimited token, empties filtered.
- **Grammar fixes** = word-level Levenshtein distance between `rawText` and
  `finalText`. Zero when enhancement is off.
- **Dictionary fixes** = count of replacements that actually fired.
- **Streak** = consecutive days with ≥1 session, local timezone.

---

## 9. Feature scope

### v1 — build this

- Global hold-to-talk shortcut, configurable
- Floating widget on the cursor's monitor
- Groq transcription
- Personal dictionary (deterministic replacement)
- Clipboard insertion
- History with search, copy, delete, favorite, and play the original recording
- Insights: total words, sessions, WPM, streaks, heatmap
- Settings: shortcut, microphone, theme, startup, tray
- System tray: Open / Settings / Quit
- Export and import as JSON

### Dictionary must ship in v1

The original spec tracked "dictionary fixes" as a statistic while listing the
dictionary itself as a future feature — the number would read 0 forever. It is
also deterministic, instant, free, and fixes the exact proper-noun failures
observed in testing. It is the highest value-to-effort feature in the app.

**Ordering matters:** run dictionary replacement **after** the LLM step, not
before. Otherwise the LLM "corrects" your corrections back into errors.

### Deferred

Grammar enhancement toggle (default off), voice commands, writing modes,
translation, clipboard history, local provider, cloud sync.

### Explicitly not building

Authentication, user accounts, cloud database, telemetry.

---

## 10. Word-loss detector

Required whenever enhancement is enabled. Verified working against the real
failure case.

```ts
const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^\w\s']/g, "")
    .split(/\s+/)
    .filter(Boolean);

export function droppedWords(raw: string, clean: string): string[] {
  const after = new Map<string, number>();
  for (const w of norm(clean)) after.set(w, (after.get(w) ?? 0) + 1);

  const lost: string[] = [];
  for (const w of norm(raw)) {
    const n = after.get(w) ?? 0;
    if (n === 0) lost.push(w);
    else after.set(w, n - 1);
  }
  return lost;
}
```

If this returns anything, log it and consider falling back to `rawText`.

---

## 11. Widget states

The original spec covered only the happy path. All states below are required.

| State            | Shown                         | Notes                                                        |
| ---------------- | ----------------------------- | ------------------------------------------------------------ |
| Listening        | mic + live waveform           | Appears **immediately** on key-down, before the mic is ready |
| Processing       | spinner, "Transcribing…"      | Visible on every use — make it good                          |
| Inserting        | brief pulse                   | Usually <100ms                                               |
| Success          | check, "Inserted"             | Auto-dismiss ~800ms                                          |
| **No speech**    | "Didn't catch that"           | Clip too short or too quiet                                  |
| **Offline**      | "No connection"               | Network dependency is real                                   |
| **Rate limited** | "Rate limited — try again"    | HTTP 429                                                     |
| **Blocked**      | "Can't type into this window" | Elevated-window UIPI failure                                 |
| **Cancelled**    | fade, no text                 | Esc during recording                                         |

**Esc must cancel at any point.** The app is about to type into the user's
IDE — an abort path is essential, not a nicety.

---

## 12. Visual direction

Reference: Wispr Flow's main window (screenshot in project folder).

- **Frameless window**, custom title bar. Default Windows chrome makes it feel
  like a web page in a box.
- **Light, near-white surface.** One accent colour, everything else greyscale.
- **Generous whitespace.** Density is not the goal.
- **Stats as large numerals with small labels** — the number dominates.
- **Sidebar:** icon + label, subtle active state. Leave vertical room for
  Dictionary, Snippets, and Style to be added later without a redesign.
- **Motion only where it means something:** widget enter/exit, state
  transitions. Respect `prefers-reduced-motion`.

### Copy rules

- Sentence case, active voice, plain verbs.
- Errors state what happened and what to do. They do not apologise and are
  never vague.
- A button's label matches its result: "Delete" → "Deleted."

---

## 13. Build order

Reordered by risk. The original roadmap put the two riskiest items in the
middle; both belong first, because if either fails the project changes shape.

### Phase 0 — spikes (do before any UI)

Standalone scripts, no Electron, no React.

1. `uiohook-napi` prints on key-down and key-up of the chosen combo
2. `nut.js` clipboard-pastes fixed text into Notepad **without** the source
   window losing focus
3. `getUserMedia` records 16kHz mono WAV to disk

**Gate:** all three pass, or reconsider the approach. Groq transcription is
already proven.

### Phase 1 — shell

electron-vite, React, Tailwind, shadcn, SQLite, Drizzle, migrations,
`electron-rebuild` wired into postinstall.

### Phase 2 — capture loop

Widget window, hook, recorder, Groq call, clipboard insert, tray.
**Gate:** end-to-end dictation works into Notepad and Chrome.

### Phase 3 — persistence

Schema, history page, search, copy, delete, favorite, dictionary CRUD +
replacement.

### Phase 4 — insights

Daily aggregation, heatmap, streaks, WPM.

### Phase 5 — settings

Shortcut capture, mic picker, theme, startup, tray, export/import.

### Phase 6 — recordings and playback

Keep the audio for every session and let the user hear it back from history.

1. **Persist the clip.** On a successful dictation, write the exact WAV that
   was sent to the provider into `recordings/` and record `audioFile`,
   `audioBytes`, and `audioMime` on the row. File first, then row (§6.8).
2. **Serve it.** Register the `dictateflow-audio://` scheme and its handler, and
   widen the renderer CSP to `media-src`.
3. **Play control.** Every session row in Dictation gets a Play button in the
   same action group as copy, delete, and favorite. It sits first — it is the
   only control that reveals something the row does not already show.
4. **One player.** A single `<audio>` element owned by the Zustand store, not
   one per row. Starting a second recording stops the first. Show elapsed and
   total time, and let the row's Play toggle to Pause — the label matches the
   result (§12).
5. **Deletion and retention.** Deleting a session deletes its file. Apply
   `recordingRetentionDays` on startup, skipping favourites. Sweep
   unreferenced files in the same pass.
6. **Degrade honestly.** No `audioFile`, or a file that is gone: the control
   is disabled with "No recording", never a play button that fails silently.

Keyboard: the control is a real button in the tab order, Space and Enter
toggle it, and playback state is announced — a spinner-free `aria-pressed`
is enough.

**Gate:** a session recorded before an app restart still plays after it;
deleting that session removes its file from disk; a row from Phase 3 with no
audio renders a disabled control and no console error.

### Phase 7 — polish

code signing,installer.

Chunked upload streams the clip while the user is still speaking, so the
recorder must still assemble and keep the complete WAV locally for §8. The
chunks are a transport detail — they are not the artifact.

---

## 14. Definition of done

A feature is complete when:

- Strict TypeScript, no `any`
- Every failure path handled and surfaced in the UI
- Keyboard accessible, visible focus states
- Data persisted, migration written
- Any file written to disk is deleted with the row that owns it
- `contextIsolation` and `sandbox` intact
- Works at 125% and 150% DPI scaling
- Works with the taskbar on the left edge
- Tested on a second monitor
- Respects `prefers-reduced-motion`

---

## 15. Open questions

1. Does connection reuse actually recover 200–400ms? Measure in Phase 2.
2. Does chunked upload deliver the expected win? Measure in Phase 7.
3. What is the real error rate on proper nouns after the dictionary is
   populated?
4. Is 25MB ever a real constraint? A 16kHz mono WAV hits it around 13
   minutes of continuous speech.
5. How much disk does a month of ordinary use actually consume? Measure in
   Phase 6 and set the retention default from that number, not from a guess.
   If it is large, revisit Opus for storage — but only with the measurement
   in hand.
