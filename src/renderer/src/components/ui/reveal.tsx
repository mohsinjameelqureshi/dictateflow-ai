import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'

/** Keep the closing content mounted while its space contracts. */
export function Reveal({ open, children }: { open: boolean; children: ReactNode }) {
  const [present, setPresent] = useState(open)
  const [expanded, setExpanded] = useState(false)

  useLayoutEffect(() => {
    if (!open && !present) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setPresent(open)
      setExpanded(open)
      return
    }
    let frame = 0
    let nextFrame = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    if (open) {
      setPresent(true)
      frame = requestAnimationFrame(() => {
        nextFrame = requestAnimationFrame(() => setExpanded(true))
      })
    } else {
      setExpanded(false)
      timer = setTimeout(() => setPresent(false), 220)
    }
    return () => {
      cancelAnimationFrame(frame)
      cancelAnimationFrame(nextFrame)
      if (timer) clearTimeout(timer)
    }
  }, [open])

  if (!open && !present) return null
  return (
    <div className="ui-reveal" data-open={expanded} aria-hidden={!open} inert={!open}>
      <div className="ui-reveal-clip">
        <div className="ui-reveal-content">{children}</div>
      </div>
    </div>
  )
}

/** Animate a content swap's height without scaling its text or controls. */
export function AnimatedSize({ as: Tag = 'div', className, children }: {
  as?: 'div' | 'li'
  className?: string
  children: ReactNode
}) {
  const outer = useRef<HTMLElement | null>(null)
  const inner = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const surface = outer.current
    const content = inner.current
    if (!surface || !content) return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
    let previous = surface.getBoundingClientRect().height
    let animation: Animation | null = null

    const observer = new ResizeObserver(() => {
      const style = getComputedStyle(surface)
      const next = content.getBoundingClientRect().height
        + parseFloat(style.paddingTop) + parseFloat(style.paddingBottom)
        + parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth)
      const from = animation ? surface.getBoundingClientRect().height : previous
      previous = next
      animation?.cancel()
      animation = null
      surface.style.overflow = ''
      if (reduced.matches || Math.abs(from - next) < 1) return
      surface.style.overflow = 'clip'
      const current = surface.animate([{ height: `${from}px` }, { height: `${next}px` }], {
        duration: 180,
        easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
      })
      animation = current
      current.onfinish = () => {
        if (animation !== current) return
        animation = null
        surface.style.overflow = ''
      }
    })
    observer.observe(content)
    const stop = () => {
      animation?.cancel()
      animation = null
      surface.style.overflow = ''
    }
    reduced.addEventListener('change', stop)
    return () => {
      observer.disconnect()
      reduced.removeEventListener('change', stop)
      stop()
    }
  }, [])

  return (
    <Tag ref={(node: HTMLDivElement | HTMLLIElement | null) => { outer.current = node }} className={`min-h-0 ${className ?? ''}`}>
      <div ref={inner} className="flow-root">{children}</div>
    </Tag>
  )
}
