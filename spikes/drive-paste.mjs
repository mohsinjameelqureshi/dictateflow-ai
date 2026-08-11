/**
 * Drives spike 2 with a real target window.
 *
 * Launches Notepad, pastes into it, then reads the text back out via
 * Ctrl+A / Ctrl+C so the assertion is on what actually landed rather than
 * on the absence of an error.
 *
 * Two things this script learned the hard way:
 *
 *   1. Window TITLE is not window IDENTITY. Notepad renames its title bar to
 *      the document's first line, so a successful paste changes the title of
 *      the very window you are checking. Compare `windowHandle` (the HWND),
 *      which is also what §6.2 needs to capture before showing the widget.
 *
 *   2. Never kill the editor. Notepad is single-instance and tabbed, so the
 *      user may have unsaved work in another tab. This script clears only the
 *      tab it created and leaves the process alone.
 */
import { spawn } from 'node:child_process'
import { clipboard, keyboard, Key, getActiveWindow, sleep } from '@nut-tree-fork/nut-js'

keyboard.config.autoDelayMs = 0

const TEXT = 'Hello from DictateFlow spike 2 — ünïcödé and 🎤 included.'
const SENTINEL = `sentinel-${Date.now()}`
const RESTORE_DELAY_MS = 150

const title = async () => {
  try { return await (await getActiveWindow()).title } catch { return '<none>' }
}

/** HWND — stable across content changes, unlike the title. */
const handle = async () => {
  try { return (await getActiveWindow()).windowHandle } catch { return null }
}

const results = []
const check = (name, ok, detail) => {
  results.push([name, ok, detail])
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(28)} ${detail}`)
}

console.log('Spike 2 — driven against Notepad\n')

const np = spawn('notepad.exe', { detached: true, stdio: 'ignore' })
np.unref()

// Wait for Notepad to come up and take focus.
let target = ''
for (let i = 0; i < 40; i++) {
  await sleep(250)
  target = await title()
  if (/notepad/i.test(target)) break
}
if (!/notepad/i.test(target)) {
  console.error(`Notepad never took focus (saw "${target}"). Aborting.`)
  process.exit(1)
}
console.log(`  target window: ${target}\n`)

await clipboard.setContent(SENTINEL)
await sleep(100)

const before = await title()
const beforeHwnd = await handle()
const previous = await clipboard.getContent()

// ---- the actual §6.4 sequence ----
const t0 = Date.now()
await clipboard.setContent(TEXT)
await keyboard.pressKey(Key.LeftControl, Key.V)
await keyboard.releaseKey(Key.LeftControl, Key.V)
const pasteMs = Date.now() - t0
// -----------------------------------

await sleep(200)
const after = await title()
const afterHwnd = await handle()

await sleep(RESTORE_DELAY_MS)
await clipboard.setContent(previous)
const restored = await clipboard.getContent()

check(
  'focus preserved (hwnd)',
  beforeHwnd !== null && beforeHwnd === afterHwnd,
  `${beforeHwnd} -> ${afterHwnd}`,
)
if (before !== after) {
  console.log(`        note: title changed but HWND did not — Notepad renames`)
  console.log(`        its tab from the first line of content. Same window.`)
}
check('clipboard restored', restored === SENTINEL, restored === SENTINEL ? 'sentinel intact' : `got "${restored}"`)
check('paste latency', pasteMs < 200, `${pasteMs}ms`)

// Read back what Notepad actually holds.
await sleep(150)
await keyboard.pressKey(Key.LeftControl, Key.A)
await keyboard.releaseKey(Key.LeftControl, Key.A)
await sleep(100)
await keyboard.pressKey(Key.LeftControl, Key.C)
await keyboard.releaseKey(Key.LeftControl, Key.C)
await sleep(250)
const landed = (await clipboard.getContent()).replace(/\r?\n$/, '')

check('text landed', landed === TEXT, landed === TEXT ? 'exact match' : `got "${landed}"`)
check('accents survived', landed.includes('ünïcödé'), landed.includes('ünïcödé') ? 'ünïcödé' : 'mangled')
check('emoji survived', landed.includes('🎤'), landed.includes('🎤') ? '🎤' : 'mangled')

// Clear only the tab we created — the text is still selected from the Ctrl+A
// above. Notepad is left running: it is single-instance and tabbed, and
// killing it would risk unsaved work in someone else's tab.
await keyboard.type(Key.Delete)
await clipboard.setContent(previous)
console.log('\n  (Notepad left open — close the empty tab yourself.)')

const bad = results.filter(([, ok]) => !ok).length
console.log(`\n${bad === 0 ? 'spike 2 PASSES' : `${bad} check(s) failed`}`)
process.exit(bad === 0 ? 0 : 1)
