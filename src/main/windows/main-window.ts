import { BrowserWindow, shell } from 'electron'
import { join } from 'node:path'

/**
 * The main window. Frameless with a custom title bar (§12) — default Windows
 * chrome makes it feel like a web page in a box.
 *
 * Note this is NOT the widget. The widget (Phase 2) has different rules:
 * focusable:false, transparent, always-on-top. See §6.2.
 */
export function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 880,
    minHeight: 560,
    show: false,
    frame: false,
    backgroundColor: '#fbfbfd',
    // Keeps the OS window controls available to the custom bar on Windows.
    titleBarStyle: 'hidden',
    titleBarOverlay: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
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

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) void win.loadURL(devUrl)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))

  return win
}
