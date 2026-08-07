import { net, protocol } from 'electron'
import { eq } from 'drizzle-orm'
import { statSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { getDb, schema } from '../../db/client.js'
import { AUDIO_HOST, AUDIO_SCHEME } from '../../shared/types.js'
import { AUDIO_MIME, resolveRecording } from './store.js'

/**
 * Serving recordings to the renderer (§6.8).
 *
 * `sandbox: true` plus `contextIsolation: true` means the renderer has no
 * `fs`, and a `file://` URL in an <audio> element is blocked by the CSP.
 * Neither is weakened to make playback work — a custom scheme, resolved in the
 * main process, is the whole point.
 *
 * The URL carries a dictation ID and nothing else:
 *
 *     wispr-audio://clip/123
 *
 * The filename comes from the DATABASE, never from the renderer. A renderer
 * that could name the file could name `../../wispr.db` instead; here the worst
 * a compromised renderer can do is ask for a row that does not exist.
 *
 * The `clip/` segment is load-bearing, not decoration — see the note on
 * AUDIO_HOST in shared/types.ts, which is where both sides get the shape.
 */

/**
 * Must run BEFORE app.whenReady(). Registering late throws, and the privileges
 * are what make the scheme usable from a <audio> element at all: `stream` is
 * required for range requests, without which seeking silently does nothing.
 */
export function registerAudioScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: AUDIO_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
    },
  ])
}

/** Must run AFTER ready, and after initDb() — the handler reads rows. */
export function registerAudioProtocol(): void {
  protocol.handle(AUDIO_SCHEME, async (request) => {
    const found = resolve(request.url)
    if (!found) return new Response(null, { status: 404 })

    /**
     * The request's headers are deliberately NOT forwarded.
     *
     * `net.fetch` on a file: URL honours `Range` by returning only those bytes
     * — but with status 200 and no `Content-Range`. A media element that asks
     * for bytes 1000-2000 would be told "200, here is the whole resource",
     * 1001 bytes long, and its model of the file would be wrong from then on.
     *
     * Serving the whole file with an honest Content-Length is both simpler and
     * correct: these are local reads of a few MB, and a fully buffered clip
     * seeks without any range machinery. Revisit only if §15.4's 13-minute
     * 25MB ceiling starts mattering.
     */
    const file = await net.fetch(pathToFileURL(found.abs).toString())
    if (!file.ok) return new Response(null, { status: 404 })

    return new Response(file.body, {
      status: 200,
      headers: {
        // Both set explicitly. `net.fetch` on a file: URL returns neither, and
        // without a Content-Length the media element cannot know the duration
        // before it has read to the end — which shows up as a missing total
        // time and a seek bar that does nothing.
        'content-type': AUDIO_MIME,
        'content-length': String(found.size),
      },
    })
  })
}

/**
 * `wispr-audio://clip/123` -> absolute path and size, or null.
 *
 * The size comes from the same `stat` that proves the file exists, so serving
 * an honest Content-Length costs nothing extra. It is read from DISK rather
 * than from the row's `audio_bytes`: if the two ever disagree, the bytes on
 * disk are what the player is about to receive.
 */
function resolve(url: string): { abs: string; size: number } | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }

  // Reject anything that is not our exact shape rather than being lenient:
  // this is the only untrusted input the main process takes from the renderer.
  if (parsed.hostname !== AUDIO_HOST) return null

  const id = Number(parsed.pathname.slice(1))
  if (!Number.isInteger(id) || id <= 0) return null

  const row = getDb()
    .select({ file: schema.dictations.audioFile })
    .from(schema.dictations)
    .where(eq(schema.dictations.id, id))
    .get()

  if (!row?.file) return null

  const abs = resolveRecording(row.file)
  if (!abs) return null

  // The row can outlive its file — a manual delete, a failed write, a profile
  // copied without `recordings/`. 404 is the honest answer and the UI turns
  // the control into "No recording" rather than a player that never starts.
  try {
    const stat = statSync(abs)
    if (!stat.isFile()) return null
    return { abs, size: stat.size }
  } catch {
    return null
  }
}
