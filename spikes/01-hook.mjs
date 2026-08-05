/**
 * Spike 1 — global hold-to-talk detection.
 *
 * Proves three things Electron's globalShortcut cannot do:
 *   1. keyup fires at all
 *   2. a modifier-only combo (Ctrl+Win) can be a shortcut
 *   3. auto-repeat can be suppressed
 *
 * Pass: hold Ctrl+Win  -> exactly one START
 *       release either -> exactly one STOP, with a plausible duration
 *       hold 3 seconds -> still exactly one START (no repeat spam)
 *
 * Ctrl+C to quit.
 */
import { uIOhook, UiohookKey } from 'uiohook-napi'

// A combo is a set of keycodes that must all be physically down.
// Override for automated runs: `node 01-hook.mjs Ctrl+Alt` — synthesising a
// Win keypress would pop the Start menu.
const COMBO = new Set(
  (process.argv[2] ?? 'Ctrl+Meta').split('+').map((name) => {
    const code = UiohookKey[name]
    if (code === undefined) {
      console.error(`unknown key "${name}". valid: ${Object.keys(UiohookKey).join(', ')}`)
      process.exit(2)
    }
    return code
  }),
)

const NAMES = Object.fromEntries(
  Object.entries(UiohookKey).map(([k, v]) => [v, k]),
)

/** Physical keys currently down. uiohook has no "is this key down" query. */
const down = new Set()
let held = false
let startedAt = 0

const comboSatisfied = () => [...COMBO].every((code) => down.has(code))

uIOhook.on('keydown', (e) => {
  // Auto-repeat sends keydown continuously. The Set makes this idempotent,
  // but `held` is what actually guards the callback.
  down.add(e.keycode)

  if (!held && comboSatisfied()) {
    held = true
    startedAt = Date.now()
    console.log(`\n  ▶ START   ${new Date().toLocaleTimeString()}`)
  }
})

uIOhook.on('keyup', (e) => {
  down.delete(e.keycode)

  // Stop as soon as the combo is broken, not only when both are released.
  if (held && !comboSatisfied()) {
    held = false
    const ms = Date.now() - startedAt
    console.log(`  ■ STOP    held ${ms}ms  (released ${NAMES[e.keycode] ?? e.keycode})`)
    if (ms < 400) console.log(`    ↳ under 400ms — real app would discard this clip (§6.6)`)
  }
})

// Raw trace, so we can see auto-repeat happening and confirm it is absorbed.
let repeats = 0
uIOhook.on('keydown', (e) => {
  if (held && COMBO.has(e.keycode)) {
    repeats += 1
    if (repeats % 20 === 0) process.stdout.write(`    (${repeats} repeat keydowns absorbed)\r`)
  }
})
uIOhook.on('keyup', () => { repeats = 0 })

const comboLabel = [...COMBO].map((c) => NAMES[c]).join('+')
console.log('Spike 1 — global hook')
console.log(`Hold ${comboLabel}. Expect one START, one STOP. Ctrl+C to quit.`)
console.log('READY\n')

uIOhook.start()

const shutdown = () => {
  uIOhook.stop()
  console.log('\nstopped.')
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
