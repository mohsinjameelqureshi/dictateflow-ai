import { ipcRenderer } from 'electron'
import { IPC, IPC_EVENT } from '../shared/ipc-channels.js'
import type {
  AudioInputDevice,
  ClipPayload,
  ResolvedTheme,
  WidgetCommand,
  WidgetStatePayload,
} from '../shared/types.js'

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

  /**
   * Settings needs the microphone list, and device LABELS are only visible to
   * a renderer holding media permission — which §6.7 grants to the widget
   * alone. So the request is relayed here rather than the permission widened
   * to a window that also has database and API-key access.
   */
  onEnumerate: (cb: (request: { requestId: number }) => void): (() => void) => {
    const listener = (_e: unknown, request: { requestId: number }) => cb(request)
    ipcRenderer.on(IPC_EVENT.widgetEnumerate, listener)
    return () => ipcRenderer.off(IPC_EVENT.widgetEnumerate, listener)
  },

  sendDevices: (requestId: number, devices: AudioInputDevice[]): Promise<void> =>
    ipcRenderer.invoke(IPC.widgetDevices, { requestId, devices }) as Promise<void>,

  /** OS reported a mic plugged or unplugged — main reconciles the stored pick. */
  notifyDevicesChanged: (devices: AudioInputDevice[]): Promise<void> =>
    ipcRenderer.invoke(IPC.widgetDevicesChanged, devices) as Promise<void>,

  /**
   * The widget cannot read settings — its surface is deliberately mic-only
   * (§6.7) — so the resolved theme is handed to it rather than looked up.
   * Same shape as the main window's, so one hook drives both.
   */
  theme: {
    get: (): Promise<ResolvedTheme> =>
      ipcRenderer.invoke(IPC.themeGet) as Promise<ResolvedTheme>,
    onChange: (cb: (theme: ResolvedTheme) => void): (() => void) => {
      const listener = (_e: unknown, theme: ResolvedTheme) => cb(theme)
      ipcRenderer.on(IPC_EVENT.theme, listener)
      return () => ipcRenderer.off(IPC_EVENT.theme, listener)
    },
  },
} as const

export type WidgetApi = typeof widgetApi
