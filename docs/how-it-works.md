# DictateFlow AI — How It Works

A walkthrough of the codebase: structure, entry points, and the full
dictation path. Written so you can explain the system in an interview
without opening every file.

**Product in one sentence:** hold a global shortcut, speak, release — the
transcript is pasted into whatever app had focus. History and stats live in
local SQLite. No account.

---

## 1. What problem it solves

Commercial dictation apps (e.g. Wispr Flow) are Electron-class products: they
need a floating UI that never steals focus, a real hold-to-talk shortcut, and
clipboard paste into other windows. Browser APIs alone cannot do that.

DictateFlow is a **local-first Windows desktop app**:

| Concern | Choice |
|--------|--------|
| Shell | Electron + electron-vite |
| UI | React + Tailwind + shadcn |
| STT | Groq `whisper-large-v3-turbo` |
| DB | SQLite via better-sqlite3 + Drizzle |
| Global keys | `uiohook-napi` (not Electron `globalShortcut`) |
| Paste | nut.js clipboard + Ctrl+V |
| API key | Electron `safeStorage` (Windows DPAPI) |

**Explicit non-goals:** auth, multi-user, cloud DB, telemetry.

---

## 2. High-level architecture

Electron has three process kinds. This app uses all of them:

```
┌─────────────────────────────────────────────────────────────┐
│  MAIN PROCESS  (Node + Electron APIs)                       │
│  src/main/index.ts                                          │
│  • lifecycle, tray, windows                                 │
│  • global keyboard hook                                     │
│  • dictation session orchestration                          │
│  • SQLite, secrets, clipboard paste                         │
│  • IPC handlers                                             │
└────────────┬───────────────────────────────┬────────────────┘
             │ preload bridge                │ preload bridge
             ▼                               ▼
┌────────────────────────┐     ┌────────────────────────────┐
│  MAIN WINDOW           │     │  WIDGET WINDOW             │
│  window.dictateflow    │     │  window.dictateflowWidget  │
│  History, Dictionary,  │     │  focusable: false          │
│  Insights, Settings    │     │  mic + waveform + states   │
└────────────────────────┘     └────────────────────────────┘
```

**Why two windows?**

- The **main window** is a normal app UI (history, settings). It can take
  focus. It must **not** hold the microphone permission surface mixed with
  DB/API-key access in a careless way — device enumeration is relayed from
  the widget instead.
- The **widget** is a floating pill. It **must never take focus**. If it
  did, “the focused app” would become the widget, and paste would go into
  the wrong place (or nowhere useful).

**Services** (`src/services/`) are plain TypeScript used by the main
process: speech providers and dictionary enhancement. They are not a
separate Node server.

---

## 3. Repository structure

```
src/
├── main/                 Electron main process
│   ├── index.ts          App entry / boot sequence
│   ├── windows/          main-window.ts, widget-window.ts
│   ├── shortcut/         uiohook hold-to-talk
│   ├── dictation/        session.ts — the capture loop
│   ├── insert/           clipboard paste, target HWND, commands
│   ├── audio/            recordings store, protocol, devices, retention
│   ├── ipc/              typed IPC handlers
│   ├── secrets.ts        Groq key via safeStorage
│   ├── settings.ts       SQLite key-value settings
│   └── tray.ts           system tray lifetime
│
├── preload/              One sandboxed CJS bridge, two APIs
│   ├── index.ts          Chooses widget vs main by argv
│   ├── main-api.ts       → window.dictateflow
│   └── widget-api.ts     → window.dictateflowWidget
│
├── renderer/
│   ├── src/              Main React app (App.tsx, features/*)
│   └── widget/           Separate entry: recorder + pill UI
│
├── db/                   schema, client, migrations, query helpers
├── services/
│   ├── speech/           SpeechProvider interface + Groq impl
│   └── enhance/          Dictionary replace (no LLM grammar in v1)
└── shared/               types, IPC channel names, shortcut parsing
```

Also useful at the root:

| Path | Role |
|------|------|
| `electron.vite.config.ts` | Builds main + preload + **two** renderer HTML entries |
| `electron-builder.yml` | NSIS installer → `release/dictateflow-ai.exe` |
| `CLAUDE.md` | Spec: measured latency, constraints, build order |
| `spikes/` | Phase 0 proofs (hook, paste, WAV) before UI |
| `bench/` | Groq latency measurements |

---

## 4. Entry points (what starts what)

### Build → runtime

| Process | Source | Built as |
|---------|--------|----------|
| Main | `src/main/index.ts` | `out/main/index.js` (`package.json` `"main"`) |
| Preload | `src/preload/index.ts` | `out/preload/index.cjs` (single CJS file) |
| Main UI | `src/renderer/index.html` → `src/renderer/src/main.tsx` | `out/renderer/` |
| Widget | `src/renderer/widget.html` → `src/renderer/widget/main.tsx` | same `out/renderer/` |

### Boot sequence (`src/main/index.ts`)

Say this out loud in an interview:

> “On launch we take a single-instance lock so two hooks don’t fight over one
> SQLite file. We register the custom audio scheme **before** `app.whenReady`
> — Electron requires that. After ready we migrate legacy user-data folders,
> open the DB, register the audio protocol and IPC, create the **widget first**
> (kept warm, usually hidden), then the main window, tray, and global
> shortcut. Closing the main window does **not** quit: the app lives in the
> tray so dictation keeps working.”

Ordered checklist:

1. Single-instance lock  
2. `registerAudioScheme()` (pre-ready)  
3. Ready → CSP, media permission **only for widget**  
4. `migrateUserData()` → `initDb()` → `registerAudioProtocol()`  
5. `registerIpcHandlers()` → login item → audio retention sweep  
6. `createWidgetWindow()` → `createMainWindow()` → `createTray()` → `startShortcut()`  
7. Quit path: `stopShortcut()` + `closeDb()`

### Preload split

Sandboxed preload cannot load a second JS file, so there is **one** bundle.
At runtime:

```ts
// src/preload/index.ts
const isWidget = process.argv.includes('--dictateflow-role=widget')
if (isWidget) expose('dictateflowWidget', widgetApi)
else expose('dictateflow', mainApi)
```

The widget window passes that argv via `webPreferences.additionalArguments`.
Result: the widget never gets DB or API-key methods on its bridge.

---

## 5. End-to-end dictation flow

This is the core of the product. One session at a time, owned by
`DictationSession` in `src/main/dictation/session.ts`.

```
Key down                    Key up / Esc
   │                            │
   ▼                            ▼
begin()                     finish() / cancel()
   │                            │
   ├─ show widget (listening)   ├─ stop recorder → ClipPayload
   ├─ start mic (widget)        ├─ silence guards (duration + peak)
   └─ capture insert target     ├─ Groq transcribe
                                ├─ strip vocabulary hint leak
                                ├─ dictionary replace
                                ├─ optional “press enter” command
                                ├─ write WAV (if enabled)
                                ├─ elevated-window check
                                ├─ clipboard paste
                                └─ SQLite row + broadcast UI
```

### Step-by-step with files

| # | What happens | Where |
|---|--------------|--------|
| 1 | User holds configured combo | `src/main/shortcut/hook.ts` (`uiohook` keydown/keyup) |
| 2 | Hook calls `session.begin()` | `src/main/shortcut/index.ts` |
| 3 | Widget → `listening`, shown inactive; `start` command sent | `session.ts` `#openMic` |
| 4 | Focused HWND captured (parallel with mic) | `src/main/insert/target.ts` |
| 5 | Widget opens mic, records 16 kHz mono PCM | `src/renderer/widget/recorder.ts` |
| 6 | Key release → `session.finish()` | hook → session |
| 7 | Widget stops → WAV bytes over IPC | `widget:clip` → `session.receiveClip` |
| 8 | Reject too short / too quiet | `MIN_CLIP_MS` 400, `MIN_CLIP_PEAK` 0.01 |
| 9 | Upload to Groq Whisper | `src/services/speech/groq.ts` |
| 10 | Dictionary find-and-replace | `src/services/enhance/dictionary.ts` |
| 11 | Write recording file **then** later DB row | `src/main/audio/store.ts` |
| 12 | Paste via clipboard restore dance | `src/main/insert/clipboard.ts` |
| 13 | Persist + refresh history | `src/db/dictations.ts` + broadcast |
| 14 | Widget terminal state, auto-hide | `#settle` |

**Esc** calls `session.cancel()` at any phase — recording, waiting for clip,
or mid-transcription (`AbortController`).

### Widget states (what the user sees)

| State | Meaning |
|-------|---------|
| `listening` | Holding key; waveform |
| `processing` | Transcribing (always visible — network latency) |
| `inserting` | Pasting |
| `success` | Inserted |
| `no-speech` | Clip too short/quiet, or empty transcript |
| `offline` / `rate-limited` | Network / HTTP 429 |
| `blocked` | Target window is elevated (UIPI) |
| `cancelled` | Esc |
| `error` | Mic / API / paste failure with message |

---

## 6. Why certain hard choices exist

Interviewers love “why not the obvious API?”

### Hold-to-talk needs `uiohook`, not `globalShortcut`

Electron’s `globalShortcut` fires on key **down** only. No key-up, and
modifier-only combos are unreliable. Hold-to-record is impossible with it.
`uiohook-napi` gives both events; a `held` flag ignores auto-repeat.

### Widget must be `focusable: false`

Also: `showInactive()`, `setIgnoreMouseEvents(true)`, always-on-top at
`screen-saver` level. Position comes from the cursor’s display **`workArea`**
(not “80px above the taskbar”), so DPI and side taskbars work.

### Paste via clipboard, not fake typing

Character-by-character typing is slow and breaks non-ASCII. Flow:

1. Snapshot previous clipboard (text + image if any)  
2. Write transcript  
3. Simulate Ctrl+V with nut.js  
4. Restore clipboard after a short delay  

**Limitation:** a non-elevated process cannot inject into an elevated window
(Windows UIPI). The app detects that and shows `blocked` instead of fake success.

### Mic opens on the widget; Settings only sees a list

`enumerateDevices` returns empty labels without media permission. Permission
is granted to the **widget** webContents only. Settings asks main → main asks
widget → list comes back. Keeps the privileged surface small.

### External mic startup latency

USB mics can take hundreds of ms on first `getUserMedia`. The app pre-warms a
capture stream when a specific device is selected, and starts recording as
soon as the key goes down (doesn’t wait on target capture). System default is
usually fast enough without a held stream.

---

## 7. IPC design

Channels live in `src/shared/ipc-channels.ts`. Payloads are typed in
`src/shared/types.ts` (`IpcMap`, `IpcEventMap`). Handlers register in
`src/main/ipc/handlers.ts`.

Two patterns:

| Pattern | Direction | Example |
|---------|-----------|---------|
| Invoke / handle | Renderer ↔ Main | settings get/set, list dictations |
| Event push | Main → Renderer | `widget:command`, `dictations:changed`, theme |

**Main bridge** (`window.dictateflow`): window chrome, settings, dictations,
dictionary, insights, export/import, API key, theme, devices.

**Widget bridge** (`window.dictateflowWidget`): commands/state, send clip,
mic errors, device enumerate, theme only.

Typed channels prevent “stringly typed” IPC drift — a good talking point.

---

## 8. Database

File: `%APPDATA%/dictateflow-ai/dictateflow.db` (Electron `userData`).

Tables (`src/db/schema.ts`):

| Table | Purpose |
|-------|---------|
| `dictations` | Each session: `raw_text`, `final_text`, duration, words, provider, optional audio metadata |
| `settings` | Key-value prefs (not the API key) |
| `dictionary` | `from_text` → `to_text`, `hit_count` |
| `daily_stats` | Per-day aggregates for the heatmap |

**Design notes you can defend:**

- **`raw_text` is source of truth**; `final_text` is after dictionary (and
  optional command stripping). If a cleanup LLM is ever enabled, raw still
  shows what Whisper heard.
- **No denormalized “totals” row** — streaks and WPM derive from
  `daily_stats` / dictations so numbers can’t drift.
- **Audio columns are nullable** — older rows degrade to “No recording,” not
  a broken play button.
- Migrations via Drizzle under `src/db/migrations/`; packaged into the app.

---

## 9. Recordings and `dictateflow-audio://`

Renderer is sandboxed: no `fs`, and `file://` in `<audio>` is blocked by CSP.

Solution:

1. On success, write the **exact WAV bytes sent to Groq** under
   `userData/recordings/<uuid>.wav` (file before DB row).  
2. Store **filename only** on the row.  
3. Register scheme `dictateflow-audio`. Playback URL is like
   `dictateflow-audio://clip/<dictationId>`.  
4. Main process resolves id → DB → basename → path, with a prefix check
   against the recordings directory (path-traversal defense).  
5. CSP allows `media-src 'self' dictateflow-audio:`.

History uses one shared `<audio>` player (Zustand), not one per row.

Startup maintenance: retention policy (favourites exempt) + sweep orphan
files.

---

## 10. Speech + dictionary

### Provider interface

```ts
// src/services/speech/types.ts
interface SpeechProvider {
  readonly id: string
  readonly label: string
  readonly requiresNetwork: boolean
  transcribe(audio: Buffer, opts: TranscribeOptions): Promise<TranscribeResult>
}
```

Only Groq is implemented today (`src/services/speech/groq.ts`). The factory
caches the client so TCP/TLS isn’t cold every dictation.

### Whisper `prompt` is not a system instruction

Measured failure: instructional prompts can be transcribed into the output.
The app builds a **natural-speech vocabulary hint** from dictionary “to”
terms, then strips it if it leaks back into the transcript.

### Dictionary order

Dictionary runs **after** transcription. Spec says: if an LLM grammar step
is added later, dictionary still runs **after** the LLM, or the model will
“correct” your proper nouns back to wrong ones.

### Grammar LLM is off in v1

Measured: Llama cleanup **deleted words** from ungrammatical Whisper output
even with “never delete” prompts. Setting `enhanceEnabled` exists; the live
session path does **not** run an LLM enhance. Don’t claim it ships active.

---

## 11. Secrets and settings

| Data | Storage |
|------|---------|
| Preferences | SQLite `settings` table |
| Groq API key | Encrypted blob via `safeStorage` → `userData/groq-key.bin` |

The key never goes in SQLite. `getApiKey()` is only used from the main
process when starting transcription.

---

## 12. Main UI map (renderer)

| Area | Path | Job |
|------|------|-----|
| Shell | `App.tsx`, `sidebar.tsx`, `title-bar.tsx` | Navigation + frameless chrome |
| History | `features/dictation/` | Search, copy, favourite, delete, play |
| Dictionary | `features/dictionary/` | CRUD rules |
| Insights | `features/insights/` | WPM, streaks, heatmap |
| Settings | `features/settings/` | Shortcut, mic, theme, API, data |
| Transform | `features/transform/` | Placeholder / future — not a full feature |

State: Zustand where needed (e.g. settings store, audio player). Theme
follows system or user preference via main-process broadcast.

---

## 13. Security story (short)

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`  
- Two preload surfaces; widget cannot touch DB or API key  
- Media permission only for widget  
- Custom audio URLs resolve by **id**, not by path from the renderer  
- API key encrypted at rest with OS credentials  
- Strict CSP; custom scheme only where needed for playback  

---

## 14. Latency reality (measured)

Rough cold numbers for ~15s of speech on free Groq:

- Whisper turbo: ~1900–2100 ms  
- Most of that is network / queue, not compute  
- Design assumes **Processing is always visible** — do not promise instant insert  

Future wins called out in the spec: connection reuse (partially via cached
client) and chunked upload while still speaking (not the default path yet).

---

## 15. How to explain it in an interview (script)

**30-second version**

> “It’s an Electron dictation app. A global keyboard hook starts recording in
> a floating widget that never takes focus. On key-up we send 16 kHz WAV to
> Groq Whisper, run a local dictionary, then paste via the clipboard into the
> previously focused window. Everything except the audio clip stays in SQLite
> on disk; the API key is in OS secure storage.”

**If they ask “hardest part?”**

> “Focus and input. Electron’s built-in shortcuts can’t do hold-to-talk. The
> overlay can’t steal focus or paste lands wrong. Elevated windows can’t
> receive synthetic input. And sandboxed renderers can’t play local files
> with `file://`, so we serve recordings through a custom protocol keyed by
> dictation id.”

**If they ask “why not grammar AI?”**

> “We measured it. Whisper’s broken grammar makes the LLM delete words to
> make sentences coherent. So v1 ships raw + dictionary; grammar stays an
> optional future toggle, default off.”

**If they ask “how would you swap STT?”**

> “`SpeechProvider` interface with one Groq implementation. Session code
> depends on the interface; factory picks the provider from settings.”

---

## 16. What is / isn’t shipped

**Shipped:** hold-to-talk, widget states, Groq STT, dictionary, history +
playback, insights, settings, tray, JSON export/import, recordings retention.

**Not shipped / scaffold only:** LLM grammar enhance implementation, full
Transform/style features, chunked upload while speaking, local offline STT.

---

## 17. Quick file cheat sheet

| You want to understand… | Open |
|-------------------------|------|
| Boot | `src/main/index.ts` |
| Dictation loop | `src/main/dictation/session.ts` |
| Shortcut | `src/main/shortcut/hook.ts` |
| Widget window rules | `src/main/windows/widget-window.ts` |
| Mic capture | `src/renderer/widget/recorder.ts` |
| Paste | `src/main/insert/clipboard.ts` |
| IPC surface | `src/shared/ipc-channels.ts`, `src/preload/*` |
| Schema | `src/db/schema.ts` |
| Groq | `src/services/speech/groq.ts` |
| Spec / decisions | `CLAUDE.md` |

---

*Generated for interview / onboarding walkthrough. If code and this doc
disagree, trust the code and update this file.*
