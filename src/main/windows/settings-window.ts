import { BrowserWindow, shell } from 'electron'
import { join } from 'node:path'
import { IPC_EVENT } from '../../shared/ipc-channels.js'
import type { SettingsTab } from '../../shared/types.js'
import { appIcon } from '../app-icon.js'
import { setShortcutSuspended } from '../shortcut/index.js'
import { windowBackground } from '../theme.js'

/**
 * Settings, as its own window.
 *
 * It is a third renderer entry point rather than a route inside the main
 * window, for the same reason the widget is: it is a different window with
 * different rules. It carries the full `wispr` surface — it has to read and
 * write settings and the API key — so it gets the same locked-down
 * webPreferences as the main window (§6.7).
 *
 * Deliberately NOT modal. Modal would freeze the main window behind it, and
 * there is nothing here that must be answered before the rest of the app can
 * be used.
 */

let settings: BrowserWindow | null = null

export function getSettingsWindow(): BrowserWindow | null {
  return settings && !settings.isDestroyed() ? settings : null
}

export function openSettingsWindow(tab?: SettingsTab): BrowserWindow {
  const existing = getSettingsWindow()
  if (existing) {
    if (existing.isMinimized()) existing.restore()
    existing.show()
    existing.focus()
    if (tab) existing.webContents.send(IPC_EVENT.settingsNavigate, tab)
    return existing
  }

  const win = new BrowserWindow({
    width: 880,
    height: 640,
    minWidth: 720,
    minHeight: 520,
    show: false,
    frame: false,
    icon: appIcon(),
    // Settings opens on demand, long after the startup broadcast, so it reads
    // the current theme itself rather than flashing light and correcting.
    backgroundColor: windowBackground(),
    titleBarStyle: 'hidden',
    titleBarOverlay: false,
    autoHideMenuBar: true,
    maximizable: false,
    webPreferences: {
      // .cjs, not .mjs — a sandboxed preload has no ESM context (§6.7).
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  })

  win.on('ready-to-show', () => {
    win.show()
    if (tab) win.webContents.send(IPC_EVENT.settingsNavigate, tab)
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  // Closing mid-capture must not leave the global hook deafened — that would
  // disable dictation with no visible cause and no way back except a restart.
  win.on('closed', () => {
    settings = null
    setShortcutSuspended(false)
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) void win.loadURL(`${devUrl}/settings.html`)
  else void win.loadFile(join(__dirname, '../renderer/settings.html'))

  settings = win
  return win
}
