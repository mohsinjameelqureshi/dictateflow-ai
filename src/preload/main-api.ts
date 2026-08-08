import { ipcRenderer } from 'electron'
import { IPC, IPC_EVENT } from '../shared/ipc-channels.js'
import type {
  ApiKeyStatus,
  AppInfo,
  AppRoute,
  AudioInputDevice,
  DictationDto,
  DictionaryDto,
  DictionaryWrite,
  InsightsDto,
  IpcMap,
  ListDictationsQuery,
  NewDictationDto,
  NewDictionaryDto,
  RecordingsStats,
  ResolvedTheme,
  SettingKey,
  Settings,
  SettingsTab,
  TransferResult,
} from '../shared/types.js'

/** Typed invoke — the channel decides both argument and return type. */
function invoke<C extends keyof IpcMap>(
  channel: C,
  ...args: IpcMap[C][0] extends void ? [] : [IpcMap[C][0]]
): Promise<IpcMap[C][1]> {
  return ipcRenderer.invoke(channel, ...args) as Promise<IpcMap[C][1]>
}

/**
 * The entire surface the main window gets. Nothing else crosses the bridge —
 * no ipcRenderer, no node, no fs (§6.7).
 */
export const mainApi = {
  window: {
    minimize: () => invoke(IPC.windowMinimize),
    maximize: () => invoke(IPC.windowMaximize),
    close: () => invoke(IPC.windowClose),
    isMaximized: () => invoke(IPC.windowIsMaximized),
  },
  settings: {
    getAll: (): Promise<Settings> => invoke(IPC.settingsGetAll),
    set: (key: SettingKey, value: string): Promise<void> => invoke(IPC.settingsSet, { key, value }),
    /**
     * Raise the main window and open the settings dialog on a tab. The
     * sidebar's own Settings button does not need this — it is already in that
     * window and sets the state directly.
     */
    open: (tab?: SettingsTab): Promise<void> => invoke(IPC.settingsOpen, tab),
    /** Fires on every write, so a shown setting cannot go stale. */
    onChanged: (cb: (settings: Settings) => void): (() => void) => {
      const listener = (_e: unknown, settings: Settings) => cb(settings)
      ipcRenderer.on(IPC_EVENT.settingsChanged, listener)
      return () => ipcRenderer.off(IPC_EVENT.settingsChanged, listener)
    },
    /** The tray asking for Settings. Opens the dialog as well as selecting. */
    onNavigate: (cb: (tab: SettingsTab) => void): (() => void) => {
      const listener = (_e: unknown, tab: SettingsTab) => cb(tab)
      ipcRenderer.on(IPC_EVENT.settingsNavigate, listener)
      return () => ipcRenderer.off(IPC_EVENT.settingsNavigate, listener)
    },
  },
  shortcut: {
    /**
     * Deafen the global hook while a new combo is being recorded. Every
     * caller must guarantee the matching `false`, including on unmount —
     * a stuck `true` disables dictation with no visible cause.
     */
    suspend: (suspended: boolean): Promise<void> => invoke(IPC.shortcutSuspend, suspended),
  },
  devices: {
    /** Microphones, with real labels — relayed through the widget. */
    list: (): Promise<AudioInputDevice[]> => invoke(IPC.devicesList),
  },
  dictations: {
    list: (query?: ListDictationsQuery): Promise<DictationDto[]> =>
      invoke(IPC.dictationsList, query),
    count: (query?: ListDictationsQuery): Promise<number> => invoke(IPC.dictationsCount, query),
    create: (input: NewDictationDto): Promise<DictationDto> => invoke(IPC.dictationsCreate, input),
    setFavorite: (id: number, favorite: boolean): Promise<DictationDto | null> =>
      invoke(IPC.dictationsSetFavorite, { id, favorite }),
    /** Also decrements the day aggregate — see db/dictations.ts. */
    remove: (id: number): Promise<boolean> => invoke(IPC.dictationsDelete, id),
    /** Fires after the capture loop saves, so History stays live. */
    onChanged: (cb: () => void): (() => void) => {
      const listener = () => cb()
      ipcRenderer.on(IPC_EVENT.dictationsChanged, listener)
      return () => ipcRenderer.off(IPC_EVENT.dictationsChanged, listener)
    },
  },
  insights: {
    /** Totals, streaks and the heatmap, derived on read (§8). */
    get: (): Promise<InsightsDto> => invoke(IPC.insightsGet),
    /** Recompute dailyStats from dictations — the repair path for a drift. */
    rebuild: (): Promise<void> => invoke(IPC.statsRebuild),
  },
  theme: {
    /** Always resolved — main decides what 'system' currently means. */
    get: (): Promise<ResolvedTheme> => invoke(IPC.themeGet),
    onChange: (cb: (theme: ResolvedTheme) => void): (() => void) => {
      const listener = (_e: unknown, theme: ResolvedTheme) => cb(theme)
      ipcRenderer.on(IPC_EVENT.theme, listener)
      return () => ipcRenderer.off(IPC_EVENT.theme, listener)
    },
  },
  data: {
    /** Both open a native file dialog, so both can come back 'cancelled'. */
    export: (): Promise<TransferResult> => invoke(IPC.dataExport),
    import: (): Promise<TransferResult> => invoke(IPC.dataImport),
  },
  dictionary: {
    list: (): Promise<DictionaryDto[]> => invoke(IPC.dictionaryList),
    create: (input: NewDictionaryDto): Promise<DictionaryWrite> =>
      invoke(IPC.dictionaryCreate, input),
    update: (id: number, input: NewDictionaryDto): Promise<DictionaryWrite> =>
      invoke(IPC.dictionaryUpdate, { id, ...input }),
    remove: (id: number): Promise<boolean> => invoke(IPC.dictionaryDelete, id),
  },
  recordings: {
    /** Files and bytes under userData/recordings. No paths cross the bridge. */
    stats: (): Promise<RecordingsStats> => invoke(IPC.recordingsStats),
    /** Deletes every recording and clears the rows' audio columns. */
    clear: (): Promise<RecordingsStats> => invoke(IPC.recordingsClear),
  },
  clipboard: {
    /** Main owns this: a file:// page has no `navigator.clipboard`. */
    write: (text: string): Promise<void> => invoke(IPC.clipboardWrite, text),
  },
  apiKey: {
    status: (): Promise<ApiKeyStatus> => invoke(IPC.apiKeyStatus),
    set: (key: string): Promise<ApiKeyStatus> => invoke(IPC.apiKeySet, key),
    clear: (): Promise<ApiKeyStatus> => invoke(IPC.apiKeyClear),
  },
  app: {
    info: (): Promise<AppInfo> => invoke(IPC.appInfo),
    /** The tray's "Settings" entry routes through here. */
    onNavigate: (cb: (route: AppRoute) => void): (() => void) => {
      const listener = (_e: unknown, route: AppRoute) => cb(route)
      ipcRenderer.on(IPC_EVENT.navigate, listener)
      return () => ipcRenderer.off(IPC_EVENT.navigate, listener)
    },
  },
} as const

export type TypeFlowApi = typeof mainApi
