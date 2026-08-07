import { eq } from 'drizzle-orm'
import { getDb, schema } from '../db/client.js'
import { DEFAULT_SETTINGS, type SettingKey, type Settings } from '../shared/types.js'

/**
 * The settings table, read through one door.
 *
 * The capture loop, the IPC layer, the global hook and the main window all
 * needed the same "stored value, else the default" logic. Four copies of it is
 * how a default silently diverges from what §8 says it is.
 *
 * Side effects of a write — rebinding the hook, toggling the login item — do
 * NOT live here. This module would have to import the hook, which imports the
 * dictation session, which reads settings. See ipc/handlers.ts instead.
 */

export function readSettings(): Settings {
  const rows = getDb().select().from(schema.settings).all()
  return { ...DEFAULT_SETTINGS, ...Object.fromEntries(rows.map((r) => [r.key, r.value])) }
}

export function readSetting(key: SettingKey): string {
  const row = getDb().select().from(schema.settings).where(eq(schema.settings.key, key)).get()
  return row?.value ?? DEFAULT_SETTINGS[key]
}

export function writeSetting(key: SettingKey, value: string): void {
  getDb()
    .insert(schema.settings)
    .values({ key, value })
    .onConflictDoUpdate({ target: schema.settings.key, set: { value } })
    .run()
}

/** Settings are stored as text (§8), so booleans need one agreed spelling. */
export function readFlag(key: SettingKey): boolean {
  return readSetting(key) === 'true'
}
