import { useCallback, useEffect, useState } from 'react'
import { Page, Stat } from '@/components/page.js'
import { Button } from '@/components/ui/button.js'
import type { InsightsDto } from '@shared/types.js'
import { Heatmap } from './heatmap.js'

/**
 * §8 fixes every definition on this page, because ambiguity here produces
 * meaningless numbers:
 *
 *   WPM     words ÷ RECORDING duration (not speech duration)
 *   Word    whitespace-delimited token, empties filtered
 *   Streak  consecutive days with ≥1 session, local timezone
 *
 * All of it is derived on read from `dailyStats` — there is no totals table
 * to drift out of sync.
 */
function formatDuration(ms: number): string {
  const minutes = Math.round(ms / 60000)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ${minutes % 60}m`
}

export function InsightsPage() {
  const [data, setData] = useState<InsightsDto | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setData(await window.dictateflow.insights.get())
    } catch {
      setError('Could not read your statistics.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // A finished dictation changes every number here.
  useEffect(() => window.dictateflow.dictations.onChanged(() => void load()), [load])

  return (
    <Page title="Insights" description="Derived from your local history.">
      {error && (
        <div className="mb-4 flex items-center justify-between gap-4 rounded-lg border border-danger/30 bg-danger/5 px-4 py-3">
          <p role="alert" className="text-sm text-danger">
            {error}{data && ' Showing your last loaded statistics.'}
          </p>
          <Button size="sm" onClick={() => void load()} disabled={loading}>Try again</Button>
        </div>
      )}

      {/* Rate first, then the totals it is derived from, then the streak —
          which measures habit rather than volume and belongs at the end. */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat value={data?.wpm ?? null} label="Words per minute" hint="over recording time" loading={!data && loading} />
        <Stat value={data?.totalWords.toLocaleString() ?? null} label="Words" loading={!data && loading} />
        <Stat
          value={data?.totalSessions.toLocaleString() ?? null}
          loading={!data && loading}
          label="Sessions"
          hint={data ? formatDuration(data.totalDurationMs) + ' recorded' : undefined}
        />
        <Stat
          value={data?.currentStreak ?? null}
          loading={!data && loading}
          label="Day streak"
          hint={data && data.longestStreak > 0 ? `best ${data.longestStreak}` : undefined}
        />
      </div>

      <div className="mt-4">
        {data ? (
          <Heatmap days={data.days} />
        ) : loading ? (
          <div role="status" className="rounded-panel border border-line bg-panel p-6">
            <p className="text-sm text-ink-muted">Loading activity…</p>
            <div aria-hidden className="mt-5 h-28 rounded-lg bg-line-soft" />
          </div>
        ) : null}
      </div>
    </Page>
  )
}
