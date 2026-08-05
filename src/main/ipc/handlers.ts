import { BrowserWindow, app, ipcMain } from 'electron'
import { and, desc, eq, like, or } from 'drizzle-orm'
import { getDb, schema } from '../../db/client.js'
import { IPC } from '../../shared/ipc-channels.js'
import {
  DEFAULT_SETTINGS,
  countWords,
  type AppInfo,
  type DictationDto,
  type IpcMap,
  type ListDictationsQuery,
  type NewDictationDto,
  type SettingKey,
  type Settings,
} from '../../shared/types.js'
import type { Dictation } from '../../db/schema.js'

/**
 * Typed wrapper over ipcMain.handle. Keeps every handler's request and
 * response bound to the IpcMap, so a channel cannot silently change shape.
 */
function handle<C extends keyof IpcMap>(
  channel: C,
  fn: (arg: IpcMap[C][0], event: Electron.IpcMainInvokeEvent) => Promise<IpcMap[C][1]> | IpcMap[C][1],
): void {
  ipcMain.handle(channel, async (event, arg: IpcMap[C][0]) => fn(arg, event))
}

const toDto = (row: Dictation): DictationDto => ({
  id: row.id,
  rawText: row.rawText,
  finalText: row.finalText,
  durationMs: row.durationMs,
  words: row.words,
  language: row.language,
  providerId: row.providerId,
  enhanced: row.enhanced,
  grammarFixes: row.grammarFixes,
  dictionaryFixes: row.dictionaryFixes,
  favorite: row.favorite,
  createdAt: row.createdAt.getTime(),
})

/** 'YYYY-MM-DD' in LOCAL time — §8 defines streaks in the local timezone. */
function localDayKey(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function registerIpcHandlers(): void {
  /* ---------------------------------------------------------- window ---- */

  const senderWindow = (event: Electron.IpcMainInvokeEvent): BrowserWindow | null =>
    BrowserWindow.fromWebContents(event.sender)

  handle(IPC.windowMinimize, (_arg, event) => {
    senderWindow(event)?.minimize()
  })

  handle(IPC.windowMaximize, (_arg, event) => {
    const win = senderWindow(event)
    if (!win) return false
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
    return win.isMaximized()
  })

  handle(IPC.windowClose, (_arg, event) => {
    senderWindow(event)?.close()
  })

  handle(IPC.windowIsMaximized, (_arg, event) => senderWindow(event)?.isMaximized() ?? false)

  /* -------------------------------------------------------- settings ---- */

  handle(IPC.settingsGetAll, (): Settings => {
    const rows = getDb().select().from(schema.settings).all()
    const stored = Object.fromEntries(rows.map((r) => [r.key, r.value]))
    return { ...DEFAULT_SETTINGS, ...stored }
  })

  handle(IPC.settingsSet, ({ key, value }: { key: SettingKey; value: string }) => {
    getDb()
      .insert(schema.settings)
      .values({ key, value })
      .onConflictDoUpdate({ target: schema.settings.key, set: { value } })
      .run()
  })

  /* ------------------------------------------------------ dictations ---- */

  handle(IPC.dictationsList, (query: ListDictationsQuery | undefined): DictationDto[] => {
    const { limit = 50, offset = 0, search, favoritesOnly } = query ?? {}

    const filters = []
    if (favoritesOnly) filters.push(eq(schema.dictations.favorite, true))
    if (search && search.trim()) {
      const term = `%${search.trim()}%`
      // Search raw as well as final — raw is the source of truth (§4).
      filters.push(
        or(like(schema.dictations.finalText, term), like(schema.dictations.rawText, term)),
      )
    }

    const rows = getDb()
      .select()
      .from(schema.dictations)
      .where(filters.length ? and(...filters) : undefined)
      .orderBy(desc(schema.dictations.createdAt))
      .limit(limit)
      .offset(offset)
      .all()

    return rows.map(toDto)
  })

  handle(IPC.dictationsCreate, (input: NewDictationDto): DictationDto => {
    const db = getDb()
    const now = new Date()
    const words = countWords(input.finalText)

    // One transaction: the dictation and its day aggregate must not diverge.
    return db.transaction((tx): DictationDto => {
      const [row] = tx
        .insert(schema.dictations)
        .values({
          rawText: input.rawText,
          finalText: input.finalText,
          durationMs: input.durationMs,
          words,
          language: input.language ?? 'en',
          providerId: input.providerId,
          enhanced: input.enhanced ?? false,
          grammarFixes: input.grammarFixes ?? 0,
          dictionaryFixes: input.dictionaryFixes ?? 0,
          createdAt: now,
        })
        .returning()
        .all()

      if (!row) throw new Error('insert returned no row')

      const day = localDayKey(now)
      const existing = tx
        .select()
        .from(schema.dailyStats)
        .where(eq(schema.dailyStats.day, day))
        .get()

      if (existing) {
        tx.update(schema.dailyStats)
          .set({
            words: existing.words + words,
            sessions: existing.sessions + 1,
            durationMs: existing.durationMs + input.durationMs,
          })
          .where(eq(schema.dailyStats.day, day))
          .run()
      } else {
        tx.insert(schema.dailyStats)
          .values({ day, words, sessions: 1, durationMs: input.durationMs })
          .run()
      }

      return toDto(row)
    })
  })

  /* ----------------------------------------------------------- misc ---- */

  handle(
    IPC.appInfo,
    (): AppInfo => ({
      version: app.getVersion(),
      electron: process.versions.electron ?? 'unknown',
      chrome: process.versions.chrome ?? 'unknown',
      node: process.versions.node,
      platform: process.platform,
      dbPath: app.getPath('userData'),
    }),
  )
}
