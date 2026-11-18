import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import test from 'node:test'
import ts from 'typescript'

const root = fileURLToPath(new URL('../', import.meta.url))

// Exercise the production TS without loading Electron/native input modules
// or opening the user's microphone. The deferred promises model a cold login.
function loadSource(relative, globals = {}, modules = {}) {
  const source = readFileSync(path.join(root, relative), 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  })
  const exports = {}
  const context = vm.createContext({
    exports, console, __dirname: path.dirname(path.join(root, relative)),
    process: { env: {} },
    require(name) {
      if (!(name in modules)) throw new Error(`Unexpected import: ${name}`)
      return modules[name]
    },
    ...globals,
  })
  vm.runInContext(outputText, context, { filename: relative })
  return exports
}

const channels = loadSource('src/shared/ipc-channels.ts')
const { IPC_EVENT } = channels

function widgetHarness() {
  const windows = []
  class FakeWindow extends EventEmitter {
    destroyed = false
    visible = false
    topCalls = []
    messages = []
    constructor(options) {
      super()
      this.options = options
      this.webContents = new EventEmitter()
      this.webContents.id = windows.length + 1
      this.webContents.send = (channel, payload) => this.messages.push({ channel, payload })
      windows.push(this)
    }
    isDestroyed() { return this.destroyed }
    setAlwaysOnTop(...args) { this.topCalls.push(args) }
    setIgnoreMouseEvents() {}
    setVisibleOnAllWorkspaces() {}
    setBounds(bounds) { this.bounds = bounds }
    loadFile() { this.webContents.emit('did-start-loading'); return Promise.resolve() }
    showInactive() { this.visible = true }
    hide() { this.visible = false }
    destroy() { this.destroyed = true; this.emit('closed') }
  }
  const api = loadSource('src/main/windows/widget-window.ts', {}, {
    electron: {
      BrowserWindow: FakeWindow,
      screen: {
        getCursorScreenPoint: () => ({ x: -500, y: 200 }),
        getDisplayNearestPoint: () => ({ workArea: { x: -1920, y: 0, width: 1920, height: 1040 } }),
      },
    },
    'node:path': path,
    '../../shared/ipc-channels.js': channels,
  })
  return { api, windows }
}

test('cold startup retains listening and start until widget listeners are ready', () => {
  const { api } = widgetHarness()
  const win = api.createWidgetWindow()
  api.sendToWidget(IPC_EVENT.widgetState, { state: 'listening' })
  api.showWidget()
  api.sendToWidget(IPC_EVENT.widgetCommand, { type: 'start', deviceId: 'external-mic' })
  assert.equal(win.messages.length, 0)
  assert.equal(win.visible, true)
  api.onWidgetReady(win.webContents)
  assert.equal(win.messages[0].payload.state, 'listening')
  assert.equal(win.messages[1].payload.type, 'start')
  assert.equal(win.messages[1].payload.deviceId, 'external-mic')
  assert.equal(win.options.focusable, false)
  assert.equal(win.options.webPreferences.sandbox, true)
  assert.equal(win.options.webPreferences.backgroundThrottling, false)
  assert.equal(win.bounds.x, -1080)
  assert.equal(win.bounds.y, 964)
})

test('release before widget mount keeps newest status and command order', () => {
  const { api } = widgetHarness()
  const win = api.createWidgetWindow()
  api.sendToWidget(IPC_EVENT.widgetState, { state: 'listening' })
  api.sendToWidget(IPC_EVENT.widgetCommand, { type: 'start', deviceId: '' })
  api.sendToWidget(IPC_EVENT.widgetState, { state: 'processing' })
  api.sendToWidget(IPC_EVENT.widgetCommand, { type: 'stop' })
  api.onWidgetReady(win.webContents)
  assert.equal(win.messages[0].payload.state, 'processing')
  assert.deepEqual(win.messages.slice(1).map((m) => m.payload.type), ['start', 'stop'])
})

test('only the widget can announce readiness and repeated announcements do not replay commands', () => {
  const { api } = widgetHarness()
  const win = api.createWidgetWindow()
  api.sendToWidget(IPC_EVENT.widgetCommand, { type: 'cancel' })
  api.onWidgetReady({ id: win.webContents.id + 1 })
  assert.equal(win.messages.length, 0)
  api.onWidgetReady(win.webContents)
  const count = win.messages.length
  api.onWidgetReady(win.webContents)
  assert.equal(win.messages.length, count)
})

test('tray-only hide/show reuses the ready widget and restores topmost order', () => {
  const { api, windows } = widgetHarness()
  const win = api.createWidgetWindow()
  api.onWidgetReady(win.webContents)
  api.showWidget()
  api.hideWidget()
  api.sendToWidget(IPC_EVENT.widgetState, { state: 'listening' })
  api.showWidget()
  assert.equal(api.createWidgetWindow(), win)
  assert.equal(windows.length, 1)
  assert.equal(win.visible, true)
  assert.equal(win.messages.at(-1).payload.state, 'listening')
  assert.deepEqual(win.topCalls.at(-1), [true, 'screen-saver'])
  assert.equal(win.topCalls.length, 3)
})

test('destroyed widget cannot replay a pending microphone command into a replacement', () => {
  const { api } = widgetHarness()
  const old = api.createWidgetWindow()
  api.sendToWidget(IPC_EVENT.widgetCommand, { type: 'start', deviceId: '' })
  old.destroy()
  const next = api.createWidgetWindow()
  api.onWidgetReady(old.webContents)
  assert.equal(next.messages.length, 0)
  api.onWidgetReady(next.webContents)
  assert.equal(next.messages.length, 1)
  assert.equal(next.messages[0].payload.state, 'cancelled')
})

function deferred() {
  let resolve
  const promise = new Promise((r) => { resolve = r })
  return { promise, resolve }
}

function recorderHarness({ warm = Promise.resolve(), microphone, resume = Promise.resolve() } = {}) {
  const requests = []
  class Context {
    sampleRate = 16000
    state = 'suspended'
    audioWorklet = { addModule: () => warm }
    resume() { return resume }
  }
  const { Recorder } = loadSource('src/renderer/widget/recorder.ts', {
    AudioContext: Context, Blob,
    URL: { createObjectURL: () => 'blob:test', revokeObjectURL() {} },
    navigator: { mediaDevices: { getUserMedia(constraints) {
      requests.push(constraints)
      return microphone?.promise ?? Promise.reject(new Error('Unexpected microphone request'))
    } } },
    performance: { now: () => 100 },
    cancelAnimationFrame() {},
  })
  return { recorder: new Recorder(), requests }
}

test('warming an idle widget does not open the microphone', async () => {
  const { recorder, requests } = recorderHarness()
  await recorder.warm()
  assert.equal(requests.length, 0)
  assert.equal(recorder.recording, false)
})

test('release during cold worklet warm-up prevents a late microphone start', async () => {
  const warm = deferred()
  const { recorder, requests } = recorderHarness({ warm: warm.promise })
  const starting = recorder.start('')
  const clip = recorder.stop()
  warm.resolve()
  await starting
  assert.equal(requests.length, 0)
  assert.equal(recorder.recording, false)
  assert.equal(clip.meta.durationMs, 0)
  assert.equal(clip.meta.samples, 0)
})

test('release while Windows is opening the microphone closes the late track', async () => {
  const microphone = deferred()
  const { recorder, requests } = recorderHarness({ microphone })
  const starting = recorder.start('')
  // Flush the resolved warm/resume steps, stopping during getUserMedia.
  for (let i = 0; i < 10 && requests.length === 0; i++) await Promise.resolve()
  assert.equal(requests.length, 1)
  recorder.stop()
  let stopped = 0
  microphone.resolve({ getTracks: () => [{ stop() { stopped++ } }] })
  await starting
  assert.equal(stopped, 1)
  assert.equal(recorder.recording, false)
})

test('cancel during AudioContext resume prevents opening the microphone', async () => {
  const resume = deferred()
  const { recorder, requests } = recorderHarness({ resume: resume.promise })
  const starting = recorder.start('')
  for (let i = 0; i < 10; i++) await Promise.resolve()
  recorder.cancel()
  resume.resolve()
  await starting
  assert.equal(requests.length, 0)
  assert.equal(recorder.recording, false)
})
