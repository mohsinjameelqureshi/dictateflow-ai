import { useEffect, useState } from 'react'
import { Check, ChevronDown, Copy, Star, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button.js'
import { Tooltip } from '@/components/ui/tooltip.js'
import { cn } from '@/lib/utils.js'
import type { DictationDto } from '@shared/types.js'

/**
 * Hidden until the row is hovered or something inside it takes focus. The
 * `focus-visible` half is what keeps these reachable by keyboard (§14).
 */
const FADE =
  'opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100'

/**
 * One transcript.
 *
 * §4 — `rawText` is the source of truth and must ALWAYS be available in
 * history. `finalText` is the convenience copy, so it leads; raw is one click
 * away whenever the two differ, which is exactly when it matters.
 */
export function DictationCard({
  dictation,
  onToggleFavorite,
  onDelete,
}: {
  dictation: DictationDto
  onToggleFavorite: (id: number, favorite: boolean) => void
  onDelete: (id: number) => void
}) {
  const [copied, setCopied] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [showRaw, setShowRaw] = useState(false)

  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(false), 1600)
    return () => clearTimeout(t)
  }, [copied])

  // A confirmation left hanging on a card the user has scrolled away from is
  // a trap. Give it up after a few seconds.
  useEffect(() => {
    if (!confirming) return
    const t = setTimeout(() => setConfirming(false), 5000)
    return () => clearTimeout(t)
  }, [confirming])

  const { id, finalText, rawText, favorite, words, durationMs, createdAt, dictionaryFixes } =
    dictation
  const differs = rawText.trim() !== finalText.trim()

  const copy = () => {
    void window.wispr.clipboard.write(finalText).then(() => setCopied(true))
  }

  return (
    <li className="group rounded-panel border border-line bg-panel p-4 transition-colors hover:border-ink-subtle">
      <div className="flex items-start justify-between gap-4">
        <p className="selectable min-w-0 flex-1 text-sm leading-relaxed text-ink">{finalText}</p>

        {/* Kept mounted rather than conditionally rendered: appearing controls
            cannot be reached by keyboard, and §14 requires that they can.
            Fading is applied per button, not to the row, so a favourited star
            stays visible — otherwise the state is invisible until hover. */}
        <div className="flex shrink-0 items-center gap-0.5">
          {confirming ? (
            <>
              <Button size="sm" variant="danger" onClick={() => onDelete(id)}>
                Delete
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
                Keep
              </Button>
            </>
          ) : (
            <>
              <Tooltip label={copied ? 'Copied' : 'Copy'} className={FADE}>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={copy}
                  aria-label={copied ? 'Copied' : 'Copy transcript'}
                >
                  {copied ? <Check size={14} className="text-success" /> : <Copy size={14} />}
                </Button>
              </Tooltip>

              <Tooltip
                label={favorite ? 'Remove from favorites' : 'Favorite'}
                className={cn(!favorite && FADE)}
              >
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => onToggleFavorite(id, !favorite)}
                  aria-pressed={favorite}
                  aria-label={favorite ? 'Remove from favorites' : 'Add to favorites'}
                >
                  <Star size={14} className={favorite ? 'fill-accent text-accent' : undefined} />
                </Button>
              </Tooltip>

              <Tooltip label="Delete" className={FADE}>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => setConfirming(true)}
                  aria-label="Delete transcript"
                >
                  <Trash2 size={14} />
                </Button>
              </Tooltip>
            </>
          )}
        </div>
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs tabular-nums text-ink-subtle">
        <span>{new Date(createdAt).toLocaleString()}</span>
        <span aria-hidden>·</span>
        <span>{words} words</span>
        <span aria-hidden>·</span>
        <span>{(durationMs / 1000).toFixed(1)}s</span>
        {dictionaryFixes > 0 && (
          <>
            <span aria-hidden>·</span>
            <span>
              {dictionaryFixes} dictionary {dictionaryFixes === 1 ? 'fix' : 'fixes'}
            </span>
          </>
        )}
        {differs && (
          <button
            onClick={() => setShowRaw((v) => !v)}
            aria-expanded={showRaw}
            className="ml-auto flex items-center gap-1 text-ink-muted hover:text-ink"
          >
            <ChevronDown
              size={12}
              className={cn('transition-transform', showRaw && 'rotate-180')}
            />
            {showRaw ? 'Hide original' : 'Show original'}
          </button>
        )}
      </div>

      {showRaw && differs && (
        <p className="selectable mt-3 border-t border-line-soft pt-3 text-sm leading-relaxed text-ink-muted">
          {rawText}
        </p>
      )}
    </li>
  )
}
