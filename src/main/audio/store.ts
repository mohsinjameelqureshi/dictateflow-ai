import { app } from 'electron'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The recordings directory (§8).
 *
 * Files live under `userData/recordings/`, one WAV per session, named with a
 * UUID. The database stores the FILENAME only — never an absolute path — and
 * this module is the only thing that turns a filename into a location on disk.
 * That indirection is why a reinstall or a moved profile does not orphan every
 * row at once.
 *
 * It also means every path that leaves here is one this module built, which is
 * half of the §6.8 traversal defence; the protocol handler re-checks the other
 * half rather than trusting a caller.
 */

export const AUDIO_MIME = 'audio/wav'

let cachedDir: string | null = null

/**
 * Where recordings live. Does NOT create anything — reads must not have side
 * effects, and the startup sweep reads on every single launch. Creating here
 * would mean a user who turned recordings off still gets an empty directory
 * in their profile for a feature they declined.
 */
export function recordingsDir(): string {
  return (cachedDir ??= join(app.getPath('userData'), 'recordings'))
}

/** Only the write path calls this. */
function ensureDir(): string {
  const dir = recordingsDir()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

/**
 * Resolve a stored filename to an absolute path, or null if it escapes the
 * directory.
 *
 * `basename` strips any traversal the caller supplied, and the prefix check
 * catches what basename cannot — a symlinked or otherwise odd name that still
 * resolves outside. §6.8 requires both; either one alone is a hole.
 */
export function resolveRecording(file: string): string | null {
  if (!file) return null
  const dir = recordingsDir()
  const abs = join(dir, basename(file))
  return abs.startsWith(dir) ? abs : null
}

/** Node's `path.basename` is POSIX/Win aware, but be explicit about intent. */
function basename(file: string): string {
  const cut = Math.max(file.lastIndexOf('/'), file.lastIndexOf('\\'))
  return cut === -1 ? file : file.slice(cut + 1)
}

export interface WrittenRecording {
  file: string
  bytes: number
  mime: string
}

/**
 * Write the clip and return what the row should record.
 *
 * §8 — the exact bytes that were sent to the provider, never re-encoded. The
 * reason to keep a recording is to hear what actually happened when a
 * transcript is wrong, and re-encoding destroys that evidence.
 *
 * Callers write the file BEFORE inserting the row. The reverse order leaves
 * rows pointing at nothing, which is worse than a stray file — a stray file is
 * swept on the next start, a dangling row is a permanently broken Play button.
 */
export function writeRecording(bytes: Uint8Array): WrittenRecording {
  const file = `${randomUUID()}.wav`
  writeFileSync(join(ensureDir(), file), bytes)
  return { file, bytes: bytes.byteLength, mime: AUDIO_MIME }
}

/** Missing is success: the caller wanted the file gone and it is gone. */
export function deleteRecording(file: string | null): void {
  if (!file) return
  const abs = resolveRecording(file)
  if (!abs) return
  try {
    rmSync(abs, { force: true })
  } catch {
    // Locked by a player that has not released it yet. The sweep on next
    // start will collect it — this is not worth failing a delete over.
  }
}

/**
 * Delete every file in the directory that no row references.
 *
 * The set of referenced filenames is passed in rather than read here: this
 * module owns the disk, `db/` owns the rows, and having the two meet in one
 * caller is what keeps either of them testable.
 */
export function sweepUnreferenced(referenced: ReadonlySet<string>): number {
  let removed = 0
  for (const name of listFiles()) {
    if (referenced.has(name)) continue
    deleteRecording(name)
    removed += 1
  }
  return removed
}

/** Total bytes on disk. §8 — Settings shows this, because ~1.9MB per spoken
 *  minute gets large quietly and the user should not meet it in Explorer. */
export function recordingsSize(): { files: number; bytes: number } {
  let bytes = 0
  let files = 0
  for (const name of listFiles()) {
    const abs = resolveRecording(name)
    if (!abs) continue
    try {
      bytes += statSync(abs).size
      files += 1
    } catch {
      // Raced with a delete. Not counting it is the correct answer.
    }
  }
  return { files, bytes }
}

/** Remove everything. Used by the Settings "clear recordings" action. */
export function clearRecordings(): number {
  let removed = 0
  for (const name of listFiles()) {
    deleteRecording(name)
    removed += 1
  }
  return removed
}

function listFiles(): string[] {
  try {
    return readdirSync(recordingsDir(), { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.wav'))
      .map((e) => e.name)
  } catch {
    return []
  }
}
