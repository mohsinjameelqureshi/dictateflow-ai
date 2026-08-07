import { Search, Star } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button.js'
import { Empty, Page } from '@/components/page.js'
import { cn } from '@/lib/utils.js'
import type { DictationDto } from '@shared/types.js'
import { DictationCard } from './dictation-card.js'
import { groupByDay } from './group-by-day.js'
import { ShortcutHint } from './shortcut-hint.js'

const PAGE = 50

export function HistoryPage() {
  const [items, setItems] = useState<DictationDto[]>([])
  const [total, setTotal] = useState(0)
  const [search, setSearch] = useState('')
  const [favoritesOnly, setFavoritesOnly] = useState(false)
  const [limit, setLimit] = useState(PAGE)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  /**
   * "Load more" refetches from the top with a larger limit rather than
   * appending an offset page. At this data volume the cost is nothing, and it
   * cannot double-show or skip a row after a delete shifts every offset.
   */
  const load = useCallback(async (term: string, favs: boolean, take: number) => {
    setLoading(true)
    setError(null)
    const query = { search: term, favoritesOnly: favs, limit: take }
    try {
      const [rows, n] = await Promise.all([
        window.wispr.dictations.list(query),
        window.wispr.dictations.count(query),
      ])
      setItems(rows)
      setTotal(n)
    } catch {
      setError('Could not read your history.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const t = setTimeout(() => void load(search, favoritesOnly, limit), 150)
    return () => clearTimeout(t)
  }, [search, favoritesOnly, limit, load])

  // Typing a new search while showing page four should start over at page one.
  useEffect(() => setLimit(PAGE), [search, favoritesOnly])

  // The capture loop writes from the main process, so the list has to be told
  // rather than polled.
  useEffect(
    () => window.wispr.dictations.onChanged(() => void load(search, favoritesOnly, limit)),
    [load, search, favoritesOnly, limit],
  )

  const toggleFavorite = (id: number, favorite: boolean) => {
    setItems((prev) => prev.map((d) => (d.id === id ? { ...d, favorite } : d)))
    void window.wispr.dictations.setFavorite(id, favorite).catch(() => {
      setItems((prev) => prev.map((d) => (d.id === id ? { ...d, favorite: !favorite } : d)))
      setError('Could not update that.')
    })
  }

  const remove = (id: number) => {
    const previous = items
    setItems((prev) => prev.filter((d) => d.id !== id))
    setTotal((n) => Math.max(0, n - 1))
    void window.wispr.dictations.remove(id).catch(() => {
      setItems(previous)
      setTotal((n) => n + 1)
      setError('Could not delete that.')
    })
  }

  const filtered = !!search || favoritesOnly

  // Recomputed only when the rows change. "Today" is resolved at that moment,
  // so a window left open across midnight keeps yesterday's labels until the
  // next load — and the capture loop's own change event is a load.
  const groups = useMemo(() => groupByDay(items), [items])

  return (
    <Page
      // Matches the nav label — a page headed "History" under a nav item
      // called "Dictation" reads as two different places.
      title="Dictation"
      description="Everything you have dictated, stored locally."
      actions={
        <Button
          variant={favoritesOnly ? 'primary' : 'secondary'}
          onClick={() => setFavoritesOnly((v) => !v)}
          aria-pressed={favoritesOnly}
        >
          <Star size={14} className={cn(favoritesOnly && 'fill-current')} />
          Favorites
        </Button>
      }
    >
      <ShortcutHint />

      <div className="mb-5 flex items-center gap-2 rounded-lg border border-line bg-panel px-3 focus-within:border-accent">
        <Search size={15} className="shrink-0 text-ink-subtle" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search transcripts"
          aria-label="Search transcripts"
          className="h-10 w-full bg-transparent text-sm text-ink outline-none placeholder:text-ink-subtle"
        />
      </div>

      {error && <p className="mb-4 text-sm text-danger">{error}</p>}

      {loading && items.length === 0 ? (
        <p className="text-sm text-ink-muted">Loading…</p>
      ) : items.length === 0 ? (
        <Empty
          title={filtered ? 'No matches' : 'Nothing dictated yet'}
          hint={
            favoritesOnly
              ? 'Star a transcript to keep it here.'
              : search
                ? 'Search covers the original transcript too.'
                : 'Hold your shortcut and speak. Transcripts land here.'
          }
        />
      ) : (
        <>
          {groups.map(({ key, label, items: rows }) => (
            <section key={key} className="mb-6 last:mb-0">
              {/* Sticky, because the heading is what tells you where you are in
                  a long list and it is useless once it has scrolled away.

                  `-mx-10 px-10` is what makes it full-bleed: the page pads its
                  content by 10, so without it the cards would slide past in
                  the uncovered gutters on either side of the heading. */}
              <h2 className="sticky top-0 z-10 -mx-10 bg-panel px-10 pb-2 pt-1 text-xs font-medium uppercase tracking-wide text-ink-subtle">
                {label}
              </h2>

              <ul className="flex flex-col gap-2">
                {rows.map((d) => (
                  <DictationCard
                    key={d.id}
                    dictation={d}
                    onToggleFavorite={toggleFavorite}
                    onDelete={remove}
                  />
                ))}
              </ul>
            </section>
          ))}

          <div className="mt-5 flex items-center justify-center gap-4">
            <p className="text-xs tabular-nums text-ink-subtle">
              {items.length} of {total}
            </p>
            {items.length < total && (
              <Button size="sm" onClick={() => setLimit((n) => n + PAGE)} disabled={loading}>
                {loading ? 'Loading…' : 'Load more'}
              </Button>
            )}
          </div>
        </>
      )}
    </Page>
  )
}
