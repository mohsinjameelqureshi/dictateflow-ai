import { BrowserWindow, app, session as electronSession } from 'electron'
import { closeDb, initDb } from '../db/client.js'
import { runAudioMaintenance } from './audio/maintenance.js'
import { registerAudioProtocol, registerAudioScheme } from './audio/protocol.js'
import { AUDIO_SCHEME } from '../shared/types.js'
import { registerIpcHandlers } from './ipc/handlers.js'
import { readFlag } from './settings.js'
import { applyLoginItem } from './startup.js'
import { broadcastTheme, initTheme } from './theme.js'
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

  // Before whenReady, not inside it — registering a privileged scheme after
  // the app is ready throws, and the privileges are what let an <audio>
  // element range-request the file at all (§6.8).
  registerAudioScheme()

  // Must match `appId` in electron-builder.yml. Windows keys the taskbar
  // button — and the icon it shows — off this, not off the window. Without it
  // the app groups under the generic Electron entry in dev.
  app.setAppUserModelId('com.mjq.typeflow-ai')

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
              ? // `blob:` in script-src/worker-src is load-bearing, not cosmetic:
                // the AudioWorklet module is a Blob URL, and an explicit
                // script-src overrides default-src for it.
                // `media-src` is spelled out even though `default-src` would
                // cover it: the custom scheme is not in default-src, and
                // without this playback works in production but not in dev.
                `default-src 'self' 'unsafe-inline' data: blob:; script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:; worker-src 'self' blob:; media-src 'self' blob: ${AUDIO_SCHEME}:; connect-src 'self' ws: http://localhost:*`
              : // `blob:` in script-src is for the AudioWorklet, which is
                // loaded from a Blob URL (worklets are governed by script-src).
                // Nothing remote is ever loaded — the Groq call happens in the
                // main process, which is why connect-src stays at 'self'.
                //
                // `media-src typeflow-audio:` is what lets history play a
                // recording (§6.8). It is deliberately narrower than adding
                // file: — the scheme resolves an ID through the database, so
                // the renderer cannot name a path.
                `default-src 'self'; script-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self' ${AUDIO_SCHEME}:; connect-src 'self'; worker-src 'self' blob:`,
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
    // After initDb — the handler resolves a dictation id through the database,
    // so there must be a database to resolve it against.
    registerAudioProtocol()
    registerIpcHandlers()

    // Reconcile the OS login item with what the settings table says, so the
    // toggle is self-healing if the two ever drift.
    applyLoginItem(readFlag('launchOnStartup'))

    // Retention and the orphan sweep (§8). After initDb, before any window
    // can ask for a recording that expiry is about to remove.
    runAudioMaintenance()

    // The widget is created once and hidden between dictations, so its
    // AudioContext and worklet stay warm (§11, spikes/README.md).
    createWidgetWindow()
    createMainWindow()
    createTray()
    startShortcut()

    // After the windows exist, so the first broadcast reaches them. Renderers
    // also ask for the theme on mount, which covers a window opened later.
    initTheme()
    broadcastTheme()

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
