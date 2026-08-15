import type { MoonshineModelSize } from '../../shared/types.js'

/**
 * The wire between the main process and the Moonshine utilityProcess.
 *
 * Everything is request/response correlated by `id`, plus a small set of
 * unsolicited pushes (download progress, fatal errors). The worker holds the
 * WASM module and the ~300MB model heap; main holds nothing but a handle.
 *
 * Structured clone is the transport, so `Uint8Array` survives and `Buffer`
 * does not — audio crosses as `Uint8Array`, same rule as `ClipPayload`.
 */

/* ------------------------------------------------------- main -> worker ---- */

export type WorkerRequest =
  /** Resolve the manifest and fetch anything missing into `dir`. */
  | { kind: 'download'; id: number; size: MoonshineModelSize; dir: string }
  /** Abandon an in-flight download. Partial `.part` files are kept to resume. */
  | { kind: 'cancelDownload'; id: number }
  /**
   * Load the model into memory and hold it. Called at startup rather than on
   * the first hotkey — loading costs seconds and the user is already speaking.
   */
  | { kind: 'load'; id: number; size: MoonshineModelSize; dir: string }
  /** Drop the loaded transcriber, freeing the model heap. */
  | { kind: 'unload'; id: number }
  /** Batch transcribe a complete WAV clip. */
  | { kind: 'transcribe'; id: number; wav: Uint8Array }
  /** Report which files are present and verified, without loading anything. */
  | { kind: 'inspect'; id: number; size: MoonshineModelSize; dir: string }

/**
 * A request minus the `id` the host assigns.
 *
 * `Omit` is not distributive over a union — it would collapse every variant
 * down to the one key they all share (`kind`) and lose `size`, `dir` and
 * `wav`. Mapping over the union first keeps each variant intact.
 */
export type WorkerRequestInit = WorkerRequest extends infer T
  ? T extends WorkerRequest
    ? Omit<T, 'id'>
    : never
  : never

/* ------------------------------------------------------- worker -> main ---- */

export interface TranscribeReply {
  text: string
  /** Wall-clock inside the worker, so the caller can log a real RTF. */
  durationMs: number
}

export interface InspectReply {
  /** Bytes on disk that match the manifest's size and checksum. */
  bytes: number
  /** What the manifest says the complete model weighs. */
  totalBytes: number
  complete: boolean
}

export type WorkerResponse =
  | { kind: 'ok'; id: number; result: TranscribeReply | InspectReply | null }
  | { kind: 'error'; id: number; message: string; code?: string }
  /** Unsolicited: bytes fetched so far during a `download`. */
  | { kind: 'progress'; size: MoonshineModelSize; bytes: number; totalBytes: number; file: string }
  /** Unsolicited: the worker is up and the WASM module compiled. */
  | { kind: 'ready' }
