import type { InputHTMLAttributes } from 'react'
import { cn } from '@/lib/utils.js'

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={cn(
        'h-9 rounded-lg border border-line bg-surface px-3 text-sm text-ink outline-none',
        'placeholder:text-ink-subtle focus-visible:border-accent disabled:opacity-50',
        className,
      )}
    />
  )
}
