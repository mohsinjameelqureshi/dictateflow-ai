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
  KeyCheck,
  ListDictationsQuery,
  MoonshineModelSize,
  MoonshineProgress,
  MoonshineStatus,
  NewDictationDto,
  NewDictionaryDto,
  NewTransformDto,
  RecordingsStats,
  ResolvedTheme,
  SecretId,
  SettingKey,
  Settings,
  SettingsTab,
  TransferResult,
  TransformDto,
  TransformModel,
  TransformProviderId,
  TransformWrite,
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
    /** Fires when the OS reports a mic plugged or unplugged. */
    onChanged: (cb: () => void): (() => void) => {
      const listener = () => cb()
      ipcRenderer.on(IPC_EVENT.devicesChanged, listener)
      return () => ipcRenderer.off(IPC_EVENT.devicesChanged, listener)
    },
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
  /**
   * The local speech model. Only its state and size cross the bridge — the
   * renderer never names a path or a URL, the same rule `recordings` follows.
   */
  moonshine: {
    status: (size?: MoonshineModelSize): Promise<MoonshineStatus> =>
      invoke(IPC.moonshineStatus, size),
    /**
     * Returns as soon as the download STARTS, not when it finishes — it is
     * hundreds of megabytes. Watch `onProgress` and `onStatus` for the rest.
     */
    download: (size: MoonshineModelSize): Promise<MoonshineStatus> =>
      invoke(IPC.moonshineDownload, size),
    cancel: (): Promise<MoonshineStatus> => invoke(IPC.moonshineCancel),
    remove: (size: MoonshineModelSize): Promise<MoonshineStatus> =>
      invoke(IPC.moonshineDelete, size),

    onProgress: (cb: (progress: MoonshineProgress) => void): (() => void) => {
      const listener = (_e: unknown, progress: MoonshineProgress) => cb(progress)
      ipcRenderer.on(IPC_EVENT.moonshineProgress, listener)
      return () => ipcRenderer.off(IPC_EVENT.moonshineProgress, listener)
    },

    onStatus: (cb: (status: MoonshineStatus) => void): (() => void) => {
      const listener = (_e: unknown, status: MoonshineStatus) => cb(status)
      ipcRenderer.on(IPC_EVENT.moonshineStatusChanged, listener)
      return () => ipcRenderer.off(IPC_EVENT.moonshineStatusChanged, listener)
    },
  },
  /**
   * Transform rules and the engine behind them.
   *
   * `models` is a live call to the provider rather than a constant, so the
   * picker cannot offer a model that has been retired. It never rejects — each
   * provider falls back to a small static list.
   */
  transforms: {
    list: (): Promise<TransformDto[]> => invoke(IPC.transformsList),
    create: (input: NewTransformDto): Promise<TransformWrite> =>
      invoke(IPC.transformsCreate, input),
    update: (id: number, input: NewTransformDto): Promise<TransformWrite> =>
      invoke(IPC.transformsUpdate, { id, ...input }),
    remove: (id: number): Promise<boolean> => invoke(IPC.transformsDelete, id),
    models: (provider: TransformProviderId): Promise<TransformModel[]> =>
      invoke(IPC.transformsModels, provider),
    /** Fires after a transform runs, so the "used N times" figure stays honest. */
    onChanged: (cb: () => void): (() => void) => {
      const listener = () => cb()
      ipcRenderer.on(IPC_EVENT.transformsChanged, listener)
      return () => ipcRenderer.off(IPC_EVENT.transformsChanged, listener)
    },
  },
  /**
   * The stored secrets. Each call names one; the reply carries the id back, so
   * a card can never render another secret's status.
   *
   * The value is never read back into the renderer — `status()` returns whether
   * one exists, not what it is.
   */
  apiKey: {
    status: (id: SecretId): Promise<ApiKeyStatus> => invoke(IPC.apiKeyStatus, id),
    set: (id: SecretId, key: string): Promise<ApiKeyStatus> =>
      invoke(IPC.apiKeySet, { id, key }),
    clear: (id: SecretId): Promise<ApiKeyStatus> => invoke(IPC.apiKeyClear, id),
    /**
     * Ask the provider whether the saved key works.
     *
     * A network call, so the card saves first and verifies after: a key entered
     * offline is still saved, and reported as unverified rather than rejected.
     * Never rejects — a verification that could not run is an answer.
     */
    verify: (id: SecretId): Promise<KeyCheck> => invoke(IPC.apiKeyVerify, id),
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

export type DictateFlowApi = typeof mainApi
