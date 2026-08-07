import { useEffect, useState } from 'react'
import { ArrowRight, Pencil, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button.js'
import { Input } from '@/components/ui/input.js'
import { Tooltip } from '@/components/ui/tooltip.js'
import type { DictionaryDto } from '@shared/types.js'

/**
 * One rule, read-only until edited in place.
 *
 * `onSave` returns the reason it was rejected, or null — a duplicate term is
 * an expected answer from the main process, not an exception (§12: errors say
 * what happened).
 */
export function RuleRow({
  entry,
  onSave,
  onDelete,
}: {
  entry: DictionaryDto
  onSave: (id: number, from: string, to: string) => Promise<string | null>
  onDelete: (id: number) => void
}) {
  const [editing, setEditing] = useState(false)
  const [from, setFrom] = useState(entry.from)
  const [to, setTo] = useState(entry.to)
  const [problem, setProblem] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [saving, setSaving] = useState(false)

  // Reset the draft whenever the row starts or stops being edited, so a
  // cancelled edit cannot leak into the next one.
  useEffect(() => {
    setFrom(entry.from)
    setTo(entry.to)
    setProblem(null)
  }, [editing, entry.from, entry.to])

  useEffect(() => {
    if (!confirming) return
    const t = setTimeout(() => setConfirming(false), 5000)
    return () => clearTimeout(t)
  }, [confirming])

  const commit = async () => {
    setSaving(true)
    try {
      const reason = await onSave(entry.id, from, to)
      if (reason) setProblem(reason)
      else setEditing(false)
    } finally {
      setSaving(false)
    }
  }

  if (editing) {
    return (
      <li className="rounded-panel border border-accent bg-panel p-3">
        <div className="flex items-center gap-2">
          <Input
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void commit()
              if (e.key === 'Escape') setEditing(false)
            }}
            aria-label="Heard as"
            spellCheck={false}
            autoFocus
            className="min-w-0 flex-1"
          />
          <ArrowRight size={14} className="shrink-0 text-ink-subtle" aria-hidden />
          <Input
            value={to}
            onChange={(e) => setTo(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void commit()
              if (e.key === 'Escape') setEditing(false)
            }}
            aria-label="Should be"
            spellCheck={false}
            className="min-w-0 flex-1"
          />
          <Button variant="primary" onClick={() => void commit()} disabled={saving}>
            Save
          </Button>
          <Button variant="ghost" onClick={() => setEditing(false)}>
            Cancel
          </Button>
        </div>
        {problem && <p className="mt-2 text-sm text-danger">{problem}</p>}
      </li>
    )
  }

  return (
    <li className="group flex items-center gap-3 rounded-panel border border-line bg-panel px-4 py-3">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <span className="selectable truncate text-sm text-ink-muted line-through decoration-ink-subtle">
          {entry.from}
        </span>
        <ArrowRight size={13} className="shrink-0 text-ink-subtle" aria-hidden />
        <span className="selectable truncate text-sm font-medium text-ink">{entry.to}</span>
      </div>

      <span className="shrink-0 text-xs tabular-nums text-ink-subtle">
        {entry.hitCount === 0
          ? 'Not used yet'
          : `${entry.hitCount} ${entry.hitCount === 1 ? 'fix' : 'fixes'}`}
      </span>

      <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
        {confirming ? (
          <>
            <Button size="sm" variant="danger" onClick={() => onDelete(entry.id)}>
              Delete
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
              Keep
            </Button>
          </>
        ) : (
          <>
            <Tooltip label="Edit">
              <Button
                size="icon"
                variant="ghost"
                onClick={() => setEditing(true)}
                aria-label={`Edit ${entry.from}`}
              >
                <Pencil size={14} />
              </Button>
            </Tooltip>
            <Tooltip label="Delete">
              <Button
                size="icon"
                variant="ghost"
                onClick={() => setConfirming(true)}
                aria-label={`Delete ${entry.from}`}
              >
                <Trash2 size={14} />
              </Button>
            </Tooltip>
          </>
        )}
      </div>
    </li>
  )
}
