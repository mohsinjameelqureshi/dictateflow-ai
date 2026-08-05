import { ipcRenderer } from 'electron'
import { IPC, IPC_EVENT } from '../shared/ipc-channels.js'
import type { ClipPayload, WidgetCommand, WidgetStatePayload } from '../shared/types.js'

/**
 * The widget's surface. Deliberately much smaller than the main window's —
 * the widget owns the microphone and nothing else. No database, no settings,
 * no window controls, no API key.
 *
 * The widget is `focusable: false`, so it cannot receive keyboard events. Esc
 * cancellation is handled by the global hook in the main process, not here.
 */
export const widgetApi = {
  onCommand: (cb: (command: WidgetCommand) => void): (() => void) => {
    const listener = (_e: unknown, command: WidgetCommand) => cb(command)
    ipcRenderer.on(IPC_EVENT.widgetCommand, listener)
    return () => ipcRenderer.off(IPC_EVENT.widgetCommand, listener)
  },

  onState: (cb: (payload: WidgetStatePayload) => void): (() => void) => {
    const listener = (_e: unknown, payload: WidgetStatePayload) => cb(payload)
    ipcRenderer.on(IPC_EVENT.widgetState, listener)
    return () => ipcRenderer.off(IPC_EVENT.widgetState, listener)
  },

  sendClip: (payload: ClipPayload): Promise<void> =>
    ipcRenderer.invoke(IPC.widgetClip, payload) as Promise<void>,

  reportMicError: (error: { name: string; message: string }): Promise<void> =>
    ipcRenderer.invoke(IPC.widgetMicError, error) as Promise<void>,
} as const

export type WidgetApi = typeof widgetApi
