/**
 * Capture README screenshots from a built Electron app.
 * Usage: npm run build && node scripts/capture-screenshots.mjs
 */
import { _electron as electron } from 'playwright'
import electronPath from 'electron'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..')
const OUT = join(ROOT, 'docs', 'screenshots')
const MAIN = join(ROOT, 'out', 'main', 'index.js')

mkdirSync(OUT, { recursive: true })

const app = await electron.launch({
  executablePath: electronPath,
  args: [MAIN],
  cwd: ROOT,
  env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' },
})

const win = await app.firstWindow({ timeout: 60_000 })
await win.waitForLoadState('load')
await win.waitForTimeout(2000)

async function shot(name) {
  await win.screenshot({ path: join(OUT, name), type: 'png' })
  console.log(`wrote ${name}`)
}

await shot('dictation.png')

await win.getByRole('button', { name: 'Insights' }).click()
await win.waitForTimeout(500)
await shot('insights.png')

await win.getByRole('button', { name: 'Dictionary' }).click()
await win.waitForTimeout(500)
await shot('dictionary.png')

await win.getByRole('button', { name: 'Settings' }).click()
await win.waitForTimeout(800)
await shot('settings.png')

await app.close()
console.log('done')
