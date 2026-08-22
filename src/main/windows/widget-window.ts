import { BrowserWindow, screen } from 'electron'
import { join } from 'node:path'
import { WIDGET_ROLE_ARG } from '../../shared/ipc-channels.js'
import type { IpcEventMap } from '../../shared/types.js'

/**
 * The floating dictation widget (§6.2, §6.3).
 *
 * Two rules dominate this file and neither is negotiable:
 *   1. It must never take focus. If it does, the "currently focused
 *      application" becomes the widget and the inserted text goes nowhere —
 *      silently, with the paste succeeding into a window nobody is looking at.
 *   2. Its position is derived from `workArea`, never from pixel offsets.
 *
 * The window is created once at startup and hidden between dictations rather
 * than destroyed. That keeps the renderer's AudioContext and worklet warm,
 * which is where most of the 38–74ms of clipped audio measured in
 * spikes/README.md comes from.
 */

/**
 * Sized to the compact pill + waveform, not the old 280px bar.
 *
 * Widened from 150 in 1.1.0. The pill inside is `w-fit`, so this is a CEILING
 * rather than a size — dictation still renders exactly as narrow as it did.
 * What changed is that a transform's label is the rule's own name ("Enhance
 * prompt…"), and at 150 every name past about twelve characters was truncated
 * to an ellipsis, which defeats the reason the name is shown at all.
 */
const WIDGET_W = 240
const WIDGET_H = 52

/** Gap from the work-area edge — NOT from the screen edge. That is the point. */
const EDGE_GAP = 24

let widget: BrowserWindow | null = null

export function createWidgetWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: WIDGET_W,
    height: WIDGET_H,
    show: false,
    frame: false,
    transparent: true,
    focusable: false, // ← non-negotiable (§6.2)
    skipTaskbar: true,
    alwaysOnTop: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    hasShadow: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      // Tells the shared preload bundle to expose ONLY the microphone surface
      // here — no database, no settings, no API key.
      additionalArguments: [WIDGET_ROLE_ARG],
      // §6.7 — this process runs a global keyboard hook and holds an API key.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  })

  // 'screen-saver' keeps it above full-screen apps, which normal alwaysOnTop
  // does not.
  win.setAlwaysOnTop(true, 'screen-saver')
  // It is a status readout, not a control. Without this it would swallow
  // clicks on whatever sits under the bottom centre of the work area.
  win.setIgnoreMouseEvents(true)
  // Follow the user across virtual desktops rather than stranding the widget.
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) void win.loadURL(`${devUrl}/widget.html`)
  else void win.loadFile(join(__dirname, '../renderer/widget.html'))

  win.on('closed', () => {
    widget = null
  })

  widget = win
  return win
}

export function getWidgetWindow(): BrowserWindow | null {
  return widget && !widget.isDestroyed() ? widget : null
}

/**
 * Place the widget on the monitor containing the CURSOR — not the primary
 * display, and not wherever it happened to be last time.
 *
 * `workArea` already excludes the taskbar wherever it lives, at whatever DPI
 * scaling, which is why §6.3 forbids hardcoded offsets like "80px above the
 * taskbar".
 */
export function positionWidget(win: BrowserWindow): void {
  const point = screen.getCursorScreenPoint()
  const { workArea } = screen.getDisplayNearestPoint(point)

  const x = workArea.x + Math.round((workArea.width - WIDGET_W) / 2)
  const y = workArea.y + workArea.height - WIDGET_H - EDGE_GAP

  win.setBounds({ x, y, width: WIDGET_W, height: WIDGET_H })
}

/**
 * `showInactive` rather than `show`. Even with `focusable: false`, `show()`
 * asks the compositor to activate the window.
 */
export function showWidget(): void {
  const win = getWidgetWindow()
  if (!win) return
  positionWidget(win)
  win.showInactive()
}

export function hideWidget(): void {
  getWidgetWindow()?.hide()
}

/** Typed push to the widget renderer. */
export function sendToWidget<C extends keyof IpcEventMap>(
  channel: C,
  payload: IpcEventMap[C],
): void {
  const win = getWidgetWindow()
  if (!win) return
  win.webContents.send(channel, payload)
}
