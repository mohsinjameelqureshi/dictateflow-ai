import type { ReactNode } from 'react'
import { cn } from '@/lib/utils.js'

/**
 * The building blocks every settings tab is made of. §12 — generous
 * whitespace, greyscale with one accent, density is not the goal.
 */

export function Section({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: ReactNode
}) {
  return (
    <section className="rounded-panel border border-line bg-panel">
      <header className="border-b border-line-soft px-5 py-4">
        <h2 className="text-sm font-medium text-ink">{title}</h2>
        {description && <p className="mt-1 text-[13px] text-ink-muted">{description}</p>}
      </header>
      <div className="px-5">{children}</div>
    </section>
  )
}

export function Row({
  label,
  hint,
  htmlFor,
  children,
}: {
  label: string
  hint?: string
  htmlFor?: string
  children: ReactNode
}) {
  return (
    <div className="flex items-start justify-between gap-8 border-b border-line-soft py-4 last:border-0">
      <div className="min-w-0 pt-1">
        {/* A <label> pointing at nothing is worse than a <span>: screen
            readers announce it as a control that cannot be reached. The
            shortcut field is a button group, not a labelable element. */}
        {htmlFor ? (
          <label htmlFor={htmlFor} className="text-sm text-ink">
            {label}
          </label>
        ) : (
          <span className="text-sm text-ink">{label}</span>
        )}
        {hint && <p className="mt-0.5 max-w-sm text-[13px] text-ink-muted">{hint}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

/** Read-only key/value, for About. Monospace because these get copied out. */
export function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-6 border-b border-line-soft py-3 last:border-0">
      <span className="text-sm text-ink-muted">{label}</span>
      <span className="selectable truncate text-right font-mono text-xs text-ink">{value}</span>
    </div>
  )
}

export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  label: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative h-6 w-11 shrink-0 rounded-full transition-colors',
        checked ? 'bg-accent' : 'bg-line',
      )}
    >
      <span
        className={cn(
          'absolute top-0.5 size-5 rounded-full bg-white shadow-sm transition-[left]',
          checked ? 'left-[22px]' : 'left-0.5',
        )}
      />
    </button>
  )
}

export function Select({
  id,
  value,
  onChange,
  disabled,
  children,
}: {
  id?: string
  value: string
  onChange: (next: string) => void
  disabled?: boolean
  children: ReactNode
}) {
  return (
    <select
      id={id}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        'h-9 w-64 max-w-full rounded-lg border border-line bg-surface px-3 text-sm text-ink',
        'outline-none focus-visible:border-accent disabled:opacity-50',
      )}
    >
      {children}
    </select>
  )
}

/** One key, drawn as a key. Used by the shortcut field. */
export function KeyCap({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded-md border border-line bg-surface px-2 py-1 font-sans text-xs font-medium text-ink shadow-[0_1px_0_var(--color-line)]">
      {children}
    </kbd>
  )
}
