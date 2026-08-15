import { app } from 'electron'
import { readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import {
  MOONSHINE_LANGUAGE,
  MOONSHINE_MODELS,
  type MoonshineModelSize,
} from '../../shared/types.js'

/**
 * Where the local speech models live on disk.
 *
 * `userData/models/<size>-<lang>/`, one directory per model size, holding the
 * flat set of `.ort` files the manifest names. This location is not incidental:
 *
 *   - it is per-user and writable without elevation, so a download never needs
 *     an admin prompt;
 *   - it SURVIVES app updates. The installer replaces the app directory, so a
 *     292MB model kept there would be deleted and re-fetched on every update.
 *
 * Never put a model in the install directory, and never make the renderer name
 * a path — the size is an enum and this module turns it into a location, the
 * same indirection audio/store.ts uses for recordings.
 */

let cachedRoot: string | null = null

export function modelsRoot(): string {
  return (cachedRoot ??= join(app.getPath('userData'), 'models'))
}

/** Absolute directory for one model size. Does not create it. */
export function modelDir(size: MoonshineModelSize): string {
  return join(modelsRoot(), `${size}-${MOONSHINE_LANGUAGE}`)
}

/**
 * Bytes on disk for a model, ignoring `.part` files.
 *
 * Deliberately cheap and approximate — it counts what is there, it does not
 * verify checksums. Completeness is the worker's answer (it has the manifest);
 * this exists so Settings can render something without spawning a process.
 */
export function modelBytesOnDisk(size: MoonshineModelSize): number {
  let bytes = 0
  for (const name of listFiles(size)) {
    if (name.endsWith('.part')) continue
    try {
      bytes += statSync(join(modelDir(size), name)).size
    } catch {
      // Raced with a delete. Not counting it is the correct answer.
    }
  }
  return bytes
}

/**
 * A cheap guess at whether a model looks usable, for the pre-worker UI.
 *
 * Within 1% of the manifest total is "probably ready" — the real check is
 * per-file crc32c in the worker, which is what actually gates loading.
 */
export function looksComplete(size: MoonshineModelSize): boolean {
  const want = MOONSHINE_MODELS[size].bytes
  return modelBytesOnDisk(size) >= want * 0.99
}

/** Total across every model size. Settings shows this next to recordings. */
export function modelsSize(): { models: number; bytes: number } {
  let models = 0
  let bytes = 0
  for (const size of Object.keys(MOONSHINE_MODELS) as MoonshineModelSize[]) {
    const b = modelBytesOnDisk(size)
    if (b > 0) {
      models += 1
      bytes += b
    }
  }
  return { models, bytes }
}

/**
 * Remove a model, partial downloads included.
 *
 * The caller must have unloaded it first — deleting files out from under a
 * live transcriber is how you get a crash instead of a freed 292MB.
 */
export function deleteModel(size: MoonshineModelSize): void {
  try {
    rmSync(modelDir(size), { recursive: true, force: true })
  } catch {
    // Locked, most likely by the worker still holding a handle. The next
    // delete or the next startup gets it; failing here helps nobody.
  }
}

function listFiles(size: MoonshineModelSize): string[] {
  try {
    return readdirSync(modelDir(size), { withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => e.name)
  } catch {
    return []
  }
}
