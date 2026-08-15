/**
 * The Moonshine utilityProcess.
 *
 * Everything about the local engine lives here: the 12.9MB WASM module, the
 * model download, and the loaded transcriber holding a ~300MB heap. Main keeps
 * only a handle.
 *
 * Why a separate process rather than the main one: a batch pass runs at roughly
 * 0.5x real time (MEASURED — docs/moonshine-integration-plan.md §1), so a 10s
 * dictation is ~5s of solid CPU. In the main process that would stall the
 * global hook, the tray and every IPC reply for those seconds.
 *
 * Why not a renderer: the widget is `sandbox: true` with `connect-src 'self'`,
 * and CLAUDE.md §6.7 fixes that. Running WASM there would need
 * `wasm-unsafe-eval` plus an opening to the model CDN, in the one renderer
 * holding microphone permission.
 *
 * Nothing here imports from `electron` — this is a plain Node entry point.
 */

import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, readFile, rename, stat, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { MOONSHINE_LANGUAGE, MOONSHINE_MODELS, type MoonshineModelSize } from '../../shared/types.js'
import type {
  InspectReply,
  TranscribeReply,
  WorkerRequest,
  WorkerResponse,
} from './protocol.js'

/* ------------------------------------------------------------ typings ---- */

/**
 * The slice of `@moonshine-ai/moonshine-wasm` this file uses.
 *
 * Declared locally because the package is loaded through a dynamic `import()`
 * resolved at runtime (it must stay external and outside the asar), so its own
 * types are not available to the bundler here.
 */
interface TranscriptLine {
  text: string
}
interface Transcript {
  lines: readonly TranscriptLine[]
}
interface RawTranscriber {
  transcribe(audio: Float32Array, options?: { sampleRate?: number }): Transcript
  setKeyterms(keyterms: string[]): void
  close(): void
}
interface MoonshineApi {
  loadMoonshineModule(): Promise<{
    sttDependencies(language: string, modelArch: string, includeSpelling: boolean): string
  }>
  Transcriber: {
    load(options: {
      files: Record<string, Uint8Array>
      modelArch: number
    }): Promise<RawTranscriber>
  }
}

/** One file in the model manifest the WASM module resolves for us. */
interface ManifestFile {
  name: string
  url: string
  size: number
  checksum?: string
  checksum_type?: string
}

/* ------------------------------------------------------------- crc32c ---- */

/**
 * Castagnoli CRC-32C. The manifest ships one per file, base64 of the big-endian
 * word, so a truncated or corrupted download is detectable without re-fetching
 * the whole 292MB. Spec §7.5: a half-downloaded model must be re-fetched, not
 * crash at load time.
 */
const CRC_TABLE = (() => {
  const t = new Int32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0x82f63b78 : c >>> 1
    t[i] = c
  }
  return t
})()

function crc32cUpdate(crc: number, buf: Uint8Array): number {
  let c = crc
  for (let i = 0; i < buf.length; i++) {
    c = (c >>> 8) ^ (CRC_TABLE[(c ^ (buf[i] as number)) & 0xff] as number)
  }
  return c
}

function crc32cSeal(crc: number): string {
  const out = Buffer.alloc(4)
  out.writeUInt32BE((~crc) >>> 0)
  return out.toString('base64')
}

function crc32cBase64(buf: Uint8Array): string {
  return crc32cSeal(crc32cUpdate(~0, buf))
}

/**
 * The same digest, streamed.
 *
 * These files run to 147MB and the whole reason to check one is to avoid
 * trusting it — holding it in memory to do that would defeat the point.
 */
async function crc32cOfFile(path: string): Promise<string> {
  let crc = ~0
  for await (const chunk of createReadStream(path)) {
    crc = crc32cUpdate(crc, chunk as Buffer)
  }
  return crc32cSeal(crc)
}

/**
 * Is the file on disk the one the manifest describes?
 *
 * Size alone is not enough, and the difference is not academic. A file that is
 * the right length but the wrong bytes — a bad sector, a write that was
 * flushed short and happened to land on the boundary — passes a size check,
 * fails its checksum at load time, and then survives every retry, because the
 * retry skipped re-fetching it for having the right size. Checking the
 * checksum here is what gives "Try again" something it can actually repair.
 */
async function isIntact(path: string, file: ManifestFile): Promise<boolean> {
  const info = await stat(path).catch(() => null)
  if (!info || info.size !== file.size) return false
  if (!file.checksum) return true
  return (await crc32cOfFile(path)) === file.checksum
}

/* --------------------------------------------------------------- state ---- */

let api: MoonshineApi | null = null
let transcriber: RawTranscriber | null = null
let loadedSize: MoonshineModelSize | null = null
let downloadAbort: AbortController | null = null

const port = process.parentPort

function send(message: WorkerResponse): void {
  port.postMessage(message)
}

/**
 * The binding is ESM and must stay external — Node's ESM loader cannot resolve
 * a package from inside an asar archive, so electron-builder unpacks it and it
 * is imported by name at runtime.
 */
async function moonshine(): Promise<MoonshineApi> {
  if (!api) {
    api = (await import('@moonshine-ai/moonshine-wasm')) as unknown as MoonshineApi
  }
  return api
}

async function manifestFiles(size: MoonshineModelSize): Promise<ManifestFile[]> {
  const m = await moonshine()
  const mod = await m.loadMoonshineModule()
  // §7.6 — the CDN path carries a version segment that will change. Resolving
  // it from the module means a model revision never needs an app release.
  // The language is a constant, not a parameter: see MOONSHINE_LANGUAGE.
  const raw = mod.sttDependencies(MOONSHINE_LANGUAGE, String(MOONSHINE_MODELS[size].arch), true)
  const parsed = JSON.parse(raw) as { groups?: { files?: ManifestFile[] }[] }
  return (parsed.groups ?? []).flatMap((g) => g.files ?? [])
}

/* ------------------------------------------------------------ download ---- */

/**
 * Fetch every missing file, resuming what is already partly there.
 *
 * Writes to `<name>.part` and renames only once the bytes verify, so an
 * interrupted download can never leave a file that looks complete but is not.
 */
async function download(size: MoonshineModelSize, dir: string): Promise<void> {
  const files = await manifestFiles(size)
  const totalBytes = files.reduce((n, f) => n + f.size, 0)
  await mkdir(dir, { recursive: true })

  downloadAbort = new AbortController()
  const { signal } = downloadAbort

  let done = 0
  for (const file of files) {
    if (signal.aborted) throw new Error('cancelled')

    const dest = join(dir, file.name)
    // Costs a full read of whatever is already here — a second or two across a
    // complete model. Worth it: this only runs when the user asked for a
    // download, and it is the difference between a retry that repairs a broken
    // file and one that skips straight past it.
    if (await isIntact(dest, file)) {
      done += file.size
      send({ kind: 'progress', size, bytes: done, totalBytes, file: file.name })
      continue
    }
    // Present but wrong. Remove it before fetching, so nothing downstream can
    // mistake the stale bytes for a finished file.
    await unlink(dest).catch(() => {})

    const part = `${dest}.part`
    // Resume from whatever a previous attempt managed to write.
    const already = (await stat(part).catch(() => null))?.size ?? 0
    const from = already > 0 && already < file.size ? already : 0
    if (already > file.size) await unlink(part).catch(() => {})

    const res = await fetch(file.url, {
      signal,
      ...(from > 0 ? { headers: { Range: `bytes=${from}-` } } : {}),
    })
    if (!res.ok && res.status !== 206) {
      throw new Error(`${file.name}: HTTP ${res.status}`)
    }
    // A server that ignored the Range header restarts the file rather than
    // appending a second copy onto the first.
    const append = from > 0 && res.status === 206
    if (!res.body) throw new Error(`${file.name}: empty response`)

    let received = append ? from : 0
    done += received
    const body = Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0])
    body.on('data', (chunk: Buffer) => {
      received += chunk.length
      done += chunk.length
      send({ kind: 'progress', size, bytes: done, totalBytes, file: file.name })
    })

    await pipeline(body, createWriteStream(part, append ? { flags: 'a' } : {}))
    if (signal.aborted) throw new Error('cancelled')

    // Verify BEFORE the rename. A file that fails here is discarded rather
    // than left to fail at load time with a much less useful message.
    if (file.checksum && (await crc32cOfFile(part)) !== file.checksum) {
      await unlink(part).catch(() => {})
      throw new Error(`${file.name} arrived corrupted. Try the download again.`)
    }
    await rename(part, dest)
    done = done - received + file.size
  }

  downloadAbort = null
}

/* -------------------------------------------------------------- verify ---- */

/** Which manifest files are present and pass their checksum. */
async function inspect(size: MoonshineModelSize, dir: string): Promise<InspectReply> {
  const files = await manifestFiles(size)
  const totalBytes = files.reduce((n, f) => n + f.size, 0)

  let bytes = 0
  let complete = true
  for (const file of files) {
    const info = await stat(join(dir, file.name)).catch(() => null)
    if (!info || info.size !== file.size) {
      complete = false
      bytes += info?.size ?? 0
      continue
    }
    bytes += file.size
  }
  return { bytes, totalBytes, complete }
}

/* ---------------------------------------------------------------- load ---- */

async function load(size: MoonshineModelSize, dir: string): Promise<void> {
  if (transcriber && loadedSize === size) return
  unload()

  const manifest = await manifestFiles(size)
  const files: Record<string, Uint8Array> = {}
  for (const file of manifest) {
    const bytes = await readFile(join(dir, file.name))
    if (bytes.byteLength !== file.size) {
      throw new Error(`${file.name} is incomplete. Re-download the model.`)
    }
    if (file.checksum && crc32cBase64(bytes) !== file.checksum) {
      throw new Error(`${file.name} is corrupted. Re-download the model.`)
    }
    files[file.name] = new Uint8Array(bytes)
  }

  const m = await moonshine()
  transcriber = await m.Transcriber.load({ files, modelArch: MOONSHINE_MODELS[size].arch })
  loadedSize = size
}

function unload(): void {
  try {
    transcriber?.close()
  } catch {
    // Already torn down, or the module is gone. Nothing to salvage.
  }
  transcriber = null
  loadedSize = null
}

/* ---------------------------------------------------------- transcribe ---- */

/**
 * Decode the canonical 16kHz mono 16-bit WAV the recorder produces.
 *
 * Chunk-walked rather than assuming a 44-byte header: the app writes exactly
 * that today, but a clip that came back through import or a future encoder
 * change should not silently transcribe header bytes as audio.
 */
function decodeWav(wav: Uint8Array): { audio: Float32Array; sampleRate: number } {
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength)
  if (wav.byteLength < 12 || view.getUint32(0, false) !== 0x52494646 /* RIFF */) {
    throw new Error('Not a WAV clip.')
  }

  let sampleRate = 16000
  let bitsPerSample = 16
  let channels = 1
  let offset = 12

  while (offset + 8 <= wav.byteLength) {
    const id = view.getUint32(offset, false)
    const size = view.getUint32(offset + 4, true)
    const body = offset + 8

    if (id === 0x666d7420 /* "fmt " */) {
      channels = view.getUint16(body + 2, true)
      sampleRate = view.getUint32(body + 4, true)
      bitsPerSample = view.getUint16(body + 14, true)
    } else if (id === 0x64617461 /* "data" */) {
      const end = Math.min(body + size, wav.byteLength)
      if (bitsPerSample !== 16) throw new Error(`Unsupported WAV depth: ${bitsPerSample}-bit.`)

      const frames = Math.floor((end - body) / 2 / channels)
      const audio = new Float32Array(frames)
      for (let i = 0; i < frames; i++) {
        // Mono in practice. If a clip ever arrives stereo, take the left
        // channel rather than refusing — the model wants mono either way.
        audio[i] = view.getInt16(body + i * 2 * channels, true) / 32768
      }
      return { audio, sampleRate }
    }

    // Chunks are word-aligned; an odd size carries a pad byte.
    offset = body + size + (size % 2)
  }

  throw new Error('WAV clip has no data chunk.')
}

function transcribe(wav: Uint8Array): TranscribeReply {
  if (!transcriber) throw new Error('The local model is not loaded.')

  const { audio, sampleRate } = decodeWav(wav)
  const startedAt = Date.now()
  const transcript = transcriber.transcribe(audio, { sampleRate })

  // Silence returns zero lines rather than a hallucinated phrase — MEASURED,
  // and the reason the local engine is strictly safer than Whisper on the
  // accidental-tap case CLAUDE.md §6.6 guards against.
  const text = transcript.lines
    .map((l) => l.text.trim())
    .filter(Boolean)
    .join(' ')
    .trim()

  return { text, durationMs: Date.now() - startedAt }
}

/* -------------------------------------------------------------- router ---- */

async function handle(req: WorkerRequest): Promise<TranscribeReply | InspectReply | null> {
  switch (req.kind) {
    case 'download':
      await download(req.size, req.dir)
      return null
    case 'cancelDownload':
      downloadAbort?.abort()
      downloadAbort = null
      return null
    case 'load':
      await load(req.size, req.dir)
      return null
    case 'unload':
      unload()
      return null
    case 'transcribe':
      return transcribe(req.wav)
    case 'inspect':
      return inspect(req.size, req.dir)
  }
}

port.on('message', (event: { data: WorkerRequest }) => {
  const req = event.data
  void handle(req)
    .then((result) => {
      send({ kind: 'ok', id: req.id, result })
    })
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err)
      send({
        kind: 'error',
        id: req.id,
        message,
        ...(message === 'cancelled' || (err as Error)?.name === 'AbortError'
          ? { code: 'cancelled' }
          : {}),
      })
    })
})

send({ kind: 'ready' })
