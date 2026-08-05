import { BrowserWindow, app, session } from 'electron'
import { closeDb, initDb } from '../db/client.js'
import { registerIpcHandlers } from './ipc/handlers.js'
import { createMainWindow } from './windows/main-window.js'

// Single instance: a second launch should focus the existing window, not
// open a second one holding the same SQLite file.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows()
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })

  app.whenReady().then(() => {
    // Renderer runs no remote content, so lock the CSP down. Vite's dev
    // server needs inline styles and a websocket for HMR.
    const dev = !!process.env['ELECTRON_RENDERER_URL']
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [
            dev
              ? "default-src 'self' 'unsafe-inline' data: blob:; script-src 'self' 'unsafe-inline' 'unsafe-eval'; connect-src 'self' ws: http://localhost:*"
              : "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'",
          ],
        },
      })
    })

    // Nothing in this app needs camera, geolocation, or notifications yet.
    // Microphone is granted in Phase 2, to the widget only.
    session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => {
      callback(false)
    })

    initDb()
    registerIpcHandlers()
    createMainWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
    })
  })

  // Windows-only app, so quitting on window close is correct. Revisit when
  // minimize-to-tray lands in Phase 5.
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('will-quit', () => closeDb())
}
