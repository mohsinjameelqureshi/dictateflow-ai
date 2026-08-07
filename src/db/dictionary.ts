import { and, asc, desc, eq, ne, sql } from 'drizzle-orm'
import { getDb, schema } from './client.js'
import { validateRule, type DictionaryDto, type DictionaryWrite } from '../shared/types.js'
import type { DictionaryEntry } from './schema.js'

/**
 * Personal dictionary CRUD (§9).
 *
 * The replacement itself lives in services/enhance/dictionary.ts — this file
 * only owns storage. Ordering note that belongs to the caller, not here: the
 * replacement runs AFTER any LLM step, never before.
 */

const toDto = (row: DictionaryEntry): DictionaryDto => ({
  id: row.id,
  from: row.from,
  to: row.to,
  hitCount: row.hitCount,
  createdAt: row.createdAt.getTime(),
})

/**
 * Most-used first, then alphabetical.
 *
 * The capture loop reads rules in this same order and applies them in
 * sequence, so a frequently-hit rule gets first refusal on overlapping text.
 */
export function listDictionary(): DictionaryDto[] {
  return getDb()
    .select()
    .from(schema.dictionary)
    .orderBy(desc(schema.dictionary.hitCount), asc(schema.dictionary.from))
    .all()
    .map(toDto)
}

/**
 * `from_text` is UNIQUE, but SQLite compares it case-sensitively while
 * `applyDictionary` matches case-insensitively. Without this check "groq" and
 * "Groq" would both be storable, both fire on the same word, and double-count
 * every fix in the §8 statistics.
 */
function duplicate(from: string, exceptId?: number): boolean {
  const clash = sql`lower(${schema.dictionary.from}) = ${from.trim().toLowerCase()}`
  const row = getDb()
    .select({ id: schema.dictionary.id })
    .from(schema.dictionary)
    .where(exceptId === undefined ? clash : and(clash, ne(schema.dictionary.id, exceptId)))
    .get()
  return !!row
}

export function createRule(from: string, to: string): DictionaryWrite {
  const problem = validateRule(from, to)
  if (problem) return { ok: false, problem }
  if (duplicate(from)) return { ok: false, problem: `"${from.trim()}" is already in your dictionary.` }

  const [row] = getDb()
    .insert(schema.dictionary)
    .values({ from: from.trim(), to: to.trim(), createdAt: new Date() })
    .returning()
    .all()

  if (!row) return { ok: false, problem: 'Could not save that rule.' }
  return { ok: true, entry: toDto(row) }
}

export function updateRule(id: number, from: string, to: string): DictionaryWrite {
  const problem = validateRule(from, to)
  if (problem) return { ok: false, problem }
  if (duplicate(from, id)) {
    return { ok: false, problem: `"${from.trim()}" is already in your dictionary.` }
  }

  const [row] = getDb()
    .update(schema.dictionary)
    .set({ from: from.trim(), to: to.trim() })
    .where(eq(schema.dictionary.id, id))
    .returning()
    .all()

  if (!row) return { ok: false, problem: 'That rule no longer exists.' }
  return { ok: true, entry: toDto(row) }
}

export function deleteRule(id: number): boolean {
  const rows = getDb()
    .delete(schema.dictionary)
    .where(eq(schema.dictionary.id, id))
    .returning({ id: schema.dictionary.id })
    .all()
  return rows.length > 0
}
