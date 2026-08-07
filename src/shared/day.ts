/**
 * Local-time day keys, and the streak rule built on them.
 *
 * §8 defines a day — and therefore a streak — in the LOCAL timezone, so every
 * conversion here goes through the Date object's local accessors. Pure: no
 * database, no Electron, so the main process, both renderers and a plain Node
 * script all get the same answers.
 */

/** 'YYYY-MM-DD' in local time. */
export function localDayKey(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** A day key back to local midnight. */
export function parseDay(key: string): Date {
  const [y, m, d] = key.split('-')
  return new Date(Number(y), Number(m) - 1, Number(d))
}

/**
 * Day arithmetic through the Date object, never by adding 86,400,000ms.
 *
 * Across a daylight-saving boundary a local day is 23 or 25 hours long, so
 * millisecond maths silently skips or repeats a day. In a streak, that missing
 * day IS the answer — it reads as a break that never happened.
 */
export function shiftDay(key: string, delta: number): string {
  const date = parseDay(key)
  date.setDate(date.getDate() + delta)
  return localDayKey(date)
}

export interface Streaks {
  current: number
  longest: number
}

/**
 * §8 — consecutive days with at least one session.
 *
 * `days` must be ascending and unique; `dailyStats`' primary key gives both.
 * `today` is injectable so this can be tested without waiting for midnight.
 */
export function computeStreaks(days: string[], today = localDayKey(new Date())): Streaks {
  if (days.length === 0) return { current: 0, longest: 0 }

  let longest = 0
  let run = 0
  let previous: string | null = null
  for (const day of days) {
    run = previous !== null && shiftDay(previous, 1) === day ? run + 1 : 1
    if (run > longest) longest = run
    previous = day
  }

  // A streak must not break just because today has not happened yet, so an
  // empty today falls back to yesterday. Two empty days in a row is a break.
  const present = new Set(days)
  let cursor = present.has(today) ? today : shiftDay(today, -1)

  let current = 0
  while (present.has(cursor)) {
    current += 1
    cursor = shiftDay(cursor, -1)
  }

  return { current, longest }
}
