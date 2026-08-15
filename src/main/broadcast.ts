import { BrowserWindow } from 'electron'
import { IPC_EVENT } from '../shared/ipc-channels.js'
import type { MoonshineProgress, MoonshineStatus, Settings } from '../shared/types.js'
import { getWidgetWindow } from './windows/widget-window.js'

/**
 * "The stored dictations changed" — from a finished capture, or from an
 * import. History, Insights and the dictionary's hit counts all listen.
 *
 * The widget is skipped: it shows one line of status and holds no list.
 */
export function broadcastDictationsChanged(): void {
  const widget = getWidgetWindow()
  for (const win of BrowserWindow.getAllWindows()) {
    if (win !== widget && !win.isDestroyed()) win.webContents.send(IPC_EVENT.dictationsChanged)
  }
}

/**
 * A setting changed. Sent to every window including the one that made the
 * change — a settings window and the main window can both be open at once,
 * and the shortcut hint on the dictation page has to follow a rebind.
 *
 * The whole table goes with it, so a listener never has to invoke back.
 */
export function broadcastSettings(settings: Settings): void {
  const widget = getWidgetWindow()
  for (const win of BrowserWindow.getAllWindows()) {
    if (win !== widget && !win.isDestroyed()) {
      win.webContents.send(IPC_EVENT.settingsChanged, settings)
    }
  }
}

/** Microphones plugged or unplugged — refresh any open picker. */
export function broadcastDevicesChanged(): void {
  const widget = getWidgetWindow()
  for (const win of BrowserWindow.getAllWindows()) {
    if (win !== widget && !win.isDestroyed()) {
      win.webContents.send(IPC_EVENT.devicesChanged)
    }
  }
}

/**
 * Local model download progress. Fires often — once per streamed chunk — so it
 * is deliberately the smallest payload in this file and skips the widget,
 * which has nothing to show for it.
 */
export function broadcastMoonshineProgress(progress: MoonshineProgress): void {
  const widget = getWidgetWindow()
  for (const win of BrowserWindow.getAllWindows()) {
    if (win !== widget && !win.isDestroyed()) {
      win.webContents.send(IPC_EVENT.moonshineProgress, progress)
    }
  }
}

/** The local model became ready, failed, or was removed. */
export function broadcastMoonshineStatus(status: MoonshineStatus): void {
  const widget = getWidgetWindow()
  for (const win of BrowserWindow.getAllWindows()) {
    if (win !== widget && !win.isDestroyed()) {
      win.webContents.send(IPC_EVENT.moonshineStatusChanged, status)
    }
  }
}
