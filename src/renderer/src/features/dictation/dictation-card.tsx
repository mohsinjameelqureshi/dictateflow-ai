import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, Copy, Pause, Play, Star, Trash2 } from 'lucide-react'
import { ActionMenu } from '@/components/ui/action-menu.js'
import { Button } from '@/components/ui/button.js'
import { Tooltip } from '@/components/ui/tooltip.js'
import { Reveal } from '@/components/ui/reveal.js'
import { cn } from '@/lib/utils.js'
import type { DictationDto } from '@shared/types.js'
import { usePlayer } from './player.js'

function clock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds))
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}

/** Keep playback ticks isolated from transcript text and actions. */
function PlaybackTime({ fallbackMs }: { fallbackMs: number }) {
  const elapsed = usePlayer((state) => state.elapsed)
  const duration = usePlayer((state) => state.duration)
  return (
    <>
      <span aria-hidden>·</span>
      <span className="text-accent">{clock(elapsed)} / {clock(duration ?? fallbackMs / 1000)}</span>
    </>
  )
}

export function DictationCard({ dictation, onToggleFavorite, onDelete }: {
  dictation: DictationDto
  onToggleFavorite: (id: number, favorite: boolean) => void
  onDelete: (id: number) => void
}) {
  const [copied, setCopied] = useState(false)
  const [copyProblem, setCopyProblem] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [showRaw, setShowRaw] = useState(false)
  const copyButton = useRef<HTMLButtonElement>(null)
  const deleteButton = useRef<HTMLButtonElement>(null)
  const confirmation = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 1600)
    return () => clearTimeout(timer)
  }, [copied])

  useEffect(() => {
    if (!confirming) return
    deleteButton.current?.focus({ preventScroll: true })
    const timer = setTimeout(() => {
      if (confirmation.current?.contains(document.activeElement)) copyButton.current?.focus({ preventScroll: true })
      setConfirming(false)
    }, 5000)
    return () => {
      clearTimeout(timer)
      setConfirming(false)
    }
  }, [confirming])

  const { id, finalText, rawText, favorite, words, durationMs, createdAt, dictionaryFixes, hasAudio } = dictation
  const differs = rawText.trim() !== finalText.trim()
  const isCurrent = usePlayer((state) => state.id === id)
  const playing = usePlayer((state) => state.id === id && state.playing)
  const failed = usePlayer((state) => state.failed)
  const toggle = usePlayer((state) => state.toggle)
  const release = usePlayer((state) => state.release)
  const playable = hasAudio && !failed

  const copy = async () => {
    setCopyProblem(null)
    try {
      await window.dictateflow.clipboard.write(finalText)
      setCopied(true)
    } catch {
      setCopyProblem('Could not copy this transcript. Try again.')
    }
  }

  return (
    <li className="rounded-panel border border-line bg-panel p-4 transition-colors hover:border-ink-subtle">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-start gap-2">
          {favorite && <Star size={14} className="mt-1 shrink-0 fill-accent text-accent" aria-label="Favorite" />}
          <p className="selectable min-w-0 flex-1 break-words text-sm leading-relaxed text-ink">{finalText}</p>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {isCurrent && (
            <Tooltip label={playing ? 'Pause recording' : 'Resume recording'}>
              <Button size="icon" variant="ghost" onClick={() => toggle(id)} disabled={!playable} aria-label={playing ? 'Pause recording' : 'Resume recording'} aria-pressed={playing}>
                {playing ? <Pause size={14} className="fill-accent text-accent" /> : <Play size={14} className="text-accent" />}
              </Button>
            </Tooltip>
          )}
          <Tooltip label={copied ? 'Copied' : 'Copy transcript'}>
            <Button ref={copyButton} size="icon" variant="ghost" onClick={() => void copy()} aria-label={copied ? 'Copied' : 'Copy transcript'}>
              {copied ? <Check size={14} className="text-success" /> : <Copy size={14} />}
            </Button>
          </Tooltip>
          <ActionMenu
            label="Transcript actions"
            items={[
              {
                label: !hasAudio ? 'No recording' : failed ? 'Recording is missing' : playing ? 'Pause recording' : 'Play recording',
                icon: playing ? <Pause size={14} aria-hidden /> : <Play size={14} aria-hidden />,
                disabled: !playable,
                onSelect: () => toggle(id),
              },
              {
                label: favorite ? 'Remove from favorites' : 'Add to favorites',
                icon: <Star size={14} aria-hidden className={favorite ? 'fill-accent text-accent' : undefined} />,
                checked: favorite,
                onSelect: () => onToggleFavorite(id, !favorite),
              },
              {
                label: 'Delete transcript',
                icon: <Trash2 size={14} aria-hidden />,
                danger: true,
                onSelect: () => setConfirming(true),
              },
            ]}
          />
        </div>
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs tabular-nums text-ink-subtle">
        <span>{new Date(createdAt).toLocaleString()}</span>
        <span aria-hidden>·</span>
        <span>{words} {words === 1 ? 'word' : 'words'}</span>
        <span aria-hidden>·</span>
        <span>{(durationMs / 1000).toFixed(1)}s</span>
        {isCurrent && <PlaybackTime fallbackMs={durationMs} />}
        {dictionaryFixes > 0 && <><span aria-hidden>·</span><span>{dictionaryFixes} dictionary {dictionaryFixes === 1 ? 'fix' : 'fixes'}</span></>}
        {differs && (
          <button onClick={() => setShowRaw((value) => !value)} aria-expanded={showRaw} className="ml-auto flex items-center gap-1 text-ink-muted hover:text-ink">
            <ChevronDown size={12} className={cn('transition-transform', showRaw && 'rotate-180')} />
            {showRaw ? 'Hide original' : 'Show original'}
          </button>
        )}
      </div>
      {copied && <span role="status" className="sr-only">Transcript copied.</span>}
      {copyProblem && <p role="alert" className="mt-3 text-xs text-danger">{copyProblem}</p>}
      {confirming && (
        <div ref={confirmation} role="group" aria-label="Confirm transcript deletion" className="mt-3 flex flex-wrap items-center gap-2 border-t border-line-soft pt-3">
          <p className="mr-auto text-[13px] text-ink-muted">Delete this transcript and its recording?</p>
          <Button ref={deleteButton} size="sm" variant="danger" onClick={() => { release(id); onDelete(id) }}>Delete</Button>
          <Button size="sm" variant="ghost" onClick={() => { setConfirming(false); copyButton.current?.focus({ preventScroll: true }) }}>Keep</Button>
        </div>
      )}
      <Reveal open={showRaw && differs}>
        <p className="selectable mt-3 border-t border-line-soft pt-3 text-sm leading-relaxed text-ink-muted">{rawText}</p>
      </Reveal>
    </li>
  )
}
