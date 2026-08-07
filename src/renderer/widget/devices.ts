import type { AudioInputDevice } from '@shared/types.js'

/**
 * Microphone enumeration, answered on behalf of the settings window.
 *
 * The widget does this because it is the only renderer §6.7 grants media
 * permission to, and `enumerateDevices` returns entries with EMPTY labels to
 * anyone without it. Widening the permission to a window that also holds
 * database and API-key access would be the wrong trade.
 */

/**
 * Chromium exposes these two aliases on Windows alongside the real device.
 * The picker already offers "System default" as the empty-string option, so
 * keeping them would show the same microphone three times.
 */
const ALIASES = new Set(['default', 'communications'])

export async function listAudioInputs(canProbe: boolean): Promise<AudioInputDevice[]> {
  let inputs = await audioInputs()

  // Labels stay empty until getUserMedia has succeeded at least once in this
  // renderer, permission or not. A throwaway stream unlocks them — but never
  // while a dictation is live, which would fight the recorder for the device.
  if (canProbe && inputs.some((d) => !d.label)) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      stream.getTracks().forEach((t) => t.stop())
      inputs = await audioInputs()
    } catch {
      // No microphone, or access blocked. Fall through with unlabelled
      // entries rather than returning nothing — the ids still work.
    }
  }

  return inputs.map((d, i) => ({
    deviceId: d.deviceId,
    label: d.label || `Microphone ${i + 1}`,
  }))
}

async function audioInputs(): Promise<MediaDeviceInfo[]> {
  const all = await navigator.mediaDevices.enumerateDevices()
  return all.filter((d) => d.kind === 'audioinput' && !ALIASES.has(d.deviceId))
}
