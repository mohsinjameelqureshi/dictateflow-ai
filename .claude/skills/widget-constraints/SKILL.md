---
name: widget-constraints
description: Non-negotiable constraints for the TypeFlow AI floating widget window — focus, positioning, security flags, and the complete state table. Read before creating or editing any BrowserWindow, anything under src/main/windows/ or src/renderer/widget/, or any code that positions or shows the widget.
---

# Widget constraints

These are the things that silently break. A widget that looks correct on the
primary monitor at 100% scaling can be completely broken at 150% on a second
display with a left-edge taskbar — and nothing will throw.

## 1. The widget must never take focus

If the widget takes focus, the "currently focused application" *becomes the
widget*, and the inserted text goes nowhere. There is no error. The paste
succeeds into a window nobody is looking at.

```ts
new BrowserWindow({
  frame: false,
  transparent: true,
  focusable: false,        // ← non-negotiable
  skipTaskbar: true,
  alwaysOnTop: true,
  resizable: false,
  webPreferences: {
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    preload: path.join(__dirname, 'preload.js'),
  },
})
win.setAlwaysOnTop(true, 'screen-saver')
```

**Capture the target window handle before showing the widget.** Once the
widget is up, "what had focus" is no longer answerable.

`focusable: false` also means the widget cannot receive keyboard events. Esc
cancellation is handled by the global hook in the main process, not by a
listener in the widget renderer.

## 2. Never hardcode pixel offsets

"80px above the taskbar" breaks with DPI scaling, side or top taskbars,
auto-hide, and mixed-scale multi-monitor setups.

```ts
const point = screen.getCursorScreenPoint()
const { workArea } = screen.getDisplayNearestPoint(point)

const x = workArea.x + Math.round((workArea.width - WIDGET_W) / 2)
const y = workArea.y + workArea.height - WIDGET_H - 24
```

`workArea` already excludes the taskbar wherever it lives. The `24` is a gap
from the work-area edge, not from a screen edge — that distinction is the
whole point.

The widget appears on **the monitor containing the cursor**, via
`getDisplayNearestPoint`. Not the primary display.

## 3. Security flags are not optional

`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, and a
typed preload bridge. This app runs a global keyboard hook and holds an API
key. Any change that relaxes these is a defect, not a tradeoff.

IPC channels are typed and enumerated in `shared/ipc-channels.ts`. No
stringly-typed channels, no generic pass-through bridge.

## 4. Every state in this table is required

The original spec covered only the happy path. All nine states ship.

| State | Shown | Notes |
|---|---|---|
| Listening | mic + live waveform | Appears **immediately** on key-down, before the mic is ready |
| Processing | spinner, "Transcribing…" | Visible on **every** use — make it good |
| Inserting | brief pulse | Usually <100ms |
| Success | check, "Inserted" | Auto-dismiss ~800ms |
| No speech | "Didn't catch that" | Clip too short or too quiet |
| Offline | "No connection" | Network dependency is real |
| Rate limited | "Rate limited — try again" | HTTP 429 |
| Blocked | "Can't type into this window" | Elevated-window UIPI failure |
| Cancelled | fade, no text | Esc during recording |

Two things people get wrong here:

**Listening renders before the mic is ready.** The widget is the feedback that
the key registered. Waiting for `getUserMedia` to resolve makes the app feel
broken on every use.

**Processing is not an edge case.** §3 measured a realistic floor of 800–1200ms
perceived. The user sees this state every single time. Do not design as if
insertion is instant.

## 5. Esc must cancel at any point

The app is about to type into the user's IDE. An abort path is essential, not
a nicety. Cancellation must work during recording, during upload, and during
transcription — which means the `AbortSignal` from `TranscribeOptions` gets
threaded all the way through, not dropped at the provider boundary.

Cancelled fades out and inserts nothing. It does not show an error.

## 6. Motion

Widget enter/exit and state transitions only — those carry meaning. Everything
else is noise. Respect `prefers-reduced-motion`.

## Checklist before calling widget work done

- [ ] `focusable: false`, verified by dictating into Notepad with the widget visible
- [ ] Target window handle captured before the widget shows
- [ ] Positioning derived from `workArea`, zero hardcoded screen offsets
- [ ] Correct at 125% and 150% DPI scaling
- [ ] Correct with the taskbar on the left edge
- [ ] Correct on a second monitor
- [ ] All nine states reachable and visually distinct
- [ ] Esc cancels during recording, upload, and transcription
- [ ] `contextIsolation` and `sandbox` intact
- [ ] `prefers-reduced-motion` respected
