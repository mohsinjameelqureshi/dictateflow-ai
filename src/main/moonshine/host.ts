import { utilityProcess, type UtilityProcess } from 'electron'
import { join } from 'node:path'
import {
  MOONSHINE_MODELS,
  isMoonshineSize,
  type MoonshineModelSize,
  type MoonshineProgress,
  type MoonshineStatus,
} from '../../shared/types.js'
import { readSetting } from '../settings.js'
import type {
  InspectReply,
  TranscribeReply,
  WorkerRequest,
  WorkerRequestInit,
  WorkerResponse,
} from './protocol.js'
import { deleteModel, looksComplete, modelBytesOnDisk, modelDir } from './store.js'

/**
 * The main-process handle on the Moonshine utilityProcess.
 *
 * Owns the child's lifetime and correlates requests to replies. Deliberately
 * the only module that knows a child process exists — the speech provider and
 * the IPC handlers both come through here.
 *
 * The child is spawned lazily and kept alive, because loading the model costs
 * seconds (MEASURED: 1.15s for Medium inside a utilityProcess, on top of 1.33s
 * to compile the WASM). Paying that per keystroke is exactly what the spec
 * warns against.
 */

const REQUEST_TIMEOUT_MS = 5 * 60_000

type Pending = {
  resolve: (value: TranscribeReply | InspectReply | null) => void
  reject: (err: Error) => void
  timer: NodeJS.Timeout
}

let child: UtilityProcess | null = null
let nextId = 1
const pending = new Map<number, Pending>()

/**
 * What the model card renders. Kept here so every surface agrees.
 *
 * Everything transient is keyed BY SIZE. A single set of globals looks
 * tempting — only one model downloads at a time — but it conflates the model
 * something happened to with the model being asked about: a failed Medium
 * download made an untouched Tiny report Medium's error, and a running Medium
 * download made Tiny render Medium's progress bar.
 *
 * `loadedSize` is the exception, and correctly so: exactly one model is
 * resident at a time, which is the fact it records.
 */
let loadedSize: MoonshineModelSize | null = null
/** The size currently downloading. Only one runs at a time. */
let downloading: MoonshineModelSize | null = null
const progressBySize = new Map<MoonshineModelSize, { bytes: number; totalBytes: number }>()
const failureBySize = new Map<MoonshineModelSize, string>()

type ProgressListener = (progress: MoonshineProgress) => void
type StatusListener = (status: MoonshineStatus) => void
const progressListeners = new Set<ProgressListener>()
const statusListeners = new Set<StatusListener>()

export function onMoonshineProgress(fn: ProgressListener): () => void {
  progressListeners.add(fn)
  return () => progressListeners.delete(fn)
}

export function onMoonshineStatus(fn: StatusListener): () => void {
  statusListeners.add(fn)
  return () => statusListeners.delete(fn)
}

/** Every caller has a size in hand, so the listener never has to guess one. */
function announce(size: MoonshineModelSize): void {
  const status = moonshineStatus(size)
  for (const fn of statusListeners) fn(status)
}

/* --------------------------------------------------------------- child ---- */

function workerPath(): string {
  // electron-vite emits this beside the main bundle. Not bundled INTO it: the
  // whole point is a second process with its own heap.
  return join(__dirname, 'moonshine-worker.js')
}

function spawn(): UtilityProcess {
  if (child) return child

  const proc = utilityProcess.fork(workerPath(), [], {
    serviceName: 'moonshine',
    // Inherit so the worker's failures land in the same log as everything
    // else. It prints nothing in normal operation.
    stdio: 'inherit',
  })

  proc.on('message', (message: WorkerResponse) => {
    if (message.kind === 'progress') {
      const { size, bytes, totalBytes, file } = message
      progressBySize.set(size, { bytes, totalBytes })
      // The worker already says which model this is for, so the size travels
      // with the event rather than being re-derived from the current setting —
      // which would name the wrong model the moment the two disagree.
      for (const fn of progressListeners) fn({ size, bytes, totalBytes, file })
      return
    }
    if (message.kind === 'ready') return

    const entry = pending.get(message.id)
    if (!entry) return
    pending.delete(message.id)
    clearTimeout(entry.timer)

    if (message.kind === 'ok') entry.resolve(message.result)
    else {
      const err = new Error(message.message)
      if (message.code) err.name = message.code
      entry.reject(err)
    }
  })

  proc.on('exit', () => {
    child = null
    loadedSize = null
    // Anything still in flight will never be answered. Failing them is the
    // only honest option — a hung promise would leave the widget spinning.
    for (const [, entry] of pending) {
      clearTimeout(entry.timer)
      entry.reject(new Error('The local engine stopped unexpectedly.'))
    }
    pending.clear()
    if (downloading) {
      const size = downloading
      downloading = null
      progressBySize.delete(size)
      failureBySize.set(size, 'The local engine stopped during the download.')
      announce(size)
    }
  })

  child = proc
  return proc
}

function request(req: WorkerRequestInit): Promise<TranscribeReply | InspectReply | null> {
  const proc = spawn()
  const id = nextId++

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new Error('The local engine stopped responding.'))
    }, REQUEST_TIMEOUT_MS)

    pending.set(id, { resolve, reject, timer })
    proc.postMessage({ ...req, id } as WorkerRequest)
  })
}

/* -------------------------------------------------------------- public ---- */

/** The size the user picked, falling back to the default on a bad value. */
export function selectedSize(): MoonshineModelSize {
  const raw = readSetting('moonshineModelSize')
  return isMoonshineSize(raw) ? raw : 'medium'
}

export function moonshineStatus(size = selectedSize()): MoonshineStatus {
  const onDisk = modelBytesOnDisk(size)
  const total = MOONSHINE_MODELS[size].bytes
  const problem = failureBySize.get(size)
  const live = progressBySize.get(size)

  let resolved: MoonshineStatus['state']
  // Order matters. A retry already in flight outranks the failure it is
  // retrying, and a failure outranks `looksComplete` — the whole point of a
  // corrupted file is that it is the right size and still does not load.
  if (downloading === size) resolved = 'downloading'
  else if (problem) resolved = 'error'
  else if (loadedSize === size || looksComplete(size)) resolved = 'ready'
  else if (onDisk > 0) resolved = 'partial'
  else resolved = 'absent'

  return {
    size,
    state: resolved,
    bytes: resolved === 'downloading' && live ? live.bytes : onDisk,
    totalBytes: resolved === 'downloading' && live && live.totalBytes > 0 ? live.totalBytes : total,
    ...(problem && resolved === 'error' ? { problem } : {}),
    loaded: loadedSize === size,
  }
}

/**
 * Fetch the model, then load it. Progress reaches the UI through the listeners.
 *
 * Safe to call when the files are already there: the worker verifies each one
 * against the manifest and only fetches what is missing or wrong.
 */
export async function downloadModel(size: MoonshineModelSize): Promise<MoonshineStatus> {
  // One at a time, whichever size it is: two concurrent fetches would compete
  // for the same bandwidth and make both progress bars a lie.
  if (downloading) return moonshineStatus(size)

  downloading = size
  failureBySize.delete(size)
  progressBySize.set(size, {
    bytes: modelBytesOnDisk(size),
    totalBytes: MOONSHINE_MODELS[size].bytes,
  })
  announce(size)

  try {
    await request({ kind: 'download', size, dir: modelDir(size) })
    downloading = null
    progressBySize.delete(size)
    announce(size)
    // Load straight away so the first dictation after a download is not the
    // one that pays for it. Still inside the try: a model that downloads but
    // will not load is a failure of this operation, not a success.
    await loadModel(size)
  } catch (err) {
    downloading = null
    progressBySize.delete(size)
    const message = err instanceof Error ? err.message : String(err)
    // Cancelling is a choice, not a fault. It leaves the model `partial`,
    // which the card offers to resume.
    const cancelled = message === 'cancelled' || (err as Error)?.name === 'cancelled'
    if (!cancelled) failureBySize.set(size, message)
    announce(size)
  }

  return moonshineStatus(size)
}

export function cancelDownload(): Promise<MoonshineStatus> {
  const size = downloading
  if (!size) return Promise.resolve(moonshineStatus())
  // Fire and forget: the in-flight `download` request rejects with `cancelled`
  // and that is what moves the state.
  void request({ kind: 'cancelDownload' }).catch(() => {})
  return Promise.resolve(moonshineStatus(size))
}

/** Load the model and hold it. Idempotent. */
export async function loadModel(size = selectedSize()): Promise<void> {
  if (loadedSize === size) return
  try {
    await request({ kind: 'load', size, dir: modelDir(size) })
  } catch (err) {
    // Recorded here rather than by each caller, because the caller that
    // matters most is a dictation — and the place the user can act on a bad
    // model is the Settings card, which is not where they are standing.
    failureBySize.set(size, err instanceof Error ? err.message : String(err))
    announce(size)
    throw err
  }
  loadedSize = size
  failureBySize.delete(size)
  announce(size)
}

/**
 * Make a model usable: fetch it first if it is not here, then load it.
 *
 * This is what an explicit engine choice runs. Picking a model the machine
 * does not have should get you that model — the alternative is a silent
 * no-op now and "Download the local model in Settings" on the next dictation,
 * which asks the user to go and repeat a choice they already made.
 *
 * Deliberately NOT what startup runs. Fetching 292MB is a consequence the user
 * has to have asked for, and at launch nobody asked.
 */
export function ensureModel(size = selectedSize()): void {
  if (looksComplete(size)) {
    loadModel(size).catch((err: unknown) => {
      console.warn('[moonshine] could not load the local model:', err)
    })
    return
  }
  // Records its own failures against the size and loads on success, so there
  // is nothing to catch here.
  void downloadModel(size)
}

export async function unloadModel(): Promise<void> {
  if (!child) {
    loadedSize = null
    return
  }
  await request({ kind: 'unload' }).catch(() => {})
  loadedSize = null
}

/** Remove a model from disk, unloading it first so the files are not held. */
export async function removeModel(size: MoonshineModelSize): Promise<MoonshineStatus> {
  if (loadedSize === size) await unloadModel()
  deleteModel(size)
  progressBySize.delete(size)
  // Whatever was wrong with it went out with the files.
  failureBySize.delete(size)
  announce(size)
  return moonshineStatus(size)
}

/**
 * Transcribe a complete WAV clip.
 *
 * Loads the model on demand if it is not up yet — that costs seconds and is
 * why `warmMoonshine` runs at startup, but a cold path that works beats one
 * that fails because nobody warmed it.
 */
export async function transcribeWav(wav: Uint8Array): Promise<TranscribeReply> {
  const size = selectedSize()
  if (loadedSize !== size) await loadModel(size)
  const result = await request({ kind: 'transcribe', wav })
  return result as TranscribeReply
}

/**
 * Bring the engine up at startup if it is the selected one (spec §10).
 *
 * Failures are logged and swallowed: the app must still open, and the error
 * surfaces where it is actionable — the model card in Settings, and the widget
 * on the first dictation.
 */
export function warmMoonshine(): void {
  if (readSetting('speechProvider') !== 'moonshine') return
  const size = selectedSize()
  if (!looksComplete(size)) return

  // `loadModel` has already recorded the failure against this size, so the
  // model card explains itself the moment Settings is opened. Nothing left to
  // do here but keep the app opening.
  loadModel(size).catch((err: unknown) => {
    console.warn('[moonshine] could not load the local model at startup:', err)
  })
}

/** Called on quit. The child does not outlive the app. */
export function stopMoonshine(): void {
  progressListeners.clear()
  statusListeners.clear()
  child?.kill()
  child = null
  loadedSize = null
}

/** True once the app has a usable local model, without touching the worker. */
export function moonshineReady(): boolean {
  return looksComplete(selectedSize())
}
