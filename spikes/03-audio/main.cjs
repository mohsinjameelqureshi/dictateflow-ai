/**
 * Spike 3 — 16kHz mono WAV capture.
 *
 * getUserMedia only exists in a renderer, so this spike needs an Electron
 * window. Everything else about it is standalone.
 *
 * Main process here does two jobs only: host the window, and write the
 * finished WAV to disk.
 */
const { app, BrowserWindow, ipcMain, shell } = require('electron')
const path = require('node:path')
const fs = require('node:fs/promises')
const os = require('node:os')

const OUT_DIR = path.join(os.tmpdir(), 'wispr-spike-audio')

function createWindow() {
  const win = new BrowserWindow({
    width: 520,
    height: 620,
    title: 'Spike 3 — audio capture',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  })
  win.setMenuBarVisibility(false)
  win.loadFile(path.join(__dirname, 'index.html'))
}

ipcMain.handle('save-wav', async (_e, { bytes, meta }) => {
  await fs.mkdir(OUT_DIR, { recursive: true })
  const name = `clip-${new Date().toISOString().replace(/[:.]/g, '-')}.wav`
  const file = path.join(OUT_DIR, name)
  await fs.writeFile(file, Buffer.from(bytes))
  const { size } = await fs.stat(file)

  console.log(
    `wrote ${file}  ${size} bytes  ` +
      `${meta.sampleRate}Hz ${meta.channels}ch ${meta.durationMs}ms peak=${meta.peak.toFixed(4)}`,
  )
  return { file, size }
})

ipcMain.handle('reveal', async () => {
  await fs.mkdir(OUT_DIR, { recursive: true })
  shell.openPath(OUT_DIR)
})

// Auto-approve the mic prompt so the spike measures capture, not permissions.
app.whenReady().then(() => {
  const ses = require('electron').session.defaultSession
  ses.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === 'media'))
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => app.quit())
