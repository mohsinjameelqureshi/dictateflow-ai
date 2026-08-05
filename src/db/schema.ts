import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

/**
 * Schema per CLAUDE.md §8.
 *
 * Two things that are deliberate and should not be "fixed":
 *   - `rawText` is the source of truth. `finalText` is a convenience (§4).
 *   - There is no `statistics` table. Totals, averages and streaks are
 *     derived from `dailyStats` and `dictations`; a denormalised totals row
 *     drifts from reality for no benefit at this data volume.
 */
export const dictations = sqliteTable(
  'dictations',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    rawText: text('raw_text').notNull(),
    finalText: text('final_text').notNull(),
    durationMs: integer('duration_ms').notNull(),
    words: integer('words').notNull(),
    language: text('language').notNull().default('en'),
    providerId: text('provider_id').notNull(),
    enhanced: integer('enhanced', { mode: 'boolean' }).notNull().default(false),
    grammarFixes: integer('grammar_fixes').notNull().default(0),
    dictionaryFixes: integer('dictionary_fixes').notNull().default(0),
    favorite: integer('favorite', { mode: 'boolean' }).notNull().default(false),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  },
  (t) => [
    index('dictations_created_idx').on(t.createdAt),
    index('dictations_favorite_idx').on(t.favorite),
  ],
)

/**
 * Key-value. The API key is NOT stored here — safeStorage only (§2).
 * Known keys are enumerated in shared/types.ts.
 */
export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
})

/** Personal dictionary. Ships in v1 (§9) — deterministic, instant, free. */
export const dictionary = sqliteTable('dictionary', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  from: text('from_text').notNull().unique(),
  to: text('to_text').notNull(),
  hitCount: integer('hit_count').notNull().default(0),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
})

/** Pre-aggregated per-day, for the heatmap. Day key is local-time YYYY-MM-DD. */
export const dailyStats = sqliteTable('daily_stats', {
  day: text('day').primaryKey(),
  words: integer('words').notNull().default(0),
  sessions: integer('sessions').notNull().default(0),
  durationMs: integer('duration_ms').notNull().default(0),
})

export type Dictation = typeof dictations.$inferSelect
export type NewDictation = typeof dictations.$inferInsert
export type Setting = typeof settings.$inferSelect
export type DictionaryEntry = typeof dictionary.$inferSelect
export type NewDictionaryEntry = typeof dictionary.$inferInsert
export type DailyStat = typeof dailyStats.$inferSelect
