import { expireRecordings, referencedRecordings } from '../../db/dictations.js'
import { readSetting } from '../settings.js'
import { sweepUnreferenced } from './store.js'

/**
 * The startup pass over `recordings/` (§8).
 *
 * Two jobs, in this order, because they are not independent: expiry clears
 * `audio_file` on old rows, which turns those files into unreferenced ones,
 * and doing the sweep first would leave them on disk for a whole extra run.
 *
 * Runs once per launch rather than on a timer. The directory only grows when
 * a dictation finishes, and a user who never restarts is a user who is not
 * accumulating a surprising amount of disk either.
 */
export function runAudioMaintenance(): void {
  try {
    const days = Number(readSetting('recordingRetentionDays'))
    // 0 (the default) means keep everything — not "expire immediately".
    const expired = Number.isFinite(days) && days > 0 ? expireRecordings(days) : 0

    // Collects the failure modes §6.8 accepts by design: a clip written just
    // before a crashed insert, and the files whose rows expiry just cleared.
    const swept = sweepUnreferenced(referencedRecordings())

    if (expired || swept) {
      console.info(`[audio] maintenance: ${expired} expired, ${swept} unreferenced files removed`)
    }
  } catch (err) {
    // Housekeeping must never stop the app from starting.
    console.warn('[audio] maintenance failed:', err)
  }
}
