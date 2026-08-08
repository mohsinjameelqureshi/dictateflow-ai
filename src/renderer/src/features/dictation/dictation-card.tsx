import { useEffect, useState } from 'react'
import { Check, ChevronDown, Copy, Pause, Play, Star, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button.js'
import { Tooltip } from '@/components/ui/tooltip.js'
import { cn } from '@/lib/utils.js'
import type { DictationDto } from '@shared/types.js'
import { usePlayer } from './player.js'

/** mm:ss. Recordings are minutes at most, so hours would be dead width. */
function clock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds))
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}

/**
 * The ticking readout, isolated in its own component on purpose.
 *
 * `timeupdate` fires about four times a second. Reading elapsed in the card
 * would re-render the whole row — text, buttons, tooltips — on every tick;
 * here only this span does.
 *
 * Mounted only for the row that is loaded, so no other row subscribes at all.
 */
function PlaybackTime({ fallbackMs }: { fallbackMs: number }) {
  const elapsed = usePlayer((s) => s.elapsed)
  const duration = usePlayer((s) => s.duration)

  // The recorded duration is the honest stand-in until metadata arrives —
  // they describe the same clip, and it stops the total jumping into place.
  const total = duration ?? fallbackMs / 1000

  return (
    <>
      <span aria-hidden>·</span>
      <span className="text-accent">
        {clock(elapsed)} / {clock(total)}
      </span>
    </>
  )
}

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

  const {
    id,
    finalText,
    rawText,
    favorite,
    words,
    durationMs,
    createdAt,
    dictionaryFixes,
    hasAudio,
  } = dictation
  const differs = rawText.trim() !== finalText.trim()

  // Subscribed narrowly: every row re-rendering on each timeupdate would be a
  // hundred renders a second on a long list.
  const isCurrent = usePlayer((s) => s.id === id)
  const playing = usePlayer((s) => s.id === id && s.playing)
  const failed = usePlayer((s) => s.id === id && s.failed)
  const toggle = usePlayer((s) => s.toggle)
  const release = usePlayer((s) => s.release)

  // A row whose file 404s is indistinguishable from one that never had audio
  // once the attempt has failed — §13 says degrade honestly rather than offer
  // a control that cannot work.
  const playable = hasAudio && !failed

  const copy = () => {
    void window.typeflow.clipboard.write(finalText).then(() => setCopied(true))
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
              <Button
                size="sm"
                variant="danger"
                onClick={() => {
                  // Drop the source before the row goes: the file is deleted
                  // with it, and an element still pointing at it would fire a
                  // media error and flash "Recording is missing" on the way out.
                  release(id)
                  onDelete(id)
                }}
              >
                Delete
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
                Keep
              </Button>
            </>
          ) : (
            <>
              {/* First in the group: it is the only control that reveals
                  something the row does not already show. Stays visible while
                  playing — a control you must hover to find is a control you
                  cannot use to stop what you are hearing. */}
              <Tooltip
                label={
                  !hasAudio
                    ? 'No recording'
                    : failed
                      ? 'Recording is missing'
                      : playing
                        ? 'Pause'
                        : 'Play'
                }
                className={cn(!isCurrent && FADE)}
              >
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => toggle(id)}
                  disabled={!playable}
                  aria-pressed={playing}
                  aria-label={playing ? 'Pause recording' : 'Play recording'}
                >
                  {playing ? (
                    <Pause size={14} className="fill-accent text-accent" />
                  ) : (
                    <Play size={14} className={isCurrent ? 'text-accent' : undefined} />
                  )}
                </Button>
              </Tooltip>

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
        {isCurrent && <PlaybackTime fallbackMs={durationMs} />}
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
