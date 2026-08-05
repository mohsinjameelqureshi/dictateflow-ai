import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/ipc-channels.js'
import type {
  AppInfo,
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
 * The entire surface the renderer gets. Nothing else crosses the bridge —
 * no ipcRenderer, no node, no fs (§6.7).
 */
const api = {
  window: {
    minimize: () => invoke(IPC.windowMinimize),
    maximize: () => invoke(IPC.windowMaximize),
    close: () => invoke(IPC.windowClose),
    isMaximized: () => invoke(IPC.windowIsMaximized),
  },
  settings: {
    getAll: (): Promise<Settings> => invoke(IPC.settingsGetAll),
    set: (key: SettingKey, value: string): Promise<void> =>
      invoke(IPC.settingsSet, { key, value }),
  },
  dictations: {
    list: (query?: ListDictationsQuery): Promise<DictationDto[]> =>
      invoke(IPC.dictationsList, query),
    create: (input: NewDictationDto): Promise<DictationDto> =>
      invoke(IPC.dictationsCreate, input),
  },
  app: {
    info: (): Promise<AppInfo> => invoke(IPC.appInfo),
  },
} as const

export type WisprApi = typeof api

contextBridge.exposeInMainWorld('wispr', api)
