import { session } from '../dictation/session.js'
import { readSetting } from '../settings.js'
import { ShortcutHook } from './hook.js'

/**
 * Owns the single global hook instance and connects it to the capture loop.
 *
 * Kept apart from `hook.ts` so that file stays a pure wrapper over
 * uiohook-napi with no knowledge of dictation, settings, or the database.
 */
let hook: ShortcutHook | null = null

export function startShortcut(): void {
  if (hook) return

  hook = new ShortcutHook(readSetting('shortcut'), {
    onPress: () => void session.begin(),
    onRelease: () => void session.finish(),
    onCancel: () => session.cancel(),
  })

  hook.start()
}

export function onShortcutChanged(shortcut: string): void {
  hook?.setShortcut(shortcut)
}

/** Held only while the settings window is recording a new combo. */
export function setShortcutSuspended(suspended: boolean): void {
  hook?.setSuspended(suspended)
}

export function stopShortcut(): void {
  hook?.stop()
  hook = null
}
