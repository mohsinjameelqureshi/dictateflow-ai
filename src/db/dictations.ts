import { eq } from 'drizzle-orm'
import { getDb, schema } from './client.js'
import { countWords, type DictationDto, type NewDictationDto } from '../shared/types.js'
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
  createdAt: row.createdAt.getTime(),
})

/** 'YYYY-MM-DD' in LOCAL time — §8 defines streaks in the local timezone. */
export function localDayKey(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

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
