import { listArmedTransforms } from '../../db/transforms.js'
import { session } from '../dictation/session.js'
import { transformSession } from '../transform/session.js'
import { readSetting } from '../settings.js'
import { ShortcutHook, type Binding } from './hook.js'

/**
 * Owns the single global hook instance and connects it to the two capture
 * loops.
 *
 * Kept apart from `hook.ts` so that file stays a pure wrapper over
 * uiohook-napi with no knowledge of dictation, transforms, settings, or the
 * database. The hook emits binding ids; this file is the only place that knows
 * an id like 'transform:3' names a row.
 */
let hook: ShortcutHook | null = null

const DICTATION = 'dictation'
const TRANSFORM_PREFIX = 'transform:'

/** 'transform:3' -> 3, and null for anything else. */
function transformId(bindingId: string): number | null {
  if (!bindingId.startsWith(TRANSFORM_PREFIX)) return null
  const id = Number(bindingId.slice(TRANSFORM_PREFIX.length))
  return Number.isInteger(id) ? id : null
}

/**
 * The full binding set, read fresh from settings and the database.
 *
 * Rebuilt in full rather than patched, for the reason `setBindings` gives:
 * every caller already knows the whole world, and a diff would be more states
 * for the same answer.
 */
function bindings(): Binding[] {
  const list: Binding[] = [
    { id: DICTATION, shortcut: readSetting('shortcut'), mode: 'hold' },
  ]

  for (const rule of listArmedTransforms()) {
    list.push({ id: `${TRANSFORM_PREFIX}${rule.id}`, shortcut: rule.shortcut, mode: 'tap' })
  }

  return list
}

export function startShortcut(): void {
  if (hook) return

  hook = new ShortcutHook(bindings(), {
    // The two sessions are mutually exclusive — they drive the same widget and
    // the same clipboard. The check lives HERE because this is the only module
    // that already holds both; asking each session about the other would make
    // them import each other, and a cycle between two module-level singletons
    // breaks the moment someone reorders an import.
    onPress: (id) => {
      if (id === DICTATION && !transformSession.busy) void session.begin()
    },
    onRelease: (id) => {
      if (id === DICTATION) void session.finish()
    },
    // The keys are still down here, so nothing may be simulated yet (hook.ts
    // §#pendingTap). All this does is put the widget on screen, because the
    // press has to feel registered even though the work cannot start.
    onTapArmed: (id) => {
      const rule = transformId(id)
      if (rule !== null && !session.busy) transformSession.arm(rule)
    },
    onTap: (id) => {
      const rule = transformId(id)
      if (rule !== null) void transformSession.run(rule)
    },
    onCancel: () => {
      session.cancel()
      transformSession.cancel()
    },
  })

  hook.start()
}

/** The dictation combo changed. Everything else in the set is unaffected. */
export function onShortcutChanged(): void {
  hook?.setBindings(bindings())
}

/**
 * A transform rule was added, edited, deleted, enabled or disabled.
 *
 * Same call as above and deliberately so — there is one binding set and one
 * way to rebuild it. Two entry points exist only because the callers read
 * better that way.
 */
export function refreshTransformBindings(): void {
  hook?.setBindings(bindings())
}

/** Held only while the settings dialog is recording a new combo. */
export function setShortcutSuspended(suspended: boolean): void {
  hook?.setSuspended(suspended)
}

export function stopShortcut(): void {
  hook?.stop()
  hook = null
}
