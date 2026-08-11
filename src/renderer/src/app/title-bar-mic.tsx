import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Check, ChevronDown, Mic } from 'lucide-react'
import { createPortal } from 'react-dom'
import type { AudioInputDevice } from '@shared/types.js'
import { Tooltip } from '@/components/ui/tooltip.js'
import { cn } from '@/lib/utils.js'

/**
 * Title-bar microphone picker — sits left of the window controls so changing
 * mic does not require opening Settings.
 *
 * Device labels still come through the widget (§6.7). An empty id is system
 * default; when the chosen device disappears, main clears the setting and
 * settings:changed updates this control.
 */
export function TitleBarMic() {
  const [open, setOpen] = useState(false)
  const [devices, setDevices] = useState<AudioInputDevice[] | null>(null)
  const [selected, setSelected] = useState('')
  const [menu, setMenu] = useState<{ top: number; right: number } | null>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const listId = useId()

  const load = useCallback(async () => {
    try {
      setDevices(await window.dictateflow.devices.list())
    } catch {
      setDevices([])
    }
  }, [])

  useEffect(() => {
    void window.dictateflow.settings.getAll().then((s) => setSelected(s.microphoneId ?? ''))
    return window.dictateflow.settings.onChanged((s) => setSelected(s.microphoneId ?? ''))
  }, [])

  useEffect(() => window.dictateflow.devices.onChanged(() => void load()), [load])

  useEffect(() => {
    if (!open) return
    void load()

    const place = () => {
      const rect = buttonRef.current?.getBoundingClientRect()
      if (!rect) return
      setMenu({
        top: rect.bottom + 6,
        right: window.innerWidth - rect.right,
      })
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
  }, [open, load])

  const pick = (id: string) => {
    setSelected(id)
    setOpen(false)
    void window.dictateflow.settings.set('microphoneId', id).catch(() => {})
  }

  const currentLabel =
    selected === ''
      ? 'System default'
      : (devices?.find((d) => d.deviceId === selected)?.label ?? 'Microphone')

  return (
    <>
      <Tooltip label={`Microphone: ${currentLabel}`}>
        <button
          ref={buttonRef}
          type="button"
          aria-label={`Microphone: ${currentLabel}`}
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
          <Mic size={15} strokeWidth={2} />
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
            aria-label="Microphone"
            style={{ top: menu.top, right: menu.right }}
            className={
              'fixed z-[100] w-64 overflow-hidden rounded-lg border border-line ' +
              'bg-panel/95 py-1 shadow-lg backdrop-blur-sm'
            }
          >
            <MicOption
              label="System default"
              selected={selected === ''}
              onSelect={() => pick('')}
            />
            {devices === null && (
              <p className="px-3 py-2 text-[13px] text-ink-muted">Loading…</p>
            )}
            {devices?.length === 0 && (
              <p className="px-3 py-2 text-[13px] text-ink-muted">No microphones found.</p>
            )}
            {devices?.map((d) => (
              <MicOption
                key={d.deviceId}
                label={d.label}
                selected={selected === d.deviceId}
                onSelect={() => pick(d.deviceId)}
              />
            ))}
          </div>,
          document.body,
        )}
    </>
  )
}

function MicOption({
  label,
  selected,
  onSelect,
}: {
  label: string
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
        'flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] transition-colors',
        selected ? 'bg-selected font-medium text-ink' : 'text-ink hover:bg-line-soft',
      )}
    >
      <Check
        size={14}
        strokeWidth={2}
        className={cn('shrink-0', selected ? 'opacity-100' : 'opacity-0')}
      />
      <span className="min-w-0 truncate">{label}</span>
    </button>
  )
}
