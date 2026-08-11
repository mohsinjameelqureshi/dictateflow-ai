---
name: phase-0-spikes
description: Run and evaluate the three Phase 0 gating spikes for DictateFlow AI (uiohook-napi key up/down, nut.js clipboard paste without focus loss, 16kHz mono WAV capture). Use when starting Phase 0, when a spike fails, or before declaring the Phase 0 gate passed and moving to Phase 1.
---

# Phase 0 spikes

Three standalone scripts. No Electron, no React, no build tooling. They exist
to answer one question: *do the risky native pieces work on this machine?*

If any spike fails, the project changes shape. Do not start Phase 1 until all
three pass. Groq transcription is already proven (§3) and is not a spike.

## Setup

Spikes live in `spikes/`, outside `src/`, with their own `package.json` so a
failed experiment never contaminates the app.

```bash
mkdir spikes && cd spikes
npm init -y
npm i uiohook-napi @nut-tree-fork/nut-js
```

Plain Node here — no Electron ABI, so **no `electron-rebuild` needed at this
stage**. That changes in Phase 1. If a native module loads fine in a spike but
throws `NODE_MODULE_VERSION` later, that is the ABI mismatch described in §5,
not a broken spike.

## Spike 1 — global hold-to-talk hook

**Proves:** `uiohook-napi` reports both key-down and key-up for the chosen
combo, system-wide, while another app has focus.

```ts
import { uIOhook, UiohookKey } from 'uiohook-napi'

let held = false

uIOhook.on('keydown', (e) => {
  if (e.keycode === UiohookKey.Ctrl && e.metaKey && !held) {
    held = true
    console.log('DOWN', Date.now())
  }
})

uIOhook.on('keyup', (e) => {
  if (held && (e.keycode === UiohookKey.Ctrl || e.keycode === UiohookKey.Meta)) {
    held = false
    console.log('UP  ', Date.now())
  }
})

uIOhook.start()
```

**Pass criteria**
- Exactly one `DOWN` per press, regardless of how long the key is held.
  Auto-repeat fires `keydown` continuously — the `held` flag must absorb it.
- Exactly one `UP` per release.
- Both fire while focus is in Notepad, Chrome, and VS Code.

**If it fails:** check whether an antivirus or an existing hook-based tool is
blocking low-level hooks. Do not fall back to Electron `globalShortcut` — it
has no key-up event and cannot express hold-to-talk (§6.1).

## Spike 2 — paste without stealing focus

**Proves:** text can be inserted into the previously focused window, and the
clipboard survives.

```ts
import { clipboard } from 'electron' // spike: use `clipboardy` or node clipboard
import { keyboard, Key } from '@nut-tree-fork/nut-js'

const previous = await readClipboard()
await writeClipboard('spike inserted this')
await keyboard.pressKey(Key.LeftControl, Key.V)
await keyboard.releaseKey(Key.LeftControl, Key.V)
setTimeout(() => writeClipboard(previous), 150)
```

Run it with a 3-second delay at the top, then click into Notepad before it
fires — that simulates the real case where the target window already has focus.

**Pass criteria**
- Text lands in Notepad.
- Notepad never loses focus or flickers.
- Clipboard contents are restored afterward.
- Non-ASCII and emoji survive intact — this is the whole reason for clipboard
  insertion over simulated typing (§6.4).

**Known limitation to confirm, not fix:** repeat the spike against an
elevated terminal (Run as administrator). It will silently fail — Windows UIPI
blocks a non-elevated process from sending input to an elevated window. The
spike's job is to establish *how* it fails so Phase 2 can detect it and show
the "Can't type into this window" state (§11) instead of appearing to succeed.

## Spike 3 — 16kHz mono capture

**Proves:** audio can be captured at the target format and written to disk.

Needs a renderer context for `getUserMedia`, so this one runs in a minimal
Electron window or a plain browser page.

```ts
const stream = await navigator.mediaDevices.getUserMedia({
  audio: {
    channelCount: 1,
    sampleRate: 16000,
    echoCancellation: false,
    noiseSuppression: false,
  },
})
```

**Pass criteria**
- Output WAV is genuinely 16kHz mono — verify with a tool, do not trust the
  constraint. Browsers treat `sampleRate` as a hint and may hand back 44.1kHz,
  in which case downsampling has to happen explicitly.
- Peak amplitude is readable from the buffer. Phase 2 needs it for the
  silence guard (§6.6).
- Duration is measurable. Clips under 400ms get rejected before upload.

**Do not optimize this for latency.** §3 measured the format conversion as
worth ~150ms — inside run-to-run noise. Roughly 95% of the 1900ms is network,
not processing. Correctness here, speed later via connection reuse and chunked
upload (§3).

## The gate

All three pass → Phase 1. Any fail → stop and reconsider the approach before
writing app code.

Record the outcome — what passed, what the UIPI failure actually looked like,
and the real sample rate returned — in the project notes. Phase 2 depends on
those specifics.
