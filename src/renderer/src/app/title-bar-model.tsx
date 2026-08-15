import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Check, ChevronDown, Cloud, Cpu } from 'lucide-react'
import { createPortal } from 'react-dom'
import {
  MOONSHINE_MODELS,
  MOONSHINE_SIZES,
  formatBytes,
  isMoonshineSize,
  type MoonshineModelSize,
  type MoonshineStatus,
} from '@shared/types.js'
import { Tooltip } from '@/components/ui/tooltip.js'
import { cn } from '@/lib/utils.js'

/**
 * Title-bar engine picker — sits left of the microphone, so the two decisions
 * that shape a dictation (what listens, what transcribes) are next to each
 * other rather than one being buried in Settings.
 *
 * The icon carries the state that actually matters: a cloud when the audio
 * leaves the machine, a chip when it does not. That distinction is the whole
 * reason the local engine exists, and it should be readable without opening
 * anything.
 *
 * Local sizes are listed with what they cost, and a size that is not on disk
 * says so. Picking it still works — main downloads on demand and the widget
 * says "Download the local model in Settings" if it has to — but the menu
 * should not let that arrive as a surprise.
 */

const MOONSHINE_PREFIX = 'moonshine:'

/** The union of the two settings this control writes, flattened to one id. */
type Choice = 'groq' | `${typeof MOONSHINE_PREFIX}${MoonshineModelSize}`

export function TitleBarModel() {
  const [open, setOpen] = useState(false)
  const [choice, setChoice] = useState<Choice>('groq')
  const [status, setStatus] = useState<Partial<Record<MoonshineModelSize, MoonshineStatus>>>({})
  const [menu, setMenu] = useState<{ top: number; right: number } | null>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const listId = useId()

  const readChoice = useCallback((provider: string | undefined, size: string | undefined): Choice => {
    if (provider !== 'moonshine') return 'groq'
    return `${MOONSHINE_PREFIX}${isMoonshineSize(size ?? '') ? (size as MoonshineModelSize) : 'medium'}`
  }, [])

  useEffect(() => {
    void window.dictateflow.settings
      .getAll()
      .then((s) => setChoice(readChoice(s.speechProvider, s.moonshineModelSize)))
    return window.dictateflow.settings.onChanged((s) =>
      setChoice(readChoice(s.speechProvider, s.moonshineModelSize)),
    )
  }, [readChoice])

  /** Which local models are actually on disk. Cheap enough to redo on open. */
  const loadStatus = useCallback(async () => {
    const rows = await Promise.all(
      MOONSHINE_SIZES.map(async (size) => {
        try {
          return [size, await window.dictateflow.moonshine.status(size)] as const
        } catch {
          return [size, undefined] as const
        }
      }),
    )
    setStatus(Object.fromEntries(rows.filter(([, s]) => s)))
  }, [])

  useEffect(() => window.dictateflow.moonshine.onStatus(() => void loadStatus()), [loadStatus])

  useEffect(() => {
    if (!open) return
    void loadStatus()

    const place = () => {
      const rect = buttonRef.current?.getBoundingClientRect()
      if (!rect) return
      setMenu({ top: rect.bottom + 6, right: window.innerWidth - rect.right })
    }
    place()

    const onPointer = (e: MouseEvent) => {
      const t = e.target as Node
      if (buttonRef.current?.contains(t) || menuRef.current?.contains(t)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', onPointer)
    window.addEventListener('keydown', onKey)
    window.addEventListener('resize', place)
    return () => {
      window.removeEventListener('mousedown', onPointer)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', place)
    }
  }, [open, loadStatus])

  const pick = (next: Choice) => {
    setChoice(next)
    setOpen(false)

    if (next === 'groq') {
      void window.dictateflow.settings.set('speechProvider', 'groq').catch(() => {})
      return
    }

    // Size BEFORE provider. Switching to Moonshine is what triggers the model
    // load, so it has to already know which size it is loading — the other
    // order loads the previous size and then immediately swaps it.
    const size = next.slice(MOONSHINE_PREFIX.length) as MoonshineModelSize
    void window.dictateflow.settings
      .set('moonshineModelSize', size)
      .then(() => window.dictateflow.settings.set('speechProvider', 'moonshine'))
      .catch(() => {})
  }

  const local = choice !== 'groq'
  const Icon = local ? Cpu : Cloud
  const currentLabel = local
    ? `Moonshine ${MOONSHINE_MODELS[choice.slice(MOONSHINE_PREFIX.length) as MoonshineModelSize].label} · on this device`
    : 'Groq · cloud'

  return (
    <>
      <Tooltip label={`Transcribe with: ${currentLabel}`}>
        <button
          ref={buttonRef}
          type="button"
          aria-label={`Transcribe with: ${currentLabel}`}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          onClick={() => setOpen((v) => !v)}
          className={cn(
            'flex h-8 items-center gap-1 rounded-md px-2 text-ink-muted transition-colors',
            'hover:bg-line-soft hover:text-ink',
            open && 'bg-line-soft text-ink',
          )}
        >
          <Icon size={15} strokeWidth={2} />
          <ChevronDown size={12} strokeWidth={2.5} className="opacity-70" />
        </button>
      </Tooltip>

      {open &&
        menu &&
        createPortal(
          <div
            ref={menuRef}
            id={listId}
            role="listbox"
            aria-label="Transcription engine"
            style={{ top: menu.top, right: menu.right }}
            className={
              'fixed z-[100] w-72 overflow-hidden rounded-lg border border-line ' +
              'bg-panel/95 py-1 shadow-lg backdrop-blur-sm'
            }
          >
            <div role="group" aria-label="Cloud">
              <GroupLabel>Cloud</GroupLabel>
              <ModelOption
                label="Groq · Whisper Large v3 Turbo"
                note="Fastest. Needs a key and a connection."
                selected={choice === 'groq'}
                onSelect={() => pick('groq')}
              />
            </div>

            <div role="group" aria-label="On this device">
              <GroupLabel>On this device</GroupLabel>
              {MOONSHINE_SIZES.map((size) => {
                const spec = MOONSHINE_MODELS[size]
                const state = status[size]?.state
                return (
                  <ModelOption
                    key={size}
                    label={`Moonshine ${spec.label}`}
                    note={
                      state === 'ready'
                        ? `Downloaded · ${spec.wer} errors`
                        : state === 'downloading'
                          ? 'Downloading…'
                          : `${formatBytes(spec.bytes)} download · ${spec.wer} errors`
                    }
                    selected={choice === `${MOONSHINE_PREFIX}${size}`}
                    onSelect={() => pick(`${MOONSHINE_PREFIX}${size}`)}
                  />
                )
              })}
            </div>
          </div>,
          document.body,
        )}
    </>
  )
}

function GroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-3 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-ink-muted">
      {children}
    </p>
  )
}

function ModelOption({
  label,
  note,
  selected,
  onSelect,
}: {
  label: string
  note: string
  selected: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      onClick={onSelect}
      className={cn(
        'flex w-full items-start gap-2 px-3 py-2 text-left transition-colors',
        selected ? 'bg-selected text-ink' : 'text-ink hover:bg-line-soft',
      )}
    >
      <Check
        size={14}
        strokeWidth={2}
        className={cn('mt-0.5 shrink-0', selected ? 'opacity-100' : 'opacity-0')}
      />
      <span className="min-w-0">
        <span className={cn('block truncate text-[13px]', selected && 'font-medium')}>{label}</span>
        <span className="block truncate text-[11px] text-ink-muted">{note}</span>
      </span>
    </button>
  )
}
