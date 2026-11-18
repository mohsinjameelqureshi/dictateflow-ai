import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { MoreHorizontal } from 'lucide-react'
import { cn } from '@/lib/utils.js'
import { Button } from './button.js'
import { Tooltip } from './tooltip.js'

interface ActionMenuItem {
  label: string
  icon: ReactNode
  onSelect: () => void
  disabled?: boolean
  danger?: boolean
  checked?: boolean
}

export function ActionMenu({ label, items }: { label: string; items: ActionMenuItem[] }) {
  const id = useId()
  const trigger = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const fromEnd = useRef(false)
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState({ top: 0, right: 8, maxHeight: 400 })

  const close = (restoreFocus = true) => {
    setOpen(false)
    if (restoreFocus) trigger.current?.focus({ preventScroll: true })
  }

  useLayoutEffect(() => {
    if (!open) return
    const rect = trigger.current?.getBoundingClientRect()
    const surface = menu.current
    if (!rect || !surface) return
    const height = surface.getBoundingClientRect().height
    const below = rect.bottom + 6
    const top = below + height <= window.innerHeight - 8 ? below : Math.max(8, rect.top - height - 6)
    setPosition({ top, right: Math.max(8, window.innerWidth - rect.right), maxHeight: window.innerHeight - top - 8 })
    const controls = surface.querySelectorAll<HTMLButtonElement>('button:not([disabled])')
    const first = fromEnd.current ? controls[controls.length - 1] : controls[0]
    first?.focus({ preventScroll: true })
  }, [open])

  useEffect(() => {
    if (!open) return
    const outside = (event: MouseEvent) => {
      const target = event.target as Node
      if (!trigger.current?.contains(target) && !menu.current?.contains(target)) close(false)
    }
    const onScroll = (event: Event) => {
      if (event.target instanceof Node && menu.current?.contains(event.target)) return
      close(false)
    }
    const onResize = () => close(false)
    window.addEventListener('mousedown', outside)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('mousedown', outside)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onResize)
      // An Activity hides the page without discarding its draft state.
      // Menus are transient and should stay closed when that page returns.
      setOpen(false)
    }
  }, [open])

  return (
    <>
      <Tooltip label={label}>
        <Button
          ref={trigger}
          size="icon"
          variant="ghost"
          aria-label={label}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={open ? id : undefined}
          className={cn(open && 'bg-line-soft text-ink')}
          onClick={() => {
            if (open) close()
            else {
              fromEnd.current = false
              setOpen(true)
            }
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault()
              fromEnd.current = event.key === 'ArrowUp'
              setOpen(true)
            }
          }}
        >
          <MoreHorizontal size={16} aria-hidden />
        </Button>
      </Tooltip>
      {open && createPortal(
        <div
          ref={menu}
          id={id}
          role="menu"
          aria-label={label}
          style={position}
          className="fixed z-[100] w-52 max-w-[calc(100vw-16px)] overflow-y-auto rounded-lg border border-line bg-panel p-1 shadow-lg"
          onBlurCapture={(event) => {
            if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node)) close(false)
          }}
          onKeyDown={(event) => {
            const controls = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not([disabled])')]
            const current = controls.indexOf(document.activeElement as HTMLButtonElement)
            if (event.key === 'Escape') {
              event.preventDefault()
              event.stopPropagation()
              close()
            } else if (event.key === 'Tab') {
              trigger.current?.focus({ preventScroll: true })
              close(false)
            } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
              event.preventDefault()
              const next = event.key === 'Home' ? 0
                : event.key === 'End' ? controls.length - 1
                  : (current + (event.key === 'ArrowDown' ? 1 : -1) + controls.length) % controls.length
              controls[next]?.focus({ preventScroll: true })
            }
          }}
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role={item.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
              aria-checked={item.checked}
              disabled={item.disabled}
              tabIndex={-1}
              onClick={() => {
                close()
                item.onSelect()
              }}
              className={cn(
                'flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-[13px] hover:bg-selected focus:bg-selected focus:outline-none disabled:opacity-50',
                item.danger ? 'text-danger' : 'text-ink',
              )}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  )
}
