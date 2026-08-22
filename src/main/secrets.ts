import { app, safeStorage } from 'electron'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { MIN_API_KEY_LENGTH, type ApiKeyStatus, type SecretId } from '../shared/types.js'
import { resetEnhanceProvider } from '../services/enhance/index.js'
import { resetSpeechProvider } from '../services/speech/index.js'
import { resetTransformProvider } from '../services/transform/index.js'

/**
 * The stored secrets (§2). Groq, and — since 1.1.0 — Gemini for Transform.
 *
 * Neither lives in the settings table. safeStorage hands the ciphertext to the
 * Windows Credential Manager's DPAPI, keyed to this user account, so a copied
 * dictateflow.db is worthless on another machine. Adding a second secret does
 * not weaken that argument; it doubles it.
 *
 * Files are named per secret. The Groq filename is unchanged from 1.0.0 on
 * purpose — an existing install must keep its key across the upgrade.
 */
const FILE = (id: SecretId): string => join(app.getPath('userData'), `${id}-key.bin`)

/**
 * Decrypted values, memoised per secret. `undefined` means "not read yet";
 * `null` means "read, and there is none".
 */
const memo = new Map<SecretId, string | null>()

export function apiKeyStatus(id: SecretId): ApiKeyStatus {
  return {
    id,
    present: getSecret(id) !== null,
    encryptionAvailable: safeStorage.isEncryptionAvailable(),
  }
}

export function getSecret(id: SecretId): string | null {
  const hit = memo.get(id)
  if (hit !== undefined) return hit

  const file = FILE(id)
  if (!existsSync(file)) {
    memo.set(id, null)
    return null
  }

  try {
    const value = safeStorage.decryptString(readFileSync(file))
    memo.set(id, value)
    return value
  } catch {
    // Wrong user account, or the DPAPI blob was corrupted. Treat as absent
    // rather than throwing on every dictation forever.
    memo.set(id, null)
    return null
  }
}

/**
 * The Groq key, by its old name.
 *
 * Kept because it is read on the insert path in three places, and
 * `getSecret('groq')` at each of them would be three chances to pass the wrong
 * literal. Transcription and grammar cleanup are Groq-only; only Transform has
 * a choice to make.
 */
export function getApiKey(): string | null {
  return getSecret('groq')
}

export function setApiKey(id: SecretId, key: string): ApiKeyStatus {
  const trimmed = key.trim()
  if (!trimmed) return clearApiKey(id)

  // Deliberately NOT a prefix check any more.
  //
  // This used to reject anything not starting with a hardcoded prefix, and the
  // Gemini prefix was wrong — Google issues keys beginning `AQ.` as well as
  // `AIza`, so a valid key was refused with a confident message telling the
  // user it was malformed. Failing closed on a guess about another company's
  // credential format is the worst way to be wrong: the user has no way to
  // override it and every reason to believe us.
  //
  // What stays is a shape check loose enough to only catch a genuine slip — an
  // empty field, a pasted sentence, half a key. Whether it actually WORKS is
  // answered by asking the provider (`apiKey:verify`), which is the only party
  // that can know.
  if (/\s/.test(trimmed) || trimmed.length < MIN_API_KEY_LENGTH) {
    throw new Error('That does not look like a complete key. Check you copied all of it.')
  }

  if (!safeStorage.isEncryptionAvailable()) {
    // Refuse rather than silently writing plaintext. §2 chose safeStorage
    // precisely so the key is never at rest in the clear.
    throw new Error('OS encryption is unavailable, so the key was not saved.')
  }

  writeFileSync(FILE(id), safeStorage.encryptString(trimmed), { mode: 0o600 })
  memo.set(id, trimmed)
  invalidate(id)
  return apiKeyStatus(id)
}

export function clearApiKey(id: SecretId): ApiKeyStatus {
  rmSync(FILE(id), { force: true })
  memo.set(id, null)
  invalidate(id)
  return apiKeyStatus(id)
}

/**
 * Drop every cached client that authenticated with the key that just changed.
 *
 * Each of these caches a provider holding the OLD key. Missing one leaves that
 * step authenticating with a key the user has already replaced — which
 * presents as "I updated my key and it still says rejected".
 */
function invalidate(id: SecretId): void {
  if (id === 'groq') {
    resetSpeechProvider()
    resetEnhanceProvider()
  }
  // Transform can be pointed at either provider, so it is rebuilt whichever
  // key moved.
  resetTransformProvider()
}
