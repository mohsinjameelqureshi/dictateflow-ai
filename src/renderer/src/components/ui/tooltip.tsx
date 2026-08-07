import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils.js'

/**
 * The app's tooltip. Replaces the browser's `title` attribute, which renders
 * an OS chip — square, black, half a second late, and identical in every app
 * on the machine.
 *
 * The surface deliberately matches the dictation widget: near-white,
 * translucent, blurred, hairline border, soft shadow. The two are the only
 * things in the app that float above the page, so they should read as the
 * same object.
 *
 * Rendered through a PORTAL rather than positioned inside its trigger. The
 * heatmap's week grid lives in an `overflow-x-auto` container, and CSS forces
 * `overflow-y` off `visible` the moment one axis is set — so an absolutely
 * positioned bubble would be clipped by the very element it describes.
 */

const GAP = 8
const EDGE = 8

/** Opening instantly on every hover is twitchy; waiting on every hover is slow. */
const OPEN_DELAY_MS = 350

/**
 * Once one tooltip has opened, neighbours open instantly for a moment — so
 * moving along a row of icon buttons does not re-pay the delay on each.
 */
const WARM_MS = 400
let lastClosedAt = 0

export interface TooltipAnchor {
  rect: DOMRect
  label: string
}

/** The floating bubble. Controlled — pass null to hide it. */
export function TooltipBubble({ anchor }: { anchor: TooltipAnchor | null }) {
  const ref = useRef<HTMLDivElement>(null)
  const [placement, setPlacement] = useState<{
    left: number
    top: number
    arrow: number
    below: boolean
  } | null>(null)

  useLayoutEffect(() => {
    if (!anchor) {
      setPlacement(null)
      return
    }
    const el = ref.current
    if (!el) return

    const { width, height } = el.getBoundingClientRect()
    const { rect } = anchor

    // Above by default; flip below only when there is no room, so a tooltip
    // near the top of the window is not cut off by it.
    let below = false
    let top = rect.top - height - GAP
    if (top < EDGE) {
      below = true
      top = rect.bottom + GAP
    }

    // Clamp to the viewport so a bubble on the last heatmap column, or on the
    // window's close button, stays fully readable.
    const half = width / 2
    const centre = rect.left + rect.width / 2
    const left = Math.min(Math.max(centre, EDGE + half), window.innerWidth - EDGE - half)

    // The arrow keeps pointing at the trigger even when the bubble is clamped.
    const arrow = Math.min(Math.max(centre - (left - half), 12), width - 12)

    setPlacement({ left, top, arrow, below })
  }, [anchor])

  if (!anchor) return null

  return createPortal(
    <div
      ref={ref}
      // The control itself carries the accessible name via aria-label; a
      // second copy here would make screen readers say everything twice.
      aria-hidden
      className={cn(
        'pointer-events-none fixed z-[9999] transition-opacity duration-150',
        placement ? 'opacity-100' : 'opacity-0',
      )}
      style={{
        left: placement?.left ?? 0,
        top: placement?.top ?? 0,
        transform: 'translateX(-50%)',
      }}
    >
      <div className="relative rounded-lg border border-line bg-panel/95 px-2.5 py-1.5 text-xs font-medium text-ink shadow-lg backdrop-blur-sm">
        {anchor.label}
        {/* A rotated square, not a CSS triangle: it inherits the same
            translucent fill and hairline, so the arrow frosts like the rest. */}
        <span
          className={cn(
            'absolute size-2 rotate-45 border-line bg-panel/95',
            placement?.below ? '-top-1 border-l border-t' : '-bottom-1 border-b border-r',
          )}
          style={{ left: (placement?.arrow ?? 0) - 4 }}
        />
      </div>
    </div>,
    document.body,
  )
}

/**
 * Wraps a single control. For one-off triggers — icon buttons, window
 * controls. Dense grids should drive `TooltipBubble` directly rather than
 * mount hundreds of these.
 */
export function Tooltip({
  label,
  children,
  className,
}: {
  label: string
  children: ReactNode
  className?: string
}) {
  const host = useRef<HTMLSpanElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [anchor, setAnchor] = useState<TooltipAnchor | null>(null)

  const clear = () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
  }

  const open = () => {
    clear()
    const show = () => {
      const el = host.current
      if (el) setAnchor({ rect: el.getBoundingClientRect(), label })
    }
    if (Date.now() - lastClosedAt < WARM_MS) show()
    else timer.current = setTimeout(show, OPEN_DELAY_MS)
  }

  const close = () => {
    clear()
    if (anchor) lastClosedAt = Date.now()
    setAnchor(null)
  }

  return (
    <>
      <span
        ref={host}
        className={cn('inline-flex', className)}
        onMouseEnter={open}
        onMouseLeave={close}
        // Capture, so focus reaching the button inside is enough. Keyboard
        // users get the same affordance as the mouse (§14).
        onFocusCapture={open}
        onBlurCapture={close}
        // A tooltip that survives the click it describes is in the way.
        onClickCapture={close}
      >
        {children}
      </span>
      <TooltipBubble anchor={anchor} />
    </>
  )
}
