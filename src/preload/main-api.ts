import { ipcRenderer } from 'electron'
import { IPC, IPC_EVENT } from '../shared/ipc-channels.js'
import type {
  ApiKeyStatus,
  AppInfo,
  AppRoute,
  DictationDto,
  IpcMap,
  ListDictationsQuery,
  NewDictationDto,
  SettingKey,
  Settings,
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
  },
  dictations: {
    list: (query?: ListDictationsQuery): Promise<DictationDto[]> =>
      invoke(IPC.dictationsList, query),
    create: (input: NewDictationDto): Promise<DictationDto> => invoke(IPC.dictationsCreate, input),
    /** Fires after the capture loop saves, so History stays live. */
    onChanged: (cb: () => void): (() => void) => {
      const listener = () => cb()
      ipcRenderer.on(IPC_EVENT.dictationsChanged, listener)
      return () => ipcRenderer.off(IPC_EVENT.dictationsChanged, listener)
    },
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

export type WisprApi = typeof mainApi
