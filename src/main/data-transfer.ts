import { BrowserWindow, dialog } from 'electron'
import { readFile, writeFile } from 'node:fs/promises'
import { getDb, schema } from '../db/client.js'
import { rebuildDailyStats } from '../db/stats.js'
import { localDayKey } from '../shared/day.js'
import {
  BACKUP_APP,
  BACKUP_APP_LEGACY,
  BACKUP_FORMAT,
  SETTING_KEYS,
  countWords,
  type BackupDictation,
  type BackupFile,
  type BackupRule,
  type SettingKey,
  type Settings,
  type TransferResult,
} from '../shared/types.js'
import { readSetting, readSettings, writeSetting } from './settings.js'
import { onShortcutChanged } from './shortcut/index.js'
import { applyLoginItem } from './startup.js'
import { applyTheme } from './theme.js'

/**
 * Export and import as JSON (§9).
 *
 * Plain, readable JSON on purpose: it is the user's own data, there is nothing
 * to hide in it, and a format they can open in an editor is a format they can
 * salvage if this app ever stops running.
 *
 * Two things are deliberately NOT in the file:
 *   - the Groq API key, which lives in safeStorage and never touches disk in
 *     plaintext (§2);
 *   - `dailyStats`, which is derived — it is rebuilt after import rather than
 *     restored, so a stale or hand-edited number cannot poison the heatmap.
 */

function fileName(): string {
  return `typeflow-backup-${localDayKey(new Date())}.json`
}

/* ------------------------------------------------------------- export ---- */

export async function exportData(parent: BrowserWindow | null): Promise<TransferResult> {
  const dictations = getDb().select().from(schema.dictations).all()
  const dictionary = getDb().select().from(schema.dictionary).all()

  const payload: BackupFile = {
    app: BACKUP_APP,
    format: BACKUP_FORMAT,
    exportedAt: new Date().toISOString(),
    settings: readSettings(),
    dictionary: dictionary.map((r) => ({
      from: r.from,
      to: r.to,
      hitCount: r.hitCount,
      createdAt: r.createdAt.getTime(),
    })),
    dictations: dictations.map((r) => ({
      rawText: r.rawText,
      finalText: r.finalText,
      durationMs: r.durationMs,
      language: r.language,
      providerId: r.providerId,
      enhanced: r.enhanced,
      grammarFixes: r.grammarFixes,
      dictionaryFixes: r.dictionaryFixes,
      favorite: r.favorite,
      createdAt: r.createdAt.getTime(),
    })),
  }

  const result = parent
    ? await dialog.showSaveDialog(parent, {
        defaultPath: fileName(),
        filters: [{ name: 'JSON', extensions: ['json'] }],
      })
    : await dialog.showSaveDialog({
        defaultPath: fileName(),
        filters: [{ name: 'JSON', extensions: ['json'] }],
      })

  if (result.canceled || !result.filePath) return { status: 'cancelled' }

  try {
    // Indented: a backup nobody can read is a backup nobody will check.
    await writeFile(result.filePath, JSON.stringify(payload, null, 2), 'utf8')
  } catch (err) {
    return { status: 'error', problem: message(err, 'Could not write that file.') }
  }

  return {
    status: 'done',
    path: result.filePath,
    dictations: payload.dictations.length,
    dictionary: payload.dictionary.length,
    skipped: 0,
  }
}

/* ------------------------------------------------------------- import ---- */

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback)
const num = (v: unknown, fallback = 0): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback
const bool = (v: unknown): boolean => v === true

/**
 * The file came off disk and may have been edited, truncated or written by a
 * different version. Every field is coerced rather than trusted — an import
 * that throws halfway through is worse than one that drops a bad row.
 */
function parseBackup(raw: string): BackupFile | string {
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return 'That file is not valid JSON.'
  }

  if (!isObject(data)) return 'That file does not look like a TypeFlow AI backup.'
  if (data['app'] !== BACKUP_APP && data['app'] !== BACKUP_APP_LEGACY) {
    return 'That file was not exported by TypeFlow AI.'
  }
  if (num(data['format']) > BACKUP_FORMAT) {
    return 'That backup came from a newer version of TypeFlow AI.'
  }

  const dictations: BackupDictation[] = (
    Array.isArray(data['dictations']) ? data['dictations'] : []
  )
    .filter(isObject)
    .map((d) => ({
      rawText: str(d['rawText']),
      finalText: str(d['finalText']),
      durationMs: Math.max(0, num(d['durationMs'])),
      language: str(d['language'], 'en'),
      providerId: str(d['providerId'], 'unknown'),
      enhanced: bool(d['enhanced']),
      grammarFixes: Math.max(0, num(d['grammarFixes'])),
      dictionaryFixes: Math.max(0, num(d['dictionaryFixes'])),
      favorite: bool(d['favorite']),
      createdAt: num(d['createdAt'], Date.now()),
    }))
    // A dictation with no text at all is not worth a row.
    .filter((d) => d.rawText.trim() || d.finalText.trim())

  const dictionary: BackupRule[] = (Array.isArray(data['dictionary']) ? data['dictionary'] : [])
    .filter(isObject)
    .map((r) => ({
      from: str(r['from']).trim(),
      to: str(r['to']).trim(),
      hitCount: Math.max(0, num(r['hitCount'])),
      createdAt: num(r['createdAt'], Date.now()),
    }))
    .filter((r) => r.from && r.to)

  const settings: Settings = {}
  const rawSettings = isObject(data['settings']) ? data['settings'] : {}
  for (const key of SETTING_KEYS) {
    const value = rawSettings[key]
    if (typeof value === 'string') settings[key] = value
  }

  return {
    app: BACKUP_APP,
    format: num(data['format'], BACKUP_FORMAT),
    exportedAt: str(data['exportedAt']),
    settings,
    dictionary,
    dictations,
  }
}

/**
 * A device id identifies a microphone on the machine that recorded it and
 * nothing on any other. Restoring it would silently point capture at hardware
 * that is not there.
 */
const NOT_PORTABLE: SettingKey[] = ['microphoneId']

export async function importData(parent: BrowserWindow | null): Promise<TransferResult> {
  const options: Electron.OpenDialogOptions = {
    properties: ['openFile'],
    filters: [{ name: 'JSON', extensions: ['json'] }],
  }
  const picked = parent
    ? await dialog.showOpenDialog(parent, options)
    : await dialog.showOpenDialog(options)

  const path = picked.filePaths[0]
  if (picked.canceled || !path) return { status: 'cancelled' }

  let parsed: BackupFile | string
  try {
    parsed = parseBackup(await readFile(path, 'utf8'))
  } catch (err) {
    return { status: 'error', problem: message(err, 'Could not read that file.') }
  }
  if (typeof parsed === 'string') return { status: 'error', problem: parsed }

  const db = getDb()
  let addedDictations = 0
  let addedRules = 0
  let skipped = 0

  try {
    db.transaction((tx) => {
      // Importing the same file twice should not double the history, so
      // existing rows are matched on when they happened plus what was said.
      const seen = new Set(
        tx
          .select({ createdAt: schema.dictations.createdAt, rawText: schema.dictations.rawText })
          .from(schema.dictations)
          .all()
          .map((r) => `${r.createdAt.getTime()}|${r.rawText}`),
      )

      for (const d of parsed.dictations) {
        const key = `${d.createdAt}|${d.rawText}`
        if (seen.has(key)) {
          skipped += 1
          continue
        }
        seen.add(key)

        tx.insert(schema.dictations)
          .values({
            rawText: d.rawText,
            finalText: d.finalText,
            durationMs: d.durationMs,
            // Recomputed rather than imported: §8 defines a word, and a file
            // could disagree.
            words: countWords(d.finalText),
            language: d.language,
            providerId: d.providerId,
            enhanced: d.enhanced,
            grammarFixes: d.grammarFixes,
            dictionaryFixes: d.dictionaryFixes,
            favorite: d.favorite,
            createdAt: new Date(d.createdAt),
          })
          .run()
        addedDictations += 1
      }

      // Case-insensitive, because that is how replacement matches — see
      // db/dictionary.ts.
      const terms = new Set(
        tx
          .select({ from: schema.dictionary.from })
          .from(schema.dictionary)
          .all()
          .map((r) => r.from.toLowerCase()),
      )

      for (const rule of parsed.dictionary) {
        if (terms.has(rule.from.toLowerCase())) {
          skipped += 1
          continue
        }
        terms.add(rule.from.toLowerCase())

        tx.insert(schema.dictionary)
          .values({
            from: rule.from,
            to: rule.to,
            hitCount: rule.hitCount,
            createdAt: new Date(rule.createdAt),
          })
          .run()
        addedRules += 1
      }
    })
  } catch (err) {
    return { status: 'error', problem: message(err, 'Could not import that backup.') }
  }

  for (const [key, value] of Object.entries(parsed.settings)) {
    if (NOT_PORTABLE.includes(key as SettingKey)) continue
    writeSetting(key as SettingKey, value)
  }

  // Settings that are more than a stored string have to be re-applied, or the
  // restored shortcut would not take effect until the next launch.
  onShortcutChanged(readSetting('shortcut'))
  applyLoginItem(readSetting('launchOnStartup') === 'true')
  applyTheme(readSetting('theme'))

  // The file carries no day rows by design; they are derived from what just
  // landed in `dictations`.
  rebuildDailyStats()

  return {
    status: 'done',
    path,
    dictations: addedDictations,
    dictionary: addedRules,
    skipped,
  }
}

function message(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback
}
