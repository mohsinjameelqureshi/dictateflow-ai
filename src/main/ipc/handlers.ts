import { BrowserWindow, app, ipcMain } from 'electron'
import { and, desc, eq, like, or } from 'drizzle-orm'
import { getDb, schema } from '../../db/client.js'
import { createDictation, toDto } from '../../db/dictations.js'
import { IPC } from '../../shared/ipc-channels.js'
import {
  type ApiKeyStatus,
  type AppInfo,
  type AudioInputDevice,
  type ClipPayload,
  type DictationDto,
  type IpcMap,
  type ListDictationsQuery,
  type NewDictationDto,
  type SettingKey,
  type Settings,
  type SettingsTab,
} from '../../shared/types.js'
import { apiKeyStatus, clearApiKey, setApiKey } from '../secrets.js'
import { listAudioInputs, receiveAudioInputs } from '../audio/devices.js'
import { session } from '../dictation/session.js'
import { readSettings, writeSetting } from '../settings.js'
import { onShortcutChanged, setShortcutSuspended } from '../shortcut/index.js'
import { openSettingsWindow } from '../windows/settings-window.js'

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

  handle(IPC.settingsGetAll, (): Settings => readSettings())

  handle(IPC.settingsSet, ({ key, value }: { key: SettingKey; value: string }) => {
    writeSetting(key, value)
    applySettingEffect(key, value)
  })

  handle(IPC.settingsOpen, (tab: SettingsTab | undefined) => {
    openSettingsWindow(tab)
  })

  /* -------------------------------------------------------- shortcut ---- */

  // Held only while the settings window is recording a combo, so the OLD
  // shortcut cannot fire a dictation the moment the user presses it to show
  // what they are replacing.
  handle(IPC.shortcutSuspend, (suspended: boolean) => {
    setShortcutSuspended(suspended)
  })

  /* --------------------------------------------------------- devices ---- */

  handle(IPC.devicesList, (): Promise<AudioInputDevice[]> => listAudioInputs())

  /* --------------------------------------------------------- api key ---- */

  handle(IPC.apiKeyStatus, (): ApiKeyStatus => apiKeyStatus())
  handle(IPC.apiKeySet, (key: string): ApiKeyStatus => setApiKey(key))
  handle(IPC.apiKeyClear, (): ApiKeyStatus => clearApiKey())

  /* ---------------------------------------------------------- widget ---- */

  handle(IPC.widgetClip, (payload: ClipPayload) => {
    session.receiveClip(payload)
  })

  handle(IPC.widgetMicError, (error: { name: string; message: string }) => {
    session.micError(error.message)
  })

  // The widget answering a `devices:list` that Settings asked for. It is the
  // only renderer holding media permission, so it is the only one that sees
  // device labels rather than empty strings (§6.7).
  handle(
    IPC.widgetDevices,
    ({ requestId, devices }: { requestId: number; devices: AudioInputDevice[] }) => {
      receiveAudioInputs(requestId, devices)
    },
  )

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

  handle(IPC.dictationsCreate, (input: NewDictationDto): DictationDto => createDictation(input))

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

/**
 * Settings that are not just a stored string.
 *
 * A toggle that writes a row and changes nothing is worse than no toggle: it
 * reads as working. Anything added to SETTING_KEYS with real behaviour behind
 * it belongs here.
 */
function applySettingEffect(key: SettingKey, value: string): void {
  switch (key) {
    case 'shortcut':
      // The hook holds a parsed combo, so it has to be told.
      onShortcutChanged(value)
      return
    case 'launchOnStartup':
      applyLoginItem(value === 'true')
      return
    default:
      // `microphoneId`, `language` and friends are read at the point of use.
      return
  }
}

export function applyLoginItem(openAtLogin: boolean): void {
  // Dev runs would register the Electron binary itself as a startup item.
  if (!app.isPackaged) return
  app.setLoginItemSettings({ openAtLogin, path: process.execPath })
}
