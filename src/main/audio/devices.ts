import { IPC_EVENT } from '../../shared/ipc-channels.js'
import type { AudioInputDevice } from '../../shared/types.js'
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
  const resolve = pending.get(requestId)
  if (!resolve) return // timed out already, or a duplicate reply
  pending.delete(requestId)
  resolve(devices)
}
