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
    /**
     * The recording (§8). Filename only, never an absolute path — the
     * directory is resolved at runtime so a reinstall or a moved profile does
     * not orphan every row at once.
     *
     * All three are nullable with no backfill, on purpose: this is an additive
     * migration onto a table that shipped in Phase 3. Those older rows have no
     * audio and must render a disabled control, not a broken one.
     */
    audioFile: text('audio_file'),
    audioBytes: integer('audio_bytes'),
    audioMime: text('audio_mime'),
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

/**
 * Transform rules — an LLM rewrite of text already in the focused field,
 * bound to its own tap shortcut. See docs/transform-feature-plan.md.
 *
 * `name` is deliberately NOT unique: two rules called "Fix it" are the user's
 * business. `shortcut` is what has to be unique, and uniqueness is not enough
 * there either — no two combos may be subsets of one another, which SQLite
 * cannot express. It is enforced in db/transforms.ts against the dictation
 * combo as well as the other rules.
 *
 * There is no per-rule provider column. One engine serves every rule (§1 of
 * the plan), stored in `settings` like every other preference.
 */
export const transforms = sqliteTable(
  'transforms',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    name: text('name').notNull(),
    /** The user's instruction. Becomes part of the system prompt, never the user turn. */
    rule: text('rule').notNull(),
    /** uiohook key names joined by '+', same wire format as the `shortcut` setting. */
    shortcut: text('shortcut').notNull().default(''),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    hitCount: integer('hit_count').notNull().default(0),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  },
  (t) => [index('transforms_sort_idx').on(t.sortOrder)],
)

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
export type Transform = typeof transforms.$inferSelect
export type NewTransform = typeof transforms.$inferInsert
