/**
 * Spike 2 — clipboard insertion without stealing focus.
 *
 * Proves:
 *   1. we can identify the target window before inserting  (§6.2)
 *   2. Ctrl+V lands in that window, not in this process
 *   3. the user's clipboard survives the round trip          (§6.4)
 *   4. focus is unchanged afterwards
 *
 * Run it, then alt-tab to Notepad within the countdown.
 *
 * Pass: the text appears in Notepad, the "before" and "after" window titles
 *       match, and the restored clipboard equals the sentinel.
 */
import { clipboard, keyboard, Key, getActiveWindow, sleep } from '@nut-tree-fork/nut-js'

// Default is 300ms per press AND per release — 600ms of dead time on every
// single dictation. Non-obvious, and it matters at our latency budget.
keyboard.config.autoDelayMs = 0

const TEXT = 'Hello from DictateFlow spike 2 — ünïcödé and 🎤 included.'
const SENTINEL = `clipboard-sentinel-${Date.now()}`
const RESTORE_DELAY_MS = 150

const countdown = async (n) => {
  for (let i = n; i > 0; i--) {
    process.stdout.write(`  focus your target window… ${i} \r`)
    await sleep(1000)
  }
  process.stdout.write('  '.padEnd(40) + '\r')
}

const activeTitle = async () => {
  try {
    return await (await getActiveWindow()).title
  } catch {
    return '<unavailable>'
  }
}

console.log('Spike 2 — clipboard insertion\n')

// The user's real clipboard. We stand in a known value so we can prove
// restoration actually happened rather than assuming it.
await clipboard.setContent(SENTINEL)
console.log(`  seeded clipboard with sentinel`)

await countdown(5)

// §6.2: capture the target BEFORE we touch anything.
const before = await activeTitle()
console.log(`  target window : ${before}`)

const previous = await clipboard.getContent()

const t0 = Date.now()
await clipboard.setContent(TEXT)
await keyboard.pressKey(Key.LeftControl, Key.V)
await keyboard.releaseKey(Key.LeftControl, Key.V)
const pasteMs = Date.now() - t0

const after = await activeTitle()

await sleep(RESTORE_DELAY_MS)
await clipboard.setContent(previous)
const restored = await clipboard.getContent()

console.log(`\n  paste took    : ${pasteMs}ms`)
console.log(`  window before : ${before}`)
console.log(`  window after  : ${after}`)
console.log(`  focus kept    : ${before === after ? 'YES' : 'NO  <-- FAIL'}`)
console.log(`  clipboard restored : ${restored === SENTINEL ? 'YES' : `NO  <-- FAIL (got "${restored}")`}`)
console.log(`\n  Check the target window actually contains the text, including the emoji.`)
console.log(`  If it is empty and the window was elevated, that is the UIPI limit (§6.4).`)

process.exit(0)
