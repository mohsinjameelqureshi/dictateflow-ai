import { app, safeStorage } from 'electron'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ApiKeyStatus } from '../shared/types.js'
import { resetSpeechProvider } from '../services/speech/index.js'

/**
 * The Groq API key — the only secret in the app (§2).
 *
 * It deliberately does NOT live in the settings table. safeStorage hands the
 * ciphertext to the Windows Credential Manager's DPAPI, keyed to this user
 * account, so a copied wispr.db is worthless on another machine.
 */
const FILE = () => join(app.getPath('userData'), 'groq-key.bin')

let memo: string | null | undefined

export function apiKeyStatus(): ApiKeyStatus {
  return {
    present: getApiKey() !== null,
    encryptionAvailable: safeStorage.isEncryptionAvailable(),
  }
}

export function getApiKey(): string | null {
  if (memo !== undefined) return memo

  const file = FILE()
  if (!existsSync(file)) return (memo = null)

  try {
    memo = safeStorage.decryptString(readFileSync(file))
  } catch {
    // Wrong user account, or the DPAPI blob was corrupted. Treat as absent
    // rather than throwing on every dictation forever.
    memo = null
  }
  return memo
}

export function setApiKey(key: string): ApiKeyStatus {
  const trimmed = key.trim()
  if (!trimmed) return clearApiKey()

  if (!safeStorage.isEncryptionAvailable()) {
    // Refuse rather than silently writing plaintext. §2 chose safeStorage
    // precisely so the key is never at rest in the clear.
    throw new Error('OS encryption is unavailable, so the key was not saved.')
  }

  writeFileSync(FILE(), safeStorage.encryptString(trimmed), { mode: 0o600 })
  memo = trimmed
  resetSpeechProvider()
  return apiKeyStatus()
}

export function clearApiKey(): ApiKeyStatus {
  rmSync(FILE(), { force: true })
  memo = null
  resetSpeechProvider()
  return apiKeyStatus()
}
