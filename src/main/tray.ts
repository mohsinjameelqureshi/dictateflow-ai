import { Menu, Tray, app } from 'electron'
import { trayIcon } from './app-icon.js'
import { focusMainWindow, openSettings } from './windows/main-window.js'

/**
 * System tray: Open / Settings / Quit (§9).
 *
 * The app keeps running with no window open — the global hook is the primary
 * interface, and quitting on last-window-close would silently disable
 * dictation.
 */
let tray: Tray | null = null

export function createTray(): Tray {
  if (tray) return tray

  tray = new Tray(trayIcon())
  tray.setToolTip('DictateFlow AI')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open', click: () => focusMainWindow() },
      // Settings is a dialog in the main window, so this shows that window and
      // asks the renderer to open it.
      { label: 'Settings', click: () => openSettings() },
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() },
    ]),
  )
  tray.on('double-click', () => focusMainWindow())

  return tray
}
