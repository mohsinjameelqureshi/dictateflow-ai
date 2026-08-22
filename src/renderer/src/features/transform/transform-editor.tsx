import { useState } from 'react'
import { Button } from '@/components/ui/button.js'
import { Input } from '@/components/ui/input.js'
import { Textarea } from '@/components/ui/textarea.js'
import { ShortcutField } from '@/features/settings/shortcut-field.js'
import type { ShortcutClaim } from '@shared/shortcut.js'
import { MAX_TRANSFORM_RULE, validateTransform, type NewTransformDto } from '@shared/types.js'

/**
 * The form for one transform, used both to add and to edit.
 *
 * One component for both because the fields are identical and the difference
 * is two words of copy. Two components would be two places for the validation
 * to drift.
 *
 * `onSubmit` returns the reason it was rejected, or null — a shortcut clash is
 * an expected answer from the main process, not an exception (§12: errors say
 * what happened).
 */
export function TransformEditor({
  initial,
  claims,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial?: NewTransformDto
  claims: readonly ShortcutClaim[]
  submitLabel: string
  onSubmit: (input: NewTransformDto) => Promise<string | null>
  onCancel?: () => void
}) {
  const [name, setName] = useState(initial?.name ?? '')
  const [rule, setRule] = useState(initial?.rule ?? '')
  const [shortcut, setShortcut] = useState(initial?.shortcut ?? '')
  const [problem, setProblem] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const commit = async () => {
    // Checked here as well as in the main process, against the same shared
    // function — this one is for the message, that one is for the data.
    const local = validateTransform(name, rule)
    if (local) {
      setProblem(local)
      return
    }

    setSaving(true)
    try {
      const reason = await onSubmit({ name, rule, shortcut })
      if (reason) setProblem(reason)
      else if (!initial) {
        // Adding clears the form for the next one. Editing does not — the row
        // unmounts this component on success.
        setName('')
        setRule('')
        setShortcut('')
        setProblem(null)
      }
    } finally {
      setSaving(false)
    }
  }

  const remaining = MAX_TRANSFORM_RULE - rule.trim().length

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="transform-name" className="text-[13px] font-medium text-ink">
          Name
        </label>
        <Input
          id="transform-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Enhance prompt"
          spellCheck={false}
          className="w-full"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="transform-rule" className="text-[13px] font-medium text-ink">
          Rule
        </label>
        <Textarea
          id="transform-rule"
          value={rule}
          onChange={(e) => setRule(e.target.value)}
          placeholder="Rewrite the text as a clear, well-structured prompt for an AI assistant. Keep every requirement the author gave. Do not answer it."
          rows={5}
        />
        <p className="text-[13px] text-ink-muted">
          Write it as an instruction to the model. It never sees this app or your history — only
          this rule and the text it is rewriting.
          {remaining < 500 && (
            <span className={remaining < 0 ? 'text-danger' : ''}>
              {' '}
              {remaining < 0 ? `${-remaining} over the limit.` : `${remaining} characters left.`}
            </span>
          )}
        </p>
      </div>

      <div className="flex items-start justify-between gap-8">
        <div className="min-w-0 pt-1">
          <span className="text-[13px] font-medium text-ink">Shortcut</span>
          <p className="mt-0.5 max-w-sm text-[13px] text-ink-muted">
            Press it once — this is a tap, not a hold. It cannot contain the dictation combo or
            another transform&rsquo;s.
          </p>
        </div>
        <ShortcutField
          value={shortcut}
          mode="tap"
          claims={claims}
          allowEmpty
          onSave={setShortcut}
        />
      </div>

      {problem && <p className="text-sm text-danger">{problem}</p>}

      <div className="flex items-center gap-2">
        <Button
          variant="primary"
          onClick={() => void commit()}
          disabled={saving || !name.trim() || !rule.trim()}
        >
          {submitLabel}
        </Button>
        {onCancel && (
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </div>
  )
}
