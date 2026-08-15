import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { TooltipBubble, type TooltipAnchor } from '@/components/ui/tooltip.js'
import { parseDay } from '@shared/day.js'
import type { DayStat } from '@shared/types.js'

/**
 * Words per day, a year at a time.
 *
 * Sequential encoding — the value is magnitude, so it is ONE hue stepped
 * light→dark, never a rainbow. The steps themselves live in theme.css, where
 * both modes are declared: dark is a re-validated set against the dark panel,
 * not the light ramp inverted, and its anchor flips so "more" is brighter.
 * The measured numbers and the rules for changing them are in that file.
 */
const RAMP = [
  'var(--color-heat-1)',
  'var(--color-heat-2)',
  'var(--color-heat-3)',
  'var(--color-heat-4)',
] as const

/** Zero is the ABSENCE of a value, not the bottom of the ramp — so, grey. */
const EMPTY = 'var(--color-heat-empty)'

const CELL = 13
const GAP = 3

/**
 * Four bins, not a continuous scale: past about seven classes adjacent
 * shades blur, and a reader cannot resolve a gradient in a 13px square
 * anyway. Thresholds are quartiles of the busiest day, so the scale adapts
 * to how much this person actually dictates.
 */
function binOf(words: number, max: number): number {
  if (words <= 0) return -1
  if (max <= 0) return 0
  const q = words / max
  if (q <= 0.25) return 0
  if (q <= 0.5) return 1
  if (q <= 0.75) return 2
  return 3
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * What the hover bubble shows: the session count, nothing else.
 *
 * `describe` below stays as each cell's accessible name — a screen-reader user
 * moving through the grid has no other way to tell which day they are on, and
 * "37 sessions" alone would be unplaceable among 371 cells.
 */
const sessionLabel = (stat: DayStat): string => {
  if (stat.sessions === 0) return 'No sessions'
  return `${stat.sessions} ${stat.sessions === 1 ? 'session' : 'sessions'}`
}

const describe = (stat: DayStat): string => {
  const date = parseDay(stat.day)
  const when = `${MONTHS[date.getMonth()] ?? ''} ${date.getDate()}, ${date.getFullYear()}`
  if (stat.sessions === 0) return `${when}: nothing dictated`
  return `${when}: ${stat.words.toLocaleString()} ${stat.words === 1 ? 'word' : 'words'} in ${
    stat.sessions
  } ${stat.sessions === 1 ? 'session' : 'sessions'}`
}

export function Heatmap({ days }: { days: DayStat[] }) {
  const [tableView, setTableView] = useState(false)

  /**
   * A year is 371 cells. Wrapping each in its own <Tooltip> would mount 371
   * components and 371 timers to show one bubble at a time, so the cells drive
   * a single shared bubble instead.
   */
  const [anchor, setAnchor] = useState<TooltipAnchor | null>(null)
  const point = (e: { currentTarget: HTMLElement }, day: DayStat) =>
    setAnchor({ rect: e.currentTarget.getBoundingClientRect(), label: sessionLabel(day) })

  const max = useMemo(() => days.reduce((n, d) => Math.max(n, d.words), 0), [days])

  /**
   * Columns are calendar weeks. The first is padded with blanks so every row
   * is one weekday all the way across — without it the grid still renders,
   * but a Wednesday sits above a Sunday and the weekday labels lie.
   */
  const weeks = useMemo(() => {
    const out: (DayStat | null)[][] = []
    let week: (DayStat | null)[] = []

    const first = days[0]
    if (first) {
      for (let i = 0; i < parseDay(first.day).getDay(); i++) week.push(null)
    }

    for (const day of days) {
      week.push(day)
      if (week.length === 7) {
        out.push(week)
        week = []
      }
    }
    if (week.length > 0) {
      while (week.length < 7) week.push(null)
      out.push(week)
    }
    return out
  }, [days])

  /** A month label sits above the first week that month appears in. */
  const monthLabels = useMemo(() => {
    const out: { index: number; label: string }[] = []
    let previous = -1
    weeks.forEach((week, index) => {
      const day = week.find((d): d is DayStat => d !== null)
      if (!day) return
      const month = parseDay(day.day).getMonth()
      if (month !== previous) {
        out.push({ index, label: MONTHS[month] ?? '' })
        previous = month
      }
    })
    return out
  }, [weeks])

  const active = useMemo(() => days.filter((d) => d.sessions > 0).reverse(), [days])

  /**
   * A year of columns is wider than the panel, and the interesting end — this
   * week, and whatever streak is running — is the right one. Land there rather
   * than making the reader drag to it.
   *
   * Layout effect, so it is positioned before paint instead of jumping. Keyed
   * on the view toggle only: a refetch after each dictation must not yank the
   * scroll back while the reader is looking at last winter.
   */
  const scroller = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const el = scroller.current
    if (el) el.scrollLeft = el.scrollWidth
  }, [tableView])

  return (
    <section className="rounded-panel border border-line bg-panel p-6">
      <div className="flex items-baseline justify-between gap-4">
        <div>
          <h2 className="text-sm font-medium text-ink">Activity</h2>
          <p className="mt-0.5 text-[13px] text-ink-muted">
            Words dictated per day over the last year.
          </p>
        </div>
        <button
          onClick={() => setTableView((v) => !v)}
          className="shrink-0 text-[13px] text-ink-muted underline-offset-2 hover:text-ink hover:underline"
        >
          {tableView ? 'Show chart' : 'Show table'}
        </button>
      </div>

      {tableView ? (
        <TableView days={active} />
      ) : (
        <>
          <div ref={scroller} className="mt-5 overflow-x-auto pb-1">
            <div className="inline-flex flex-col gap-1">
              {/* Month labels ride above the columns they start. */}
              <div className="relative h-4" style={{ marginLeft: 30 }} aria-hidden>
                {monthLabels.map(({ index, label }) => (
                  <span
                    key={`${label}-${index}`}
                    className="absolute top-0 text-[11px] text-ink-subtle"
                    style={{ left: index * (CELL + GAP) }}
                  >
                    {label}
                  </span>
                ))}
              </div>

              <div className="flex gap-1">
                {/* Sparse weekday labels — all seven would be noise. */}
                <div
                  className="flex shrink-0 flex-col"
                  style={{ width: 26, gap: GAP }}
                  aria-hidden
                >
                  {WEEKDAYS.map((name, i) => (
                    <span
                      key={name}
                      className="text-[11px] leading-none text-ink-subtle"
                      style={{ height: CELL, lineHeight: `${CELL}px` }}
                    >
                      {i % 2 === 1 ? name : ''}
                    </span>
                  ))}
                </div>

                {/* `group`, not `img` — role="img" makes descendants
                    presentational, which would hide every cell below from a
                    screen reader. */}
                <div className="flex" style={{ gap: GAP }} role="group" aria-label={summary(days)}>
                  {weeks.map((week, w) => (
                    <div key={w} className="flex flex-col" style={{ gap: GAP }}>
                      {week.map((day, d) => {
                        if (day === null) {
                          return <div key={d} style={{ width: CELL, height: CELL }} />
                        }

                        const bin = binOf(day.words, max)
                        const style = {
                          width: CELL,
                          height: CELL,
                          // No border: the gap between cells is what separates
                          // them. A stroke would add ink that is not data.
                          backgroundColor: bin < 0 ? EMPTY : RAMP[bin],
                        }

                        // Empty days are not tab stops. A year of cells would
                        // otherwise be 371 presses to get past, almost all of
                        // them carrying no information at all.
                        return day.sessions === 0 ? (
                          <div
                            key={d}
                            onMouseEnter={(e) => point(e, day)}
                            onMouseLeave={() => setAnchor(null)}
                            className="rounded-[3px]"
                            style={style}
                          />
                        ) : (
                          <button
                            key={d}
                            type="button"
                            aria-label={describe(day)}
                            onMouseEnter={(e) => point(e, day)}
                            onMouseLeave={() => setAnchor(null)}
                            onFocus={(e) => point(e, day)}
                            onBlur={() => setAnchor(null)}
                            className="rounded-[3px]"
                            style={style}
                          />
                        )
                      })}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* The bubble is a supplement, never the only way to read a value:
              each active cell carries the same text as its accessible name,
              and the table view holds every number. */}
          <TooltipBubble anchor={anchor} />

          <div className="mt-4 flex flex-wrap items-center justify-end gap-3">
            <div className="flex items-center gap-1.5 text-[11px] text-ink-subtle">
              <span>Less</span>
              <span
                className="rounded-[3px]"
                style={{ width: CELL, height: CELL, backgroundColor: EMPTY }}
              />
              {RAMP.map((color) => (
                <span
                  key={color}
                  className="rounded-[3px]"
                  style={{ width: CELL, height: CELL, backgroundColor: color }}
                />
              ))}
              <span>More</span>
            </div>
          </div>
        </>
      )}
    </section>
  )
}

function summary(days: DayStat[]): string {
  const active = days.filter((d) => d.sessions > 0).length
  return `Activity heatmap: ${active} active ${active === 1 ? 'day' : 'days'} in the last year.`
}

/** The WCAG-clean twin of the grid. Only active days — 371 rows is not a table. */
function TableView({ days }: { days: DayStat[] }) {
  if (days.length === 0) {
    return <p className="mt-5 text-sm text-ink-muted">No activity yet.</p>
  }

  return (
    <div className="mt-5 max-h-80 overflow-y-auto">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-panel text-left text-xs text-ink-muted">
          <tr className="border-b border-line">
            <th scope="col" className="py-2 font-medium">
              Day
            </th>
            <th scope="col" className="py-2 text-right font-medium">
              Words
            </th>
            <th scope="col" className="py-2 text-right font-medium">
              Sessions
            </th>
            <th scope="col" className="py-2 text-right font-medium">
              Time
            </th>
          </tr>
        </thead>
        <tbody>
          {days.map((d) => (
            <tr key={d.day} className="border-b border-line-soft last:border-0">
              <td className="py-2 text-ink">{d.day}</td>
              {/* tabular-nums belongs here — these columns align vertically. */}
              <td className="py-2 text-right tabular-nums text-ink">
                {d.words.toLocaleString()}
              </td>
              <td className="py-2 text-right tabular-nums text-ink-muted">{d.sessions}</td>
              <td className="py-2 text-right tabular-nums text-ink-muted">
                {Math.round(d.durationMs / 1000)}s
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
