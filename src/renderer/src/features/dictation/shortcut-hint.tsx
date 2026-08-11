import { useEffect, useState } from 'react'
import { keyLabel, parseShortcut } from '@shared/shortcut.js'
import { Button } from '@/components/ui/button.js'
import { useSettingsDialog } from '@/features/settings/store.js'

/**
 * The current hold-to-talk binding, spelled out in keycaps.
 *
 * This is the one thing a dictation app has to teach, and the shortcut is set
 * somewhere else — so it is stated here rather than left to be discovered. It
 * follows a rebind live, via the settings-changed broadcast, so the caps are
 * already correct by the time the dialog closes over them.
 */

/**
 * The amber cap is deliberately NOT the accent (§12 allows one, and it is
 * indigo). Accent means "active" or "primary" elsewhere in the app; a key you
 * are being told to press is a different idea, and painting it indigo would
 * read as "selected".
 */
function KeyCap({ children }: { children: string }) {
  return (
    <kbd
      className={
        'rounded-md border-2 border-key-edge bg-key px-2 py-0.5 font-sans text-[15px] ' +
        'font-bold leading-tight text-key-ink'
      }
    >
      {children}
    </kbd>
  )
}

export function ShortcutHint() {
  const [shortcut, setShortcut] = useState<string | null>(null)
  const openSettings = useSettingsDialog((s) => s.open)

  useEffect(() => {
    void window.dictateflow.settings.getAll().then((s) => setShortcut(s.shortcut ?? ''))
    return window.dictateflow.settings.onChanged((s) => setShortcut(s.shortcut ?? ''))
  }, [])

  // Nothing at all until the value is known — flashing "not set" and then
  // correcting itself would be worse than a beat of blank space.
  if (shortcut === null) return <div className="mb-6 h-8" />

  const keys = parseShortcut(shortcut)

  if (keys.length === 0) {
    return (
      <p className="mb-6 flex flex-wrap items-center gap-2 text-[15px] text-ink">
        No shortcut is set, so dictation cannot start.
        <Button size="sm" onClick={() => openSettings('general')}>
          Choose one
        </Button>
      </p>
    )
  }

  return (
    <p className="mb-6 flex flex-wrap items-center gap-x-2 gap-y-2 text-[15px] text-ink">
      <span>Hold</span>
      {keys.map((key, i) => (
        // Index is safe here: the list is a fixed combo, never reordered.
        <span key={key} className="flex items-center gap-2">
          {i > 0 && <span className="text-ink-muted">+</span>}
          <KeyCap>{keyLabel(key)}</KeyCap>
        </span>
      ))}
      <span>and start speaking.</span>
    </p>
  )
}
