import { useEffect, useState } from 'react'
import type { Recorder } from './recorder.js'

const BARS = 12

/** ~12 columns/second — fits the narrower widget width. */
const STEP_MS = 55

/**
 * Live input level (§11 — Listening shows a mic and a live waveform).
 *
 * A scrolling history rather than a symmetric bounce: it reads as "we are
 * still hearing you", which is the actual question the user has while
 * holding the key.
 *
 * The level is PULLED from the recorder rather than pushed in as a prop. The
 * capture worklet fires every 128 samples (~8ms at 16kHz); routing that
 * through React state re-rendered the whole widget about 125 times a second
 * to move 18 divs. The recorder now keeps a smoothed value and this samples
 * it on the display cadence.
 */
export function Waveform({ recorder }: { recorder: Recorder }) {
  const [bars, setBars] = useState<number[]>(() => new Array(BARS).fill(0))
  const reduced = usePrefersReducedMotion()

  useEffect(() => {
    const id = setInterval(() => {
      setBars((prev) => [...prev.slice(1), recorder.level])
    }, STEP_MS)
    return () => clearInterval(id)
  }, [recorder])

  // Reduced motion still needs to show that input is arriving, so it shows a
  // single steady meter instead of a scrolling one.
  if (reduced) {
    const level = bars[bars.length - 1] ?? 0
    return (
      <div className="h-1.5 w-[72px] overflow-hidden rounded-full bg-line-soft">
        <div
          className="h-full rounded-full bg-accent transition-[width] duration-100"
          style={{ width: `${Math.round(level * 100)}%` }}
        />
      </div>
    )
  }

  return (
    <div className="flex h-5 w-[72px] items-center justify-center gap-[2px]" aria-hidden>
      {bars.map((v, i) => (
        <div
          key={i}
          className="w-[2px] shrink-0 rounded-full bg-accent"
          style={{
            height: `${Math.max(2, Math.round(v * 18))}px`,
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
