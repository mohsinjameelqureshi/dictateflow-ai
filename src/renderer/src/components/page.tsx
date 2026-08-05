import type { ReactNode } from 'react'

/** Shared page frame. §12 — generous whitespace, density is not the goal. */
export function Page({
  title,
  description,
  actions,
  children,
}: {
  title: string
  description?: string
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex items-start justify-between gap-4 px-10 pb-6 pt-9">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-ink">{title}</h1>
          {description && <p className="mt-1 text-sm text-ink-muted">{description}</p>}
        </div>
        {actions}
      </div>
      <div className="flex-1 overflow-y-auto px-10 pb-10">{children}</div>
    </div>
  )
}

/** §12 — the number dominates, the label is small. */
export function Stat({
  value,
  label,
  hint,
}: {
  value: string | number
  label: string
  hint?: string
}) {
  return (
    <div className="rounded-panel border border-line bg-panel p-6">
      <div className="text-4xl font-semibold tabular-nums tracking-tight text-ink">{value}</div>
      <div className="mt-2 text-sm text-ink-muted">{label}</div>
      {hint && <div className="mt-0.5 text-xs text-ink-subtle">{hint}</div>}
    </div>
  )
}

export function Empty({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex h-full min-h-64 flex-col items-center justify-center rounded-panel border border-dashed border-line text-center">
      <p className="text-sm font-medium text-ink">{title}</p>
      {hint && <p className="mt-1 max-w-sm text-sm text-ink-muted">{hint}</p>}
    </div>
  )
}
