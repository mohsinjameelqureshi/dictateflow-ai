import { IPC_EVENT } from '../../shared/ipc-channels.js'
import type { AudioInputDevice } from '../../shared/types.js'
import { broadcastDevicesChanged, broadcastSettings } from '../broadcast.js'
import { readSetting, readSettings, writeSetting } from '../settings.js'
import { getWidgetWindow, sendToWidget } from '../windows/widget-window.js'

/**
 * The microphone list, fetched through the widget.
 *
 * `enumerateDevices` returns entries with EMPTY labels unless the calling
 * renderer holds media permission, and §6.7 grants that to the widget and
 * nothing else. Rather than widen the permission to the settings window — a
 * window that has database and API-key access — the request is relayed to the
 * one renderer that is already allowed to see device names.
 *
 * The widget is created at startup and only hidden between dictations, so it
 * is available whenever Settings asks.
 */

const pending = new Map<number, (devices: AudioInputDevice[]) => void>()
let nextRequestId = 1

/** Long enough for a cold `getUserMedia` label unlock, short enough to not hang. */
const TIMEOUT_MS = 5000

/**
 * A stored device id that no longer appears in the list — unplugged, or Windows
 * re-enumerated it under a new id. Fall back to system default and tell every
 * open window, so the picker does not sit on a ghost entry.
 */
export function reconcileMicrophoneId(devices: AudioInputDevice[]): void {
  const id = readSetting('microphoneId')
  if (!id) return
  if (devices.some((d) => d.deviceId === id)) return
  writeSetting('microphoneId', '')
  broadcastSettings(readSettings())
}

/** Widget reports the OS list changed. Reconcile the stored pick and refresh UIs. */
export function onAudioInputsChanged(devices: AudioInputDevice[]): void {
  reconcileMicrophoneId(devices)
  broadcastDevicesChanged()
}

export function listAudioInputs(): Promise<AudioInputDevice[]> {
  if (!getWidgetWindow()) return Promise.resolve([])

  const requestId = nextRequestId++
  return new Promise<AudioInputDevice[]>((resolve) => {
    pending.set(requestId, resolve)
    sendToWidget(IPC_EVENT.widgetEnumerate, { requestId })

    // The widget renderer could be reloading or wedged. An empty list renders
    // as "no microphones found", which is honest; hanging is not.
    setTimeout(() => {
      if (pending.delete(requestId)) resolve([])
    }, TIMEOUT_MS)
  })
}

/** Called by the IPC handler when the widget answers. */
export function receiveAudioInputs(requestId: number, devices: AudioInputDevice[]): void {
  reconcileMicrophoneId(devices)
  const resolve = pending.get(requestId)
  if (!resolve) return // timed out already, or a duplicate reply
  pending.delete(requestId)
  resolve(devices)
}
