import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button.js'
import { cn } from '@/lib/utils.js'
import { codeToKeyName, keyLabel, normalizeShortcut, parseShortcut, validateShortcut } from '@shared/shortcut.js'
import { KeyCap } from './parts.js'

/**
 * Records a hold-to-talk combo from real key presses.
 *
 * Two things make this more than an input box:
 *
 *   1. The OLD shortcut is still armed while the user is pressing keys to
 *      replace it. The global hook is suspended for the whole capture, or
 *      rebinding away from Ctrl+Win starts a dictation the moment they press
 *      Ctrl+Win to show what they mean.
 *   2. The combo is the LARGEST set of keys held at once, not whatever is
 *      still down at the end. Releases arrive in whatever order the fingers
 *      lift, so reading the tail would record "Ctrl" when the user held
 *      "Ctrl+Shift+Space".
 */
export function ShortcutField({
  value,
  onSave,
}: {
  value: string
  onSave: (combo: string) => void
}) {
  const [capturing, setCapturing] = useState(false)
  const [preview, setPreview] = useState<string[]>([])
  const [problem, setProblem] = useState<string | null>(null)

  /** Keys physically down right now. The DOM has no "is this key down" query. */
  const down = useRef(new Set<string>())
  const best = useRef<string[]>([])

  // `onSave` is intentionally not a dependency: re-running this effect would
  // suspend/resume the hook mid-capture and drop the held-key set.
  const save = useRef(onSave)
  save.current = onSave

  useEffect(() => {
    if (!capturing) return

    down.current.clear()
    best.current = []
    setPreview([])
    setProblem(null)

    void window.wispr.shortcut.suspend(true)

    const commit = () => {
      // Activating "Change" with the keyboard fires the button on Enter's
      // keydown, so Enter's keyup lands here with nothing ever pressed.
      // Committing that would greet a keyboard user with an error.
      if (best.current.length === 0) return

      const combo = normalizeShortcut(best.current)
      best.current = []

      const reason = validateShortcut(combo)
      if (reason) {
        // Stay in capture so the next attempt needs no second click.
        setProblem(reason)
        return
      }

      save.current(combo)
      setCapturing(false)
    }

    const onKeyDown = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (e.repeat) return

      // Escape is reserved for cancelling a dictation (§11) and has no entry
      // in the key table, so it can never be bound. Here it means "never mind".
      if (e.code === 'Escape') {
        setCapturing(false)
        return
      }

      const name = codeToKeyName(e.code)
      if (!name) {
        setProblem('That key cannot be part of a shortcut.')
        return
      }

      down.current.add(name)
      const keys = [...down.current]
      if (keys.length > best.current.length) best.current = keys
      setPreview(keys)
      setProblem(null)
    }

    const onKeyUp = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()

      const name = codeToKeyName(e.code)
      if (name) down.current.delete(name)
      if (down.current.size === 0) commit()
    }

    // No keyup arrives for a key released over another window, so a lost focus
    // would strand `down` half-full. Pressing Win on its own opens the Start
    // menu, which is exactly how that happens.
    const onBlur = () => setCapturing(false)

    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('keyup', onKeyUp, true)
    window.addEventListener('blur', onBlur)

    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('keyup', onKeyUp, true)
      window.removeEventListener('blur', onBlur)
      // The matching `false`, guaranteed on every exit including unmount. A
      // stuck `true` disables dictation with no visible cause.
      void window.wispr.shortcut.suspend(false)
    }
  }, [capturing])

  const keys = capturing ? preview : parseShortcut(value)

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex items-center gap-2">
        <div
          className={cn(
            'flex h-9 w-64 items-center justify-center gap-1.5 rounded-lg border px-3',
            capturing ? 'border-accent bg-accent-soft' : 'border-line bg-surface',
          )}
        >
          {keys.length > 0 ? (
            keys.map((k) => <KeyCap key={k}>{keyLabel(k)}</KeyCap>)
          ) : (
            <span className="text-[13px] text-ink-muted">
              {capturing ? 'Hold the keys you want' : 'Not set'}
            </span>
          )}
        </div>

        <Button
          size="sm"
          variant={capturing ? 'primary' : 'secondary'}
          onClick={() => setCapturing((c) => !c)}
        >
          {capturing ? 'Cancel' : 'Change'}
        </Button>
      </div>

      {problem ? (
        <p className="max-w-72 text-right text-[13px] text-danger">{problem}</p>
      ) : capturing ? (
        <p className="text-right text-[13px] text-ink-muted">Release to set. Esc to cancel.</p>
      ) : null}
    </div>
  )
}
