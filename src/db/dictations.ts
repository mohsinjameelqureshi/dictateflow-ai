import { and, count, desc, eq, isNotNull, lt, or, sql, type SQL } from 'drizzle-orm'
import { getDb, schema } from './client.js'
import { deleteRecording } from '../main/audio/store.js'
import { localDayKey } from '../shared/day.js'
import {
  countWords,
  type DictationDto,
  type ListDictationsQuery,
  type NewDictationDto,
} from '../shared/types.js'
import type { Dictation } from './schema.js'

export const toDto = (row: Dictation): DictationDto => ({
  id: row.id,
  rawText: row.rawText,
  finalText: row.finalText,
  durationMs: row.durationMs,
  words: row.words,
  language: row.language,
  providerId: row.providerId,
  enhanced: row.enhanced,
  grammarFixes: row.grammarFixes,
  dictionaryFixes: row.dictionaryFixes,
  favorite: row.favorite,
  // The filename never crosses the bridge — the renderer addresses a
  // recording by dictation id through the typeflow-audio scheme (§6.8).
  hasAudio: !!row.audioFile,
  audioBytes: row.audioBytes ?? null,
  createdAt: row.createdAt.getTime(),
})

/**
 * The single write path for a finished dictation. Both the capture loop and
 * the IPC handler go through here so the day aggregate can never be updated
 * by one and skipped by the other.
 */
export function createDictation(input: NewDictationDto): DictationDto {
  const db = getDb()
  const now = new Date()
  const words = countWords(input.finalText)

  // One transaction: the dictation and its day aggregate must not diverge.
  return db.transaction((tx): DictationDto => {
    const [row] = tx
      .insert(schema.dictations)
      .values({
        rawText: input.rawText,
        finalText: input.finalText,
        durationMs: input.durationMs,
        words,
        language: input.language ?? 'en',
        providerId: input.providerId,
        enhanced: input.enhanced ?? false,
        grammarFixes: input.grammarFixes ?? 0,
        dictionaryFixes: input.dictionaryFixes ?? 0,
        // §8 — the caller has already written the file. All three stay null
        // together when recordings are off or the write failed.
        audioFile: input.audioFile ?? null,
        audioBytes: input.audioBytes ?? null,
        audioMime: input.audioMime ?? null,
        createdAt: now,
      })
      .returning()
      .all()

    if (!row) throw new Error('insert returned no row')

    const day = localDayKey(now)
    const existing = tx.select().from(schema.dailyStats).where(eq(schema.dailyStats.day, day)).get()

    if (existing) {
      tx.update(schema.dailyStats)
        .set({
          words: existing.words + words,
          sessions: existing.sessions + 1,
          durationMs: existing.durationMs + input.durationMs,
        })
        .where(eq(schema.dailyStats.day, day))
        .run()
    } else {
      tx.insert(schema.dailyStats)
        .values({ day, words, sessions: 1, durationMs: input.durationMs })
        .run()
    }

    return toDto(row)
  })
}

/* ------------------------------------------------------------- reads ---- */

/**
 * Search covers `rawText` as well as `finalText`. Raw is the source of truth
 * (§4), so a word the dictionary rewrote must still be findable by what was
 * actually said.
 */
function filters(query: ListDictationsQuery | undefined): SQL | undefined {
  const parts: SQL[] = []
  if (query?.favoritesOnly) parts.push(eq(schema.dictations.favorite, true))

  const term = query?.search?.trim()
  if (term) {
    // A `%` or `_` typed into the search box would otherwise act as a
    // wildcard. SQLite has no default escape character, so escaping the input
    // is only meaningful alongside an explicit ESCAPE clause — which is why
    // this is raw SQL rather than drizzle's `like()`.
    const pattern = `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
    const clause = or(
      sql`${schema.dictations.finalText} like ${pattern} escape '\\'`,
      sql`${schema.dictations.rawText} like ${pattern} escape '\\'`,
    )
    if (clause) parts.push(clause)
  }

  if (parts.length === 0) return undefined
  return parts.length === 1 ? parts[0] : and(...parts)
}

export function listDictations(query?: ListDictationsQuery): DictationDto[] {
  const { limit = 50, offset = 0 } = query ?? {}
  return getDb()
    .select()
    .from(schema.dictations)
    .where(filters(query))
    .orderBy(desc(schema.dictations.createdAt), desc(schema.dictations.id))
    .limit(limit)
    .offset(offset)
    .all()
    .map(toDto)
}

/** Total matching the same filters, so the UI can say how much is left. */
export function countDictations(query?: ListDictationsQuery): number {
  const row = getDb()
    .select({ n: count() })
    .from(schema.dictations)
    .where(filters(query))
    .get()
  return row?.n ?? 0
}

/* ------------------------------------------------------------ writes ---- */

export function setFavorite(id: number, favorite: boolean): DictationDto | null {
  const [row] = getDb()
    .update(schema.dictations)
    .set({ favorite })
    .where(eq(schema.dictations.id, id))
    .returning()
    .all()
  return row ? toDto(row) : null
}

/**
 * Delete, with the day aggregate decremented in the SAME transaction.
 *
 * `dailyStats` is pre-aggregated (§8), which means nothing recomputes it from
 * `dictations` — so a delete that skipped this would leave Phase 4's heatmap
 * and streaks permanently counting a session that no longer exists.
 */
export function deleteDictation(id: number): boolean {
  const db = getDb()

  // Captured inside the transaction, deleted after it commits: a file removed
  // before the row is gone would leave a live row pointing at nothing if the
  // transaction then rolled back. §8 — a stray file is the acceptable failure,
  // a dangling row is not.
  let audioFile: string | null = null

  const deleted = db.transaction((tx): boolean => {
    const row = tx.select().from(schema.dictations).where(eq(schema.dictations.id, id)).get()
    if (!row) return false
    audioFile = row.audioFile

    tx.delete(schema.dictations).where(eq(schema.dictations.id, id)).run()

    const day = localDayKey(row.createdAt)
    const stat = tx.select().from(schema.dailyStats).where(eq(schema.dailyStats.day, day)).get()
    if (!stat) return true

    const sessions = stat.sessions - 1
    if (sessions <= 0) {
      // A day with no sessions must not linger as a zero row: §8 defines a
      // streak as consecutive days with ≥1 session, and a present-but-empty
      // day key would keep a broken streak alive.
      tx.delete(schema.dailyStats).where(eq(schema.dailyStats.day, day)).run()
    } else {
      tx.update(schema.dailyStats)
        .set({
          sessions,
          // Clamped: a row written before this path existed could underflow.
          words: Math.max(0, stat.words - row.words),
          durationMs: Math.max(0, stat.durationMs - row.durationMs),
        })
        .where(eq(schema.dailyStats.day, day))
        .run()
    }

    return true
  })

  if (deleted) deleteRecording(audioFile)
  return deleted
}

/**
 * Every filename currently referenced by a row. The sweep compares the disk
 * against this — see main/audio/store.ts.
 */
export function referencedRecordings(): Set<string> {
  const rows = getDb()
    .select({ file: schema.dictations.audioFile })
    .from(schema.dictations)
    .all()
  return new Set(rows.map((r) => r.file).filter((f): f is string => !!f))
}

/**
 * Forget every recording, without touching a transcript.
 *
 * Pairs with `clearRecordings()` in the store: that removes the files, this
 * removes the claim that they exist. Called in that order, so there is never
 * a row promising audio that is already gone.
 */
export function clearAudioColumns(): void {
  getDb()
    .update(schema.dictations)
    .set({ audioFile: null, audioBytes: null, audioMime: null })
    .where(isNotNull(schema.dictations.audioFile))
    .run()
}

/**
 * Drop recordings older than `days`, keeping favourites (§8) — favouriting is
 * the user saying keep this. Returns how many rows lost their audio.
 *
 * The ROW survives; only the audio goes. The transcript is the record, the
 * recording is the evidence, and retention is about disk, not history.
 */
export function expireRecordings(days: number): number {
  if (days <= 0) return 0

  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
  const rows = getDb()
    .select({ id: schema.dictations.id, file: schema.dictations.audioFile })
    .from(schema.dictations)
    .where(
      and(
        eq(schema.dictations.favorite, false),
        isNotNull(schema.dictations.audioFile),
        lt(schema.dictations.createdAt, cutoff),
      ),
    )
    .all()

  for (const row of rows) {
    // Row first here, unlike the write path: if the file delete fails, the
    // sweep collects it later. Clearing the columns first is what guarantees
    // the UI stops offering a control that cannot work.
    getDb()
      .update(schema.dictations)
      .set({ audioFile: null, audioBytes: null, audioMime: null })
      .where(eq(schema.dictations.id, row.id))
      .run()
    deleteRecording(row.file)
  }

  return rows.length
}
