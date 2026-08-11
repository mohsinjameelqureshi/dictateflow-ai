import { app } from 'electron'
import { copyFileSync, cpSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const DB = 'dictateflow.db'
const LEGACY_DBS = ['typeflow.db', 'wispr.db'] as const
const LEGACY_DIRS = ['typeflow-ai', 'wispr-ai'] as const

function copyIfMissing(src: string, dst: string): void {
  if (existsSync(src) && !existsSync(dst)) copyFileSync(src, dst)
}

function migrateFrom(root: string, userData: string): boolean {
  let moved = false

  for (const legacyDb of LEGACY_DBS) {
    const src = join(root, legacyDb)
    if (existsSync(src)) {
      copyIfMissing(src, join(userData, DB))
      moved = true
      break
    }
  }

  copyIfMissing(join(root, 'groq-key.bin'), join(userData, 'groq-key.bin'))

  const recSrc = join(root, 'recordings')
  const recDst = join(userData, 'recordings')
  if (existsSync(recSrc) && !existsSync(recDst)) {
    cpSync(recSrc, recDst, { recursive: true })
    moved = true
  }

  return moved
}

/**
 * When the app id changes, Electron moves userData to a new folder. Copy the
 * database, API key blob and recordings forward once so an upgrade does not
 * look like a fresh install.
 */
export function migrateUserData(): void {
  const userData = app.getPath('userData')
  if (existsSync(join(userData, DB))) return

  mkdirSync(userData, { recursive: true })

  // Same folder — db filename changed but userData path did not.
  if (migrateFrom(userData, userData)) return

  // Previous product names — userData lived under a different folder name.
  const appData = app.getPath('appData')
  for (const legacyDir of LEGACY_DIRS) {
    const oldRoot = join(appData, legacyDir)
    if (existsSync(oldRoot) && migrateFrom(oldRoot, userData)) return
  }
}
