import { asc, eq, sql } from 'drizzle-orm'
import { getDb, schema } from './client.js'
import {
  findShortcutConflict,
  normalizeShortcut,
  parseShortcut,
  validateShortcut,
  type ShortcutClaim,
} from '../shared/shortcut.js'
import {
  DEFAULT_SETTINGS,
  validateTransform,
  type NewTransformDto,
  type TransformDto,
  type TransformWrite,
} from '../shared/types.js'
import type { Transform } from './schema.js'

/**
 * Transform rule CRUD (docs/transform-feature-plan.md §3).
 *
 * The rewrite itself lives in services/transform/ and the run loop in
 * main/transform/session.ts — this file only owns storage and the one
 * invariant storage can actually enforce: no two shortcuts may be reachable
 * only through each other.
 */

const toDto = (row: Transform): TransformDto => ({
  id: row.id,
  name: row.name,
  rule: row.rule,
  shortcut: row.shortcut,
  enabled: row.enabled,
  hitCount: row.hitCount,
  sortOrder: row.sortOrder,
  createdAt: row.createdAt.getTime(),
})

/**
 * Insertion order, not usage order.
 *
 * The dictionary sorts by hit count because rules there are applied in
 * sequence and a frequent rule should get first refusal. Transforms are not
 * applied in sequence — exactly one fires, chosen by which key was pressed —
 * so reordering the list under the user would only make it hard to find a rule
 * twice in a row.
 */
export function listTransforms(): TransformDto[] {
  return getDb()
    .select()
    .from(schema.transforms)
    .orderBy(asc(schema.transforms.sortOrder), asc(schema.transforms.id))
    .all()
    .map(toDto)
}

/** Only the rules the hook should arm: enabled, and actually bound to something. */
export function listArmedTransforms(): TransformDto[] {
  return listTransforms().filter((t) => t.enabled && t.shortcut.length > 0)
}

export function getTransform(id: number): TransformDto | null {
  const row = getDb().select().from(schema.transforms).where(eq(schema.transforms.id, id)).get()
  return row ? toDto(row) : null
}

/**
 * The dictation combo, read straight from the settings table.
 *
 * Deliberately not imported from main/settings.ts: that module is main-process
 * only and importing it here would point the db layer at the layer above it.
 * The fallback is the same shared default, so the two cannot disagree.
 */
function dictationShortcut(): string {
  const row = getDb()
    .select()
    .from(schema.settings)
    .where(eq(schema.settings.key, 'shortcut'))
    .get()
  return row?.value ?? DEFAULT_SETTINGS.shortcut
}

/**
 * Everything a new combo has to avoid: dictation, and every other armed rule.
 *
 * A DISABLED rule still claims its shortcut. Two rules quietly sharing a combo
 * would work right up until the user enabled the second one, and then one of
 * them would silently stop firing — which is the worst possible moment to find
 * out. Better to refuse now, while they are looking at the field.
 */
function claims(exceptId?: number): ShortcutClaim[] {
  const rows = getDb()
    .select({ id: schema.transforms.id, name: schema.transforms.name, shortcut: schema.transforms.shortcut })
    .from(schema.transforms)
    .all()

  const list: ShortcutClaim[] = [{ shortcut: dictationShortcut(), owner: 'dictation' }]
  for (const row of rows) {
    if (row.id === exceptId || !row.shortcut) continue
    list.push({ shortcut: row.shortcut, owner: row.name })
  }
  return list
}

/**
 * Validate a write, or return the reason it cannot happen.
 *
 * An unbound rule ('' shortcut) is allowed: it is how the user parks a rule
 * they are still writing, and how a rule survives an import whose combo was
 * already taken on this machine.
 */
function check(input: NewTransformDto, exceptId?: number): string | null {
  const problem = validateTransform(input.name, input.rule)
  if (problem) return problem
  if (!input.shortcut) return null

  const shape = validateShortcut(input.shortcut, 'tap')
  if (shape) return shape

  return findShortcutConflict(input.shortcut, claims(exceptId))
}

/** Normalised so 'Alt+Ctrl+E' and 'Ctrl+Alt+E' cannot both be stored. */
const clean = (input: NewTransformDto): NewTransformDto => ({
  name: input.name.trim(),
  rule: input.rule.trim(),
  shortcut: normalizeShortcut(parseShortcut(input.shortcut)),
  ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
})

export function createTransform(input: NewTransformDto): TransformWrite {
  const next = clean(input)
  const problem = check(next)
  if (problem) return { ok: false, problem }

  // Appended, so a new rule lands at the bottom of the list the user is
  // looking at rather than somewhere in the middle of it.
  const last = getDb()
    .select({ max: sql<number | null>`max(${schema.transforms.sortOrder})` })
    .from(schema.transforms)
    .get()

  const [row] = getDb()
    .insert(schema.transforms)
    .values({
      name: next.name,
      rule: next.rule,
      shortcut: next.shortcut,
      enabled: next.enabled ?? true,
      sortOrder: (last?.max ?? -1) + 1,
      createdAt: new Date(),
    })
    .returning()
    .all()

  if (!row) return { ok: false, problem: 'Could not save that transform.' }
  return { ok: true, entry: toDto(row) }
}

export function updateTransform(id: number, input: NewTransformDto): TransformWrite {
  const next = clean(input)
  const problem = check(next, id)
  if (problem) return { ok: false, problem }

  const [row] = getDb()
    .update(schema.transforms)
    .set({
      name: next.name,
      rule: next.rule,
      shortcut: next.shortcut,
      ...(next.enabled === undefined ? {} : { enabled: next.enabled }),
    })
    .where(eq(schema.transforms.id, id))
    .returning()
    .all()

  if (!row) return { ok: false, problem: 'That transform no longer exists.' }
  return { ok: true, entry: toDto(row) }
}

export function deleteTransform(id: number): boolean {
  const rows = getDb()
    .delete(schema.transforms)
    .where(eq(schema.transforms.id, id))
    .returning({ id: schema.transforms.id })
    .all()
  return rows.length > 0
}

/**
 * Counted on the rule, not in `dictations` (plan §1).
 *
 * §8 defines WPM as words divided by RECORDING duration, and a transform has
 * no recording. A transform row in that table would silently corrupt WPM, the
 * word total, the session count and the streak heatmap all at once.
 *
 * Incremented in SQL rather than read-modify-write, for the same reason the
 * dictionary does it.
 */
export function bumpTransform(id: number): void {
  getDb()
    .update(schema.transforms)
    .set({ hitCount: sql`${schema.transforms.hitCount} + 1` })
    .where(eq(schema.transforms.id, id))
    .run()
}

/* ---------------------------------------------------------- transfer ---- */

/**
 * Import a rule from a backup, skipping one that is already here.
 *
 * "Already here" is by name AND rule text: the same rule imported twice is a
 * duplicate, but a rule the user has since edited is a different rule and
 * overwriting their edit with the backup's version would be data loss.
 *
 * A combo that clashes with something on THIS machine is dropped rather than
 * refused — the rule still imports, just unbound, and the user rebinds it.
 * Failing the whole import over a keyboard shortcut would be absurd.
 */
export function importTransform(input: {
  name: string
  rule: string
  shortcut: string
  enabled: boolean
  hitCount: number
  createdAt: number
}): boolean {
  const existing = getDb().select().from(schema.transforms).all()
  if (existing.some((row) => row.name === input.name && row.rule === input.rule)) return false

  const shortcut = normalizeShortcut(parseShortcut(input.shortcut))
  const usable =
    shortcut && !validateShortcut(shortcut, 'tap') && !findShortcutConflict(shortcut, claims())
      ? shortcut
      : ''

  getDb()
    .insert(schema.transforms)
    .values({
      name: input.name,
      rule: input.rule,
      shortcut: usable,
      enabled: input.enabled,
      hitCount: input.hitCount,
      sortOrder: existing.length,
      createdAt: new Date(input.createdAt),
    })
    .run()

  return true
}
