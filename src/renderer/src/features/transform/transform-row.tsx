import { useEffect, useState } from 'react'
import { Pencil, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button.js'
import { Tooltip } from '@/components/ui/tooltip.js'
import { KeyCap, Toggle } from '@/features/settings/parts.js'
import { keyLabel, parseShortcut, type ShortcutClaim } from '@shared/shortcut.js'
import type { NewTransformDto, TransformDto } from '@shared/types.js'
import { TransformEditor } from './transform-editor.js'

/**
 * One transform rule, read-only until edited in place.
 *
 * Shaped like the dictionary's `RuleRow` on purpose — they are the two "rules"
 * surfaces in the app and they should not need to be learned twice. The
 * differences are real ones: a rule here is a paragraph rather than a word, and
 * it carries a shortcut and an on/off switch.
 */
export function TransformRow({
  entry,
  claims,
  onSave,
  onToggle,
  onDelete,
}: {
  entry: TransformDto
  claims: readonly ShortcutClaim[]
  onSave: (id: number, input: NewTransformDto) => Promise<string | null>
  onToggle: (id: number, enabled: boolean) => void
  onDelete: (id: number) => void
}) {
  const [editing, setEditing] = useState(false)
  const [confirming, setConfirming] = useState(false)

  useEffect(() => {
    if (!confirming) return
    const t = setTimeout(() => setConfirming(false), 5000)
    return () => clearTimeout(t)
  }, [confirming])

  if (editing) {
    return (
      <li className="rounded-panel border border-accent bg-panel p-5">
        <TransformEditor
          initial={{ name: entry.name, rule: entry.rule, shortcut: entry.shortcut }}
          claims={claims}
          submitLabel="Save"
          onSubmit={async (input) => {
            const reason = await onSave(entry.id, input)
            if (!reason) setEditing(false)
            return reason
          }}
          onCancel={() => setEditing(false)}
        />
      </li>
    )
  }

  const keys = parseShortcut(entry.shortcut)

  return (
    <li className="group rounded-panel border border-line bg-panel px-5 py-4">
      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <span className="text-sm font-medium text-ink">{entry.name}</span>

            {keys.length > 0 ? (
              <span className="flex items-center gap-1">
                {keys.map((k) => (
                  <KeyCap key={k}>{keyLabel(k)}</KeyCap>
                ))}
              </span>
            ) : (
              // Not an error — a rule can be parked while it is being written.
              // But it is the one thing about the row worth noticing, so it
              // says what to do rather than just reading "Not set".
              <span className="text-xs text-ink-subtle">No shortcut - set one to use it</span>
            )}

            <span className="text-xs tabular-nums text-ink-subtle">
              {entry.hitCount === 0
                ? 'Not used yet'
                : `${entry.hitCount} ${entry.hitCount === 1 ? 'use' : 'uses'}`}
            </span>
          </div>

          {/* Clamped rather than truncated to one line: a rule is a paragraph,
              and two lines is enough to tell two rules apart without turning
              the list into a wall of text. */}
          <p className="selectable mt-1.5 line-clamp-2 text-[13px] leading-relaxed text-ink-muted">
            {entry.rule}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <Toggle
            checked={entry.enabled}
            onChange={(next) => onToggle(entry.id, next)}
            label={`${entry.enabled ? 'Disable' : 'Enable'} ${entry.name}`}
          />

          <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
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
                    aria-label={`Edit ${entry.name}`}
                  >
                    <Pencil size={14} />
                  </Button>
                </Tooltip>
                <Tooltip label="Delete">
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => setConfirming(true)}
                    aria-label={`Delete ${entry.name}`}
                  >
                    <Trash2 size={14} />
                  </Button>
                </Tooltip>
              </>
            )}
          </div>
        </div>
      </div>
    </li>
  )
}
