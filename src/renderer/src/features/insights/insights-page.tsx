import { useEffect, useState } from 'react'
import { Page, Stat } from '@/components/page.js'
import type { DictationDto } from '@shared/types.js'

/**
 * Phase 1 shows the layout with values derived client-side from the last
 * page of dictations. Phase 4 replaces this with real aggregation over
 * dailyStats, plus the heatmap and streaks.
 *
 * Metric definitions are fixed in §8 — WPM is words over RECORDING duration,
 * not speech duration.
 */
export function InsightsPage() {
  const [items, setItems] = useState<DictationDto[]>([])

  useEffect(() => {
    void window.wispr.dictations.list({ limit: 500 }).then(setItems)
  }, [])

  const words = items.reduce((n, d) => n + d.words, 0)
  const durationMs = items.reduce((n, d) => n + d.durationMs, 0)
  const wpm = durationMs > 0 ? Math.round(words / (durationMs / 60000)) : 0

  return (
    <Page title="Insights" description="Derived from your local history.">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat value={words.toLocaleString()} label="Words" />
        <Stat value={items.length.toLocaleString()} label="Sessions" />
        <Stat value={wpm} label="Words per minute" hint="over recording time" />
        <Stat value="—" label="Day streak" hint="Phase 4" />
      </div>

      <div className="mt-4 rounded-panel border border-dashed border-line p-10 text-center">
        <p className="text-sm font-medium text-ink">Activity heatmap</p>
        <p className="mt-1 text-sm text-ink-muted">
          Lands in Phase 4, once daily aggregation is in place.
        </p>
      </div>
    </Page>
  )
}
