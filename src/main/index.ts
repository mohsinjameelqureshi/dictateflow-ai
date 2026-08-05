import { BrowserWindow, app, session as electronSession } from 'electron'
import { closeDb, initDb } from '../db/client.js'
import { registerIpcHandlers } from './ipc/handlers.js'
import { startShortcut, stopShortcut } from './shortcut/index.js'
import { createTray } from './tray.js'
import { createMainWindow } from './windows/main-window.js'
import { createWidgetWindow, getWidgetWindow } from './windows/widget-window.js'

// Single instance: a second launch should focus the existing window, not
// open a second one holding the same SQLite file — or install a second
// global keyboard hook.
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
    electronSession.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [
            dev
              ? "default-src 'self' 'unsafe-inline' data: blob:; script-src 'self' 'unsafe-inline' 'unsafe-eval'; connect-src 'self' ws: http://localhost:*"
              : // `blob:` in script-src is for the AudioWorklet, which is
                // loaded from a Blob URL (worklets are governed by script-src).
                // Nothing remote is ever loaded — the Groq call happens in the
                // main process, which is why connect-src stays at 'self'.
                "default-src 'self'; script-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; worker-src 'self' blob:",
          ],
        },
      })
    })

    // Microphone is granted to the widget and nothing else. Camera,
    // geolocation and notifications stay denied everywhere.
    const isWidget = (wc: Electron.WebContents) => {
      const widget = getWidgetWindow()
      return !!widget && wc.id === widget.webContents.id
    }

    electronSession.defaultSession.setPermissionRequestHandler((wc, permission, callback) => {
      callback(permission === 'media' && isWidget(wc))
    })
    // Chromium checks some permissions without prompting; both handlers have
    // to agree or getUserMedia fails with NotAllowedError.
    electronSession.defaultSession.setPermissionCheckHandler((wc, permission) =>
      permission === 'media' && !!wc && isWidget(wc),
    )

    initDb()
    registerIpcHandlers()

    // The widget is created once and hidden between dictations, so its
    // AudioContext and worklet stay warm (§11, spikes/README.md).
    createWidgetWindow()
    createMainWindow()
    createTray()
    startShortcut()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
    })
  })

  // The global hook is the primary interface, so closing the window must not
  // quit — that would silently disable dictation. The tray is how you leave.
  app.on('window-all-closed', () => {
    /* intentionally empty: the app lives in the tray (§9) */
  })

  app.on('will-quit', () => {
    stopShortcut()
    closeDb()
  })
}
