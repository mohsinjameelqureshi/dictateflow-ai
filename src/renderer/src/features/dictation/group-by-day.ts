import { localDayKey, parseDay, shiftDay } from '@shared/day.js'
import type { DictationDto } from '@shared/types.js'

/**
 * History, cut into days.
 *
 * The day boundary is `localDayKey` — the same one §8 defines for streaks and
 * the heatmap. A second definition here would let a session sit under "Today"
 * in Dictation while counting toward yesterday in Insights.
 */

export interface DayGroup {
  key: string
  label: string
  items: DictationDto[]
}

/**
 * Weekday included: within the last week, "Tuesday" locates a session faster
 * than the date does. The year appears only when it is not the current one —
 * it is noise on everything else.
 */
const THIS_YEAR = new Intl.DateTimeFormat(undefined, {
  weekday: 'long',
  month: 'long',
  day: 'numeric',
})

const EARLIER = new Intl.DateTimeFormat(undefined, {
  year: 'numeric',
  month: 'long',
  day: 'numeric',
})

export function dayLabel(key: string, today: string): string {
  if (key === today) return 'Today'
  if (key === shiftDay(today, -1)) return 'Yesterday'

  const date = parseDay(key)
  return date.getFullYear() === parseDay(today).getFullYear()
    ? THIS_YEAR.format(date)
    : EARLIER.format(date)
}

/**
 * Preserves the order it is given rather than sorting: the query already
 * returns newest first, and re-sorting here would be a second opinion about
 * ordering that could disagree with the "Load more" boundary.
 *
 * `today` is a parameter so this is testable without waiting for midnight —
 * and so a caller that renders across a midnight boundary can pass its own.
 */
export function groupByDay(
  items: DictationDto[],
  today: string = localDayKey(new Date()),
): DayGroup[] {
  const days = new Map<string, DictationDto[]>()

  for (const item of items) {
    const key = localDayKey(new Date(item.createdAt))
    const bucket = days.get(key)
    if (bucket) bucket.push(item)
    else days.set(key, [item])
  }

  return [...days].map(([key, rows]) => ({ key, label: dayLabel(key, today), items: rows }))
}
