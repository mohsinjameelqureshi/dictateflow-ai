import { asc } from 'drizzle-orm'
import { getDb, schema } from './client.js'
import { computeStreaks, localDayKey, shiftDay } from '../shared/day.js'
import type { DayStat, InsightsDto } from '../shared/types.js'

/**
 * Insights, derived on read (§8).
 *
 * There is deliberately no `statistics` table: totals, averages and streaks
 * come from `dailyStats` and `dictations`, because a denormalised totals row
 * drifts from reality and there is no reason to risk it at this data volume.
 *
 * `dailyStats` holds one row per ACTIVE day — days with no dictation have no
 * row at all. That is what makes the streak query cheap, and it is why
 * deleting a day's last session removes the row rather than zeroing it.
 *
 * The day arithmetic and the streak rule live in shared/day.ts, so they can be
 * exercised without a database.
 */

/** 53 weeks, so the heatmap always shows a full year of columns. */
const HEATMAP_DAYS = 371

export function getInsights(): InsightsDto {
  const rows = getDb().select().from(schema.dailyStats).orderBy(asc(schema.dailyStats.day)).all()

  let totalWords = 0
  let totalSessions = 0
  let totalDurationMs = 0
  for (const row of rows) {
    totalWords += row.words
    totalSessions += row.sessions
    totalDurationMs += row.durationMs
  }

  const { current, longest } = computeStreaks(rows.map((r) => r.day))

  // The heatmap needs every day present, including the empty ones — a grid
  // with holes in it would misplace every column after the hole.
  const byDay = new Map(rows.map((r) => [r.day, r]))
  const today = localDayKey(new Date())
  const days: DayStat[] = []
  for (
    let cursor = shiftDay(today, -(HEATMAP_DAYS - 1));
    cursor <= today;
    cursor = shiftDay(cursor, 1)
  ) {
    const row = byDay.get(cursor)
    days.push({
      day: cursor,
      words: row?.words ?? 0,
      sessions: row?.sessions ?? 0,
      durationMs: row?.durationMs ?? 0,
    })
  }

  return {
    totalWords,
    totalSessions,
    totalDurationMs,
    // §8 — words over RECORDING duration. Not speech duration, and not a mean
    // of per-day rates, both of which give a different and wronger number.
    wpm: totalDurationMs > 0 ? Math.round(totalWords / (totalDurationMs / 60000)) : 0,
    currentStreak: current,
    longestStreak: longest,
    days,
  }
}
