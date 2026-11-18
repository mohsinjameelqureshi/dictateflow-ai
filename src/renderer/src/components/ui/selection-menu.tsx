import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown, Loader2, TriangleAlert } from 'lucide-react'
import { cn } from '@/lib/utils.js'
import { Tooltip } from './tooltip.js'

export interface SelectionOption {
  value: string
  label: string
  description?: string | undefined
  group?: string
}

/** Moving through choices changes focus, never the saved setting. */
export function SelectionMenu({ label, name, icon, value, options, onSelect, onOpen, note, width = 288 }: {
  label: string
  name: string
  icon: ReactNode
  value: string
  options: SelectionOption[]
  onSelect: (value: string) => Promise<void>
  onOpen: () => Promise<void>
  note?: string | undefined
  width?: number
}) {
  const id = useId()
  const trigger = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const savingRef = useRef(false)
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [position, setPosition] = useState({ top: 0, right: 8, maxHeight: 400 })
  const activeOption = options[activeIndex]

  const close = (restoreFocus = true) => {
    setOpen(false)
    if (restoreFocus) trigger.current?.focus()
  }

  const show = (fromEnd = false) => {
    const selected = options.findIndex((option) => option.value === value)
    setActiveIndex(selected >= 0 ? selected : fromEnd ? Math.max(0, options.length - 1) : 0)
    setError(null)
    setOpen(true)
  }

  useLayoutEffect(() => {
    if (!open && !error) return
    const place = () => {
      const rect = trigger.current?.getBoundingClientRect()
      if (!rect) return
      const top = rect.bottom + 6
      setPosition({ top, right: Math.max(8, window.innerWidth - rect.right), maxHeight: Math.max(0, window.innerHeight - top - 8) })
    }
    place()
    if (open) list.current?.focus()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [open, error])

  useEffect(() => {
    if (!open) return
    void onOpen()
    const onPointer = (event: MouseEvent) => {
      const target = event.target as Node
      if (trigger.current?.contains(target) || panel.current?.contains(target)) return
      setOpen(false)
    }
    window.addEventListener('mousedown', onPointer)
    return () => window.removeEventListener('mousedown', onPointer)
  }, [open, onOpen])

  useEffect(() => {
    if (open) setActiveIndex((index) => Math.min(index, Math.max(0, options.length - 1)))
  }, [open, options.length])

  useEffect(() => {
    if (open) document.getElementById(`${id}-option-${activeIndex}`)?.scrollIntoView({ block: 'nearest' })
  }, [open, activeIndex, id])

  const select = async (option: SelectionOption) => {
    if (savingRef.current) return
    if (option.value === value) {
      close()
      return
    }
    savingRef.current = true
    setSaving(true)
    setError(null)
    try {
      await onSelect(option.value)
      setOpen(false)
      if (panel.current?.contains(document.activeElement)) trigger.current?.focus()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save your selection. Try again.')
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  return (
    <>
      <Tooltip label={saving ? `Saving ${name.toLowerCase()}…` : label}>
        <button
          ref={trigger}
          type="button"
          aria-label={label}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={open ? `${id}-list` : undefined}
          aria-busy={saving}
          onClick={() => open ? close() : show()}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault()
              if (open) list.current?.focus()
              else show(event.key === 'ArrowUp')
            }
          }}
          className={cn(
            'flex h-8 items-center gap-1 rounded-md px-2 text-ink-muted transition-colors hover:bg-line-soft hover:text-ink',
            open && 'bg-line-soft text-ink',
          )}
        >
          {icon}
          {saving ? <Loader2 size={12} className="animate-spin" /> : <ChevronDown size={12} strokeWidth={2.5} className="opacity-70" />}
        </button>
      </Tooltip>

      {open && createPortal(
        <div
          ref={panel}
          style={{ ...position, width, maxWidth: 'calc(100vw - 16px)' }}
          className="fixed z-[100] overflow-y-auto rounded-lg border border-line bg-panel py-1 shadow-lg"
          onBlurCapture={(event) => {
            if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node)) close(false)
          }}
        >
          <div
            ref={list}
            id={`${id}-list`}
            role="listbox"
            tabIndex={0}
            aria-label={name}
            aria-busy={saving}
            aria-disabled={saving}
            aria-activedescendant={activeOption ? `${id}-option-${activeIndex}` : undefined}
            aria-describedby={error ? `${id}-error` : undefined}
            className="outline-none"
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault()
                event.stopPropagation()
                close()
              } else if (event.key === 'Tab') {
                // Resume native tab order from the trigger, outside the portal.
                trigger.current?.focus()
                close(false)
              } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault()
                const direction = event.key === 'ArrowDown' ? 1 : -1
                if (options.length) setActiveIndex((index) => (index + direction + options.length) % options.length)
              } else if (event.key === 'Home' || event.key === 'End') {
                event.preventDefault()
                setActiveIndex(event.key === 'Home' ? 0 : Math.max(0, options.length - 1))
              } else if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                if (activeOption) void select(activeOption)
              }
            }}
          >
            {options.map((option, index) => (
              <div key={option.value} role="presentation">
                {option.group && option.group !== options[index - 1]?.group && (
                  <p role="presentation" className="px-3 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-ink-muted">{option.group}</p>
                )}
                <div
                  id={`${id}-option-${index}`}
                  role="option"
                  aria-selected={option.value === value}
                  aria-disabled={saving}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseMove={() => setActiveIndex(index)}
                  onClick={() => void select(option)}
                  className={cn(
                    'mx-1 flex items-start gap-2 rounded-md px-2 py-2 text-left text-ink transition-colors',
                    option.value === value && 'font-medium',
                    activeIndex === index && 'bg-selected',
                    saving && 'opacity-60',
                  )}
                >
                  <Check size={14} strokeWidth={2} aria-hidden className={cn('mt-0.5 shrink-0', option.value === value ? 'opacity-100' : 'opacity-0')} />
                  <span className="min-w-0">
                    <span className="block break-words text-[13px]">{option.label}</span>
                    {option.description && <span className="mt-0.5 block text-xs font-normal leading-relaxed text-ink-muted">{option.description}</span>}
                  </span>
                </div>
              </div>
            ))}
          </div>
          {(saving || note) && <p role="status" className="px-3 py-2 text-xs text-ink-muted">{saving ? 'Saving selection…' : note}</p>}
          {error && (
            <p id={`${id}-error`} role="alert" className="mx-3 my-2 flex items-start gap-2 text-xs leading-relaxed text-danger">
              <TriangleAlert size={14} className="mt-0.5 shrink-0" aria-hidden />
              {error}
            </p>
          )}
        </div>,
        document.body,
      )}
      {!open && error && createPortal(
        <div
          style={{ ...position, width, maxWidth: 'calc(100vw - 16px)' }}
          className="fixed z-[100] rounded-lg border border-line bg-panel p-3 shadow-lg"
        >
          <p role="alert" className="text-xs leading-relaxed text-danger">{error}</p>
          <button type="button" className="mt-2 rounded px-1 py-1 text-xs font-medium text-ink hover:bg-line-soft" onClick={() => setError(null)}>
            Dismiss
          </button>
        </div>,
        document.body,
      )}
    </>
  )
}
