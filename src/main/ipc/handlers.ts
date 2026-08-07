import { BrowserWindow, app, clipboard, ipcMain } from 'electron'
import {
  countDictations,
  createDictation,
  deleteDictation,
  listDictations,
  setFavorite,
} from '../../db/dictations.js'
import { createRule, deleteRule, listDictionary, updateRule } from '../../db/dictionary.js'
import { getInsights, rebuildDailyStats } from '../../db/stats.js'
import { broadcastDictationsChanged, broadcastSettings } from '../broadcast.js'
import { exportData, importData } from '../data-transfer.js'
import { applyLoginItem } from '../startup.js'
import { applyTheme, resolvedTheme } from '../theme.js'
import { IPC } from '../../shared/ipc-channels.js'
import {
  type ApiKeyStatus,
  type AppInfo,
  type AudioInputDevice,
  type ClipPayload,
  type DictationDto,
  type DictionaryDto,
  type DictionaryWrite,
  type InsightsDto,
  type IpcMap,
  type ListDictationsQuery,
  type NewDictationDto,
  type NewDictionaryDto,
  type ResolvedTheme,
  type SettingKey,
  type Settings,
  type SettingsTab,
  type TransferResult,
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
    broadcastSettings(readSettings())
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

  handle(IPC.dictationsList, (query: ListDictationsQuery | undefined): DictationDto[] =>
    listDictations(query),
  )

  handle(IPC.dictationsCount, (query: ListDictationsQuery | undefined): number =>
    countDictations(query),
  )

  handle(IPC.dictationsCreate, (input: NewDictationDto): DictationDto => createDictation(input))

  handle(
    IPC.dictationsSetFavorite,
    ({ id, favorite }: { id: number; favorite: boolean }): DictationDto | null =>
      setFavorite(id, favorite),
  )

  handle(IPC.dictationsDelete, (id: number): boolean => deleteDictation(id))

  /* -------------------------------------------------------- insights ---- */

  handle(IPC.insightsGet, (): InsightsDto => getInsights())

  handle(IPC.statsRebuild, () => {
    rebuildDailyStats()
  })

  /* ----------------------------------------------------------- theme ---- */

  handle(IPC.themeGet, (): ResolvedTheme => resolvedTheme())

  /* -------------------------------------------------- export / import ---- */

  handle(IPC.dataExport, (_arg, event): Promise<TransferResult> =>
    exportData(senderWindow(event)),
  )

  handle(IPC.dataImport, async (_arg, event): Promise<TransferResult> => {
    const result = await importData(senderWindow(event))
    // History, insights and the dictionary are all stale now.
    if (result.status === 'done') broadcastDictationsChanged()
    return result
  })

  /* ------------------------------------------------------ dictionary ---- */

  handle(IPC.dictionaryList, (): DictionaryDto[] => listDictionary())

  // No change event is pushed for these. Only the main window shows the
  // dictionary, it is the window that just asked for the change, and the
  // capture loop re-reads the rules from SQLite on every dictation — so
  // there is nothing left holding a stale copy.
  handle(IPC.dictionaryCreate, ({ from, to }: NewDictionaryDto): DictionaryWrite =>
    createRule(from, to),
  )

  handle(
    IPC.dictionaryUpdate,
    ({ id, from, to }: { id: number } & NewDictionaryDto): DictionaryWrite =>
      updateRule(id, from, to),
  )

  handle(IPC.dictionaryDelete, (id: number): boolean => deleteRule(id))

  /* ------------------------------------------------------- clipboard ---- */

  // §6.4's insert path snapshots and restores the clipboard around a paste.
  // This is the unrelated, deliberate case: the user asked for the text.
  handle(IPC.clipboardWrite, (text: string) => {
    if (text) clipboard.writeText(text)
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
    case 'theme':
      // Resolves 'system' and pushes the answer to all three windows.
      applyTheme(value)
      return
    default:
      // `microphoneId`, `language` and friends are read at the point of use.
      return
  }
}
