# Phase 0 — risk spikes

Throwaway code. Not part of the app, not imported by it. The point is to
answer three questions before any UI exists, per §13 of the build spec.

```bash
cd spikes
npm install
```

## 1 — global hook

```bash
npm run spike:hook
```

Hold **Ctrl+Win**, release. Then hold it for three seconds and release.

**Pass:** exactly one `START` and one `STOP` per hold, regardless of how long
it was held. The repeat counter should climb during a long hold and still
produce only one `START`.

Answers: can we detect key-up, and can a modifier-only combo be a shortcut?
Electron's `globalShortcut` can do neither.

## 2 — clipboard insertion

Open Notepad first.

```bash
npm run spike:paste
```

Alt-tab to Notepad during the 5-second countdown.

**Pass:** the text lands in Notepad with the accents and emoji intact,
`focus kept` is YES, and `clipboard restored` is YES.

Then repeat with an **admin** terminal focused. Expect nothing to appear —
that is Windows UIPI (§6.4), and it is why the app needs a Blocked state
rather than a silent success.

## 3 — audio capture

```bash
npm run spike:audio
```

Record ~5s of speech. Then record ~2s of silence. Then tap record/stop as
fast as you can.

**Pass:** context rate reads 16000 Hz, the speech clip reports a peak well
above 0.01 and a sane byte size, the silent clip is flagged
`would REJECT: peak below floor`, and the fast tap is flagged
`would REJECT: under 400ms`.

WAV files land in `%TEMP%\typeflow-spike-audio` — "Open output folder" takes
you there. Play one back to confirm it is not garbage.

## Automated run

```bash
node drive-hook.mjs   # spike 1, synthetic Ctrl+Alt
node drive-paste.mjs  # spike 2, real Notepad target
node drive.mjs        # spike 3, all three §6.6 cases
node probe-agc.mjs    # measures the AGC gain question below
```

All three spikes pass unattended. `drive-hook.mjs` uses nut.js to send real
OS-level key events that uiohook then observes, so it is end-to-end rather
than mocked — but it cannot test **auto-repeat**, since the OS only repeats
physically held keys. That one case still needs a human finger.

Spike 1 results: keyup fires, a modifier-only combo works, releasing either
key stops it, `Ctrl` alone correctly does not start, and measured hold
durations land within ~30ms of the requested value.

Spike 2 results: text lands exactly, accents and emoji intact, clipboard
restored, HWND unchanged, paste in 56–120ms.

`drive.mjs` feeds Chromium a WAV as the capture device
(`--use-file-for-fake-audio-capture`), so the guards are tested against
known input rather than a quiet room. All three cases pass:
fast-tap → rejected under 400ms, digital silence → rejected below floor,
tone → would send.

## Findings for Phase 2

### Window title is not window identity

The first spike-2 run reported a focus failure that was not one. Notepad
renames its title bar to the document's first line, so a *successful* paste
changed the title of the very window being checked:

```
*Monday(145-335 PM) - Notepad   ->   *Hello from TypeFlow spike 2 — ... - Notepad
```

Same window throughout. `getActiveWindow().windowHandle` (the HWND) stayed
at `2164304` across the paste.

**§6.2 says "capture the target window handle before showing the widget" —
this is why it must be the handle.** Anything title-based will produce false
positives on every editor that shows the filename, which is all of them.

### Insertion is fast once autoDelayMs is fixed

Measured 56–120ms end to end for clipboard-save → paste → restore, against
a real Notepad window. With nut.js's default `autoDelayMs: 300` this would
be ~600ms — over half the §3 latency budget, spent on nothing.

### The 0.01 peak floor works, with ~2.4x of margin

Chromium applies gain the app did not ask for: a 0.3663-amplitude fixture
arrives at **1.0005** with `autoGainControl: true`, and at 0.3662 with it
off — 2.73x.

That looked like it would defeat the §6.6 floor, since a real quiet room is
a low noise floor rather than digital silence. Measured on real mic clips,
it does not:

| clip | duration | peak |
|---|---|---|
| silence | 2.05s | 0.0042 |
| fast tap | 0.62s | 0.0010 |
| fast tap | 0.16s | 0.0010 |
| **threshold** | | **0.0100** |

`noiseSuppression: true` gates the floor before AGC can lift it, and AGC
does not boost what it does not treat as speech. **Keep AGC on.** Margin is
only ~2.4x on the worst clip though, so re-measure if the mic changes.

### 38–74ms of audio is lost at the start of a recording

Wall-clock duration vs sample-count duration on real clips:

| clip | wall | samples | lost |
|---|---|---|---|
| speech | 7858ms | 7784ms | 74ms |
| speech | 10646ms | 10608ms | 38ms |

The gap is `getUserMedia` + `AudioContext` + worklet startup. (Runs under
Playwright showed up to 271ms, but that is cold-launch overhead and not
representative.)

Worth pre-warming in Phase 2 — keep a live `AudioContext` and worklet and
have key-down flip a collect flag rather than build the graph — but this is
polish, not a blocker. §11's "Listening appears before the mic is ready"
already anticipates it.

## Deviations from the spec

- **`@nut-tree/nut-js` is gone from public npm.** It moved to a private
  registry. Using the maintained community fork `@nut-tree-fork/nut-js`,
  which is the same library and the same API. Update §5 of the spec.
- **`keyboard.config.autoDelayMs` defaults to 300ms**, applied to both
  `pressKey` and `releaseKey` — 600ms per insertion, uncounted in the §3
  latency budget. Set it to 0.
- **Spike 3 needs Electron.** §13 says "no Electron", but `getUserMedia`
  only exists in a renderer. There is no way to do this in plain Node.
- Spike 3 uses `AudioWorklet` over `MediaRecorder` deliberately:
  `MediaRecorder` produces webm/opus and hides the sample rate, and we need
  raw amplitude for the §6.6 silence guard.
