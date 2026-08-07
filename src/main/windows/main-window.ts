import { BrowserWindow, app, shell } from 'electron'
import { join } from 'node:path'
import { IPC_EVENT } from '../../shared/ipc-channels.js'
import type { SettingsTab } from '../../shared/types.js'
import { appIcon } from '../app-icon.js'
import { readFlag } from '../settings.js'
import { windowBackground } from '../theme.js'

/**
 * The main window. Frameless with a custom title bar (§12) — default Windows
 * chrome makes it feel like a web page in a box.
 *
 * Note this is NOT the widget. The widget (Phase 2) has different rules:
 * focusable:false, transparent, always-on-top. See §6.2. Those two are the
 * only windows: Settings is a dialog inside this one.
 */

let main: BrowserWindow | null = null

/**
 * Set once the tray's Quit is on its way. Without it, hide-on-close would
 * veto the close that `app.quit()` issues and the app could never exit.
 */
let quitting = false
app.on('before-quit', () => {
  quitting = true
})

/**
 * The widget is also a window, so "the main window" cannot be inferred from
 * `getAllWindows()`. The tray needs to name it exactly.
 */
export function getMainWindow(): BrowserWindow | null {
  return main && !main.isDestroyed() ? main : null
}

/**
 * Bring the main window up, building it if `minimizeToTray` is off and it was
 * torn down on close. Hidden, minimised, and destroyed all have to end with a
 * window the user is looking at.
 */
export function focusMainWindow(): BrowserWindow {
  const win = getMainWindow() ?? createMainWindow()
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
  return win
}

/**
 * Settings is a dialog in the main window, so opening it from main means
 * showing that window and telling the renderer which tab to select.
 *
 * `did-finish-load` rather than a bare send: the tray can ask for Settings
 * when there is no window at all, and an event sent at a renderer that has not
 * run its scripts yet is dropped with no error.
 */
export function openSettings(tab: SettingsTab = 'general'): void {
  const win = focusMainWindow()
  const send = (): void => win.webContents.send(IPC_EVENT.settingsNavigate, tab)

  if (win.webContents.isLoading()) win.webContents.once('did-finish-load', send)
  else send()
}

export function createMainWindow(): BrowserWindow {
  const existing = getMainWindow()
  if (existing) return existing

  const win = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 880,
    minHeight: 560,
    show: false,
    frame: false,
    icon: appIcon(),
    // Matches the theme before the renderer has painted anything — otherwise
    // a dark-mode launch flashes a white rectangle.
    backgroundColor: windowBackground(),
    // Keeps the OS window controls available to the custom bar on Windows.
    titleBarStyle: 'hidden',
    titleBarOverlay: false,
    autoHideMenuBar: true,
    webPreferences: {
      // .cjs, not .mjs — a sandboxed preload has no ESM context (§6.7).
      preload: join(__dirname, '../preload/index.cjs'),
      // §6.7 — not optional. This app runs a global keyboard hook and holds
      // an API key.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  })

  // Avoid the white flash: show only once the renderer has painted.
  win.on('ready-to-show', () => win.show())

  // External links go to the real browser, never in-app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  // Closing NEVER quits, either way — the global hook is the primary interface
  // and quitting here would silently disable dictation (§9). The setting only
  // decides whether the window is kept loaded or torn down and rebuilt.
  win.on('close', (event) => {
    if (quitting || !readFlag('minimizeToTray')) return
    event.preventDefault()
    win.hide()
  })

  win.on('closed', () => {
    main = null
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) void win.loadURL(devUrl)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))

  main = win
  return win
}
