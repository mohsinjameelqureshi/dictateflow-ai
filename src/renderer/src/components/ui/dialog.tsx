import { useEffect, useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { Tooltip } from './tooltip.js'
import { cn } from '@/lib/utils.js'

/**
 * The app's modal dialog.
 *
 * Not `<dialog showModal()>`: the top layer sits above everything, including
 * the portalled tooltip bubble, and a tooltip that renders behind the surface
 * it describes is worse than no tooltip. A portal to `document.body` with an
 * explicit z-index keeps the two stacking in the order they are written.
 *
 * Everything a modal owes the keyboard is here, because none of it is free
 * without the native element (§14):
 *
 *   - focus moves in on open and returns to the trigger on close
 *   - Tab cycles inside the panel and cannot reach the window behind it
 *   - Esc closes, unless something deeper has already claimed the key
 *   - the page behind does not scroll while the panel is up
 *
 * Esc is a bubble-phase listener on purpose. The shortcut recorder listens in
 * the CAPTURE phase and stops propagation, so while a combo is being recorded
 * Esc cancels the recording and the dialog stays put — the innermost thing
 * that can be dismissed goes first, which is what Esc means everywhere else.
 */

/** Everything focusable, minus anything explicitly removed from the order. */
const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

export function Dialog({
  open,
  onClose,
  title,
  description,
  className,
  children,
}: {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  className?: string
  children: ReactNode
}) {
  const panel = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const descId = useId()

  /**
   * The element that had focus when the dialog opened. Captured in a ref
   * rather than read on close, because by then focus is inside the panel.
   */
  const returnTo = useRef<HTMLElement | null>(null)

  // `onClose` through a ref: the listeners below are bound once per open, and
  // a new callback identity each render would otherwise rebind them all.
  const close = useRef(onClose)
  close.current = onClose

  useEffect(() => {
    if (!open) return

    returnTo.current = document.activeElement instanceof HTMLElement ? document.activeElement : null

    // The panel itself, not its first control. Nothing in here is the obvious
    // thing to act on, and landing on Close would offer "leave" as the opening
    // move. A screen reader reads the dialog's own label on arrival instead.
    panel.current?.focus()

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        close.current()
        return
      }

      if (e.key !== 'Tab') return

      const el = panel.current
      if (!el) return

      const items = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        // offsetParent is null for anything display:none — the controls of a
        // tab that is not showing are in the DOM but must not be tabbable.
        (n) => n.offsetParent !== null,
      )

      const first = items[0]
      const last = items[items.length - 1]
      if (!first || !last) return

      // Wrap at both ends. Without this, Tab off the last control reaches the
      // window behind the dialog, which is the one thing a modal must prevent.
      const active = document.activeElement
      if (e.shiftKey && (active === first || active === el)) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && active === last) {
        e.preventDefault()
        first.focus()
      }
    }

    window.addEventListener('keydown', onKeyDown)

    const { overflow } = document.body.style
    document.body.style.overflow = 'hidden'

    return () => {
      window.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = overflow
      // Back to the control that opened it — the sidebar's Settings button.
      returnTo.current?.focus()
    }
  }, [open])

  if (!open) return null

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-8"
      // The backdrop is the click target, not the panel's parent-by-accident:
      // the check below is `=== e.target`, so a click that started inside the
      // panel and drifted out while selecting text does not dismiss.
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close.current()
      }}
    >
      {/* pointer-events-none is load-bearing, not a tidy-up: the scrim covers
          the whole container, so without it every backdrop click targets THIS
          element and the `target === currentTarget` test above never matches —
          clicking outside the panel would do nothing. */}
      <div
        aria-hidden
        className="dialog-scrim pointer-events-none absolute inset-0 bg-scrim backdrop-blur-[2px]"
      />

      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        className={cn(
          // max-h-full beats the caller's fixed height on a short window, so a
          // dialog taller than the viewport shrinks instead of spilling past
          // it — 125% and 150% DPI both land here (§14).
          'dialog-panel relative flex max-h-full min-h-0 w-full flex-col overflow-hidden rounded-panel border border-line bg-surface shadow-2xl outline-none',
          className,
        )}
      >
        <header className="flex shrink-0 items-start justify-between gap-6 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <h1 id={titleId} className="text-sm font-medium text-ink">
              {title}
            </h1>
            {description && (
              <p id={descId} className="mt-0.5 text-[13px] text-ink-muted">
                {description}
              </p>
            )}
          </div>

          <Tooltip label="Close">
            <button
              type="button"
              onClick={() => close.current()}
              aria-label="Close"
              className="-mr-1 -mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-line-soft hover:text-ink"
            >
              <X size={16} strokeWidth={2} />
            </button>
          </Tooltip>
        </header>

        {children}
      </div>
    </div>,
    document.body,
  )
}
