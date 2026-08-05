import { getDb, schema } from '../../db/client.js'
import { eq } from 'drizzle-orm'
import { DEFAULT_SETTINGS } from '../../shared/types.js'
import { session } from '../dictation/session.js'
import { ShortcutHook } from './hook.js'

/**
 * Owns the single global hook instance and connects it to the capture loop.
 *
 * Kept apart from `hook.ts` so that file stays a pure wrapper over
 * uiohook-napi with no knowledge of dictation, settings, or the database.
 */
let hook: ShortcutHook | null = null

function storedShortcut(): string {
  const row = getDb()
    .select()
    .from(schema.settings)
    .where(eq(schema.settings.key, 'shortcut'))
    .get()
  return row?.value ?? DEFAULT_SETTINGS.shortcut
}

export function startShortcut(): void {
  if (hook) return

  hook = new ShortcutHook(storedShortcut(), {
    onPress: () => void session.begin(),
    onRelease: () => void session.finish(),
    onCancel: () => session.cancel(),
  })

  hook.start()
}

export function onShortcutChanged(shortcut: string): void {
  hook?.setShortcut(shortcut)
}

export function stopShortcut(): void {
  hook?.stop()
  hook = null
}
