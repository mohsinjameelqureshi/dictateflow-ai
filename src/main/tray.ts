import { BrowserWindow, Menu, Tray, app } from 'electron'
import { trayIcon } from './app-icon.js'
import { createMainWindow, getMainWindow } from './windows/main-window.js'
import { openSettingsWindow } from './windows/settings-window.js'

/**
 * System tray: Open / Settings / Quit (§9).
 *
 * The app keeps running with no window open — the global hook is the primary
 * interface, and quitting on last-window-close would silently disable
 * dictation.
 */
let tray: Tray | null = null

/**
 * The main window is named explicitly rather than found by scanning windows.
 * With Settings now a window of its own, "the first focusable window" is a
 * coin toss.
 */
function focusMain(): BrowserWindow {
  const win = getMainWindow() ?? createMainWindow()
  if (win.isMinimized()) win.restore()
  // It may be hidden rather than destroyed — that is what minimizeToTray does.
  win.show()
  win.focus()
  return win
}

export function createTray(): Tray {
  if (tray) return tray

  tray = new Tray(trayIcon())
  tray.setToolTip('Wispr AI')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open', click: () => focusMain() },
      // Settings is its own window now, so the tray opens it directly instead
      // of routing a navigation through the main window.
      { label: 'Settings', click: () => openSettingsWindow() },
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() },
    ]),
  )
  tray.on('double-click', () => focusMain())

  return tray
}
