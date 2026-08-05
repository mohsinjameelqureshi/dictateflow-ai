import { useEffect, useRef, useState } from 'react'

const BARS = 18

/** RMS of speech sits well below 1. Scale so normal talking fills the bar. */
const GAIN = 5

/**
 * Live input level (§11 — Listening shows a mic and a live waveform).
 *
 * A scrolling history rather than a symmetric bounce: it reads as "we are
 * still hearing you", which is the actual question the user has while
 * holding the key.
 */
export function Waveform({ level }: { level: number }) {
  const [bars, setBars] = useState<number[]>(() => new Array(BARS).fill(0))
  const latest = useRef(0)
  const reduced = usePrefersReducedMotion()

  latest.current = Math.min(1, level * GAIN)

  useEffect(() => {
    if (reduced) return
    // Sampled on a timer rather than per audio frame — the worklet fires
    // every 128 samples (~8ms at 16kHz), far faster than anyone can see.
    const id = setInterval(() => {
      setBars((prev) => [...prev.slice(1), latest.current])
    }, 55)
    return () => clearInterval(id)
  }, [reduced])

  // Reduced motion still needs to show that input is arriving, so it shows a
  // single steady meter instead of a scrolling one.
  if (reduced) {
    return (
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-line-soft">
        <div
          className="h-full rounded-full bg-accent"
          style={{ width: `${Math.round(Math.min(1, level * GAIN) * 100)}%` }}
        />
      </div>
    )
  }

  return (
    <div className="flex h-8 flex-1 items-center gap-[3px]" aria-hidden>
      {bars.map((v, i) => (
        <div
          key={i}
          className="flex-1 rounded-full bg-accent"
          style={{
            // A floor keeps the bar visible in silence; without it the widget
            // looks broken in a quiet room.
            height: `${Math.max(3, Math.round(v * 28))}px`,
            opacity: 0.35 + v * 0.65,
          }}
        />
      ))}
    </div>
  )
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  )

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onChange = () => setReduced(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  return reduced
}
