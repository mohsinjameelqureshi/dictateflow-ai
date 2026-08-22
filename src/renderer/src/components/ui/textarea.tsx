import type { TextareaHTMLAttributes } from 'react'
import { cn } from '@/lib/utils.js'

/**
 * The same surface treatment as `Input`, sized for a paragraph.
 *
 * `resize-y` rather than `resize`: a transform rule can run long and the user
 * should be able to see all of it, but horizontal resize would break out of
 * the card it sits in.
 */
export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={cn(
        'min-h-24 w-full resize-y rounded-lg border border-line bg-surface px-3 py-2',
        'text-sm leading-relaxed text-ink outline-none',
        'placeholder:text-ink-subtle focus-visible:border-accent disabled:opacity-50',
        className,
      )}
    />
  )
}
