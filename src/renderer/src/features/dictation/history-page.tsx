import { Search } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button.js'
import { Empty, Page } from '@/components/page.js'
import type { DictationDto } from '@shared/types.js'

export function HistoryPage() {
  const [items, setItems] = useState<DictationDto[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)

  const load = useCallback(async (term: string) => {
    setLoading(true)
    try {
      setItems(await window.wispr.dictations.list({ search: term, limit: 100 }))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const t = setTimeout(() => void load(search), 150)
    return () => clearTimeout(t)
  }, [search, load])

  /** Dev-only. Phase 2 replaces this with the real capture loop. */
  const seed = async () => {
    const raw = 'this is a test dictation, training create the possibility'
    await window.wispr.dictations.create({
      rawText: raw,
      finalText: raw,
      durationMs: 4200,
      providerId: 'dev',
    })
    await load(search)
  }

  return (
    <Page
      title="History"
      description="Everything you have dictated, stored locally."
      actions={
        import.meta.env.DEV ? (
          <Button variant="secondary" size="sm" onClick={() => void seed()}>
            Add test row
          </Button>
        ) : undefined
      }
    >
      <div className="mb-5 flex items-center gap-2 rounded-lg border border-line bg-panel px-3">
        <Search size={15} className="shrink-0 text-ink-subtle" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search transcripts"
          aria-label="Search transcripts"
          className="h-10 w-full bg-transparent text-sm text-ink outline-none placeholder:text-ink-subtle"
        />
      </div>

      {loading && items.length === 0 ? (
        <p className="text-sm text-ink-muted">Loading…</p>
      ) : items.length === 0 ? (
        <Empty
          title={search ? 'No matches' : 'Nothing dictated yet'}
          hint={
            search
              ? 'Try a different word.'
              : 'Hold your shortcut and speak. Transcripts land here.'
          }
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((d) => (
            <li
              key={d.id}
              className="rounded-panel border border-line bg-panel p-4 transition-colors hover:border-ink-subtle"
            >
              <p className="selectable text-sm leading-relaxed text-ink">{d.finalText}</p>
              <div className="mt-2.5 flex items-center gap-3 text-xs tabular-nums text-ink-subtle">
                <span>{new Date(d.createdAt).toLocaleString()}</span>
                <span>·</span>
                <span>{d.words} words</span>
                <span>·</span>
                <span>{(d.durationMs / 1000).toFixed(1)}s</span>
                <span>·</span>
                <span>{d.providerId}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Page>
  )
}
