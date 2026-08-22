import { BrowserWindow } from 'electron'
import { IPC_EVENT } from '../shared/ipc-channels.js'
import type {
  IpcEventMap,
  MoonshineProgress,
  MoonshineStatus,
  Settings,
} from '../shared/types.js'
import { getWidgetWindow } from './windows/widget-window.js'

/**
 * main -> renderer pushes.
 *
 * Every one of these skips the widget: it shows one line of status and holds no
 * list, so a history reload or a settings table is nothing to it. The one
 * exception is the theme, which the widget does need — and which therefore does
 * not use this file (see theme.ts).
 */

/**
 * The typed door. `webContents.send` takes an untyped string, so without this
 * a channel could be sent that no `IpcEventMap` entry describes — and one was:
 * `transforms:changed` shipped with no map entry, worked by luck, and nothing
 * failed to compile. Binding the channel to the map makes that a build error.
 */
function sendToWindows<C extends keyof IpcEventMap>(
  channel: C,
  ...payload: IpcEventMap[C] extends void ? [] : [IpcEventMap[C]]
): void {
  const widget = getWidgetWindow()
  for (const win of BrowserWindow.getAllWindows()) {
    if (win !== widget && !win.isDestroyed()) win.webContents.send(channel, ...payload)
  }
}

/**
 * "The stored dictations changed" — from a finished capture, or from an
 * import. History, Insights and the dictionary's hit counts all listen.
 */
export function broadcastDictationsChanged(): void {
  sendToWindows(IPC_EVENT.dictationsChanged)
}

/**
 * A transform ran, so its hit count moved.
 *
 * Kept separate from `broadcastDictationsChanged` rather than folded into it: a
 * transform is not a dictation, and History and Insights have nothing to reload
 * for one.
 */
export function broadcastTransformsChanged(): void {
  sendToWindows(IPC_EVENT.transformsChanged)
}

/**
 * A setting changed. Sent to every window including the one that made the
 * change — a settings window and the main window can both be open at once,
 * and the shortcut hint on the dictation page has to follow a rebind.
 *
 * The whole table goes with it, so a listener never has to invoke back.
 */
export function broadcastSettings(settings: Settings): void {
  sendToWindows(IPC_EVENT.settingsChanged, settings)
}

/** Microphones plugged or unplugged — refresh any open picker. */
export function broadcastDevicesChanged(): void {
  sendToWindows(IPC_EVENT.devicesChanged)
}

/**
 * Local model download progress. Fires often — once per streamed chunk — so it
 * is deliberately the smallest payload in this file.
 */
export function broadcastMoonshineProgress(progress: MoonshineProgress): void {
  sendToWindows(IPC_EVENT.moonshineProgress, progress)
}

/** The local model became ready, failed, or was removed. */
export function broadcastMoonshineStatus(status: MoonshineStatus): void {
  sendToWindows(IPC_EVENT.moonshineStatusChanged, status)
}
