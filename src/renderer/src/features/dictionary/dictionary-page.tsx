import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { ArrowRight, Plus } from 'lucide-react'
import { Empty, Page } from '@/components/page.js'
import { Button } from '@/components/ui/button.js'
import { Input } from '@/components/ui/input.js'
import { validateRule, type DictionaryDto } from '@shared/types.js'
import { RuleRow } from './rule-row.js'

/**
 * The personal dictionary (§9).
 *
 * It ships in v1 because it is deterministic, instant, free, and fixes the
 * exact proper-noun failures seen in testing — Wispr Flow itself transcribed
 * "Groq" as "grog" during the same session.
 *
 * It does two jobs, which is worth saying in the UI: entries are fed to
 * Whisper as a vocabulary hint so the error is less likely in the first place
 * (§6.5), and anything that slips through is replaced afterwards.
 */
export function DictionaryPage() {
  const [entries, setEntries] = useState<DictionaryDto[]>([])
  const [loading, setLoading] = useState(true)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const [formProblem, setFormProblem] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<{ from?: string; to?: string }>({})
  const [adding, setAdding] = useState(false)
  const [added, setAdded] = useState(false)
  const addingRef = useRef(false)
  const fromInput = useRef<HTMLInputElement>(null)
  const toInput = useRef<HTMLInputElement>(null)
  const formId = useId()

  const load = useCallback(async () => {
    try {
      setEntries(await window.dictateflow.dictionary.list())
      setProblem(null)
    } catch {
      setProblem('Could not read your dictionary.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // A dictation bumps hit counts, so the same event History listens to keeps
  // the counts here honest.
  useEffect(() => window.dictateflow.dictations.onChanged(() => void load()), [load])

  const add = async () => {
    if (addingRef.current) return
    setFormProblem(null)
    setFieldErrors({})
    setAdded(false)
    // Checked here as well as in the main process, against the same shared
    // function — this one is for the message, that one is for the data.
    const local = validateRule(from, to)
    if (local) {
      if (!from.trim()) {
        setFieldErrors({ from: local })
        fromInput.current?.focus()
      } else {
        setFieldErrors({ to: local })
        toInput.current?.focus()
      }
      return
    }

    addingRef.current = true
    setAdding(true)
    try {
      const result = await window.dictateflow.dictionary.create({ from, to })
      if (!result.ok) {
        setFormProblem(result.problem)
        return
      }
      setFrom('')
      setTo('')
      setAdded(true)
      await load()
    } catch {
      setFormProblem('Could not add that word. Your entries are still here. Try again.')
    } finally {
      addingRef.current = false
      setAdding(false)
    }
  }

  const save = async (id: number, nextFrom: string, nextTo: string): Promise<string | null> => {
    const result = await window.dictateflow.dictionary.update(id, { from: nextFrom, to: nextTo })
    if (!result.ok) return result.problem
    await load()
    return null
  }

  const remove = (id: number) => {
    const previous = entries
    setEntries((prev) => prev.filter((e) => e.id !== id))
    void window.dictateflow.dictionary.remove(id).catch(() => {
      setEntries(previous)
      setProblem('Could not delete that rule.')
    })
  }

  return (
    <Page
      title="Dictionary"
      description="Words this app keeps getting wrong. Entries are suggested to the transcriber up front, and corrected afterwards if they still slip through."
    >
      <form
        noValidate
        aria-labelledby={`${formId}-title`}
        aria-busy={adding}
        className="rounded-panel border border-line bg-panel p-5"
        onSubmit={(event) => {
          event.preventDefault()
          void add()
        }}
      >
        <h2 id={`${formId}-title`} className="text-sm font-medium text-ink">Add a word</h2>

        <div className="mt-4 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto] items-start gap-2">
          <div className="flex min-w-0 flex-col gap-1.5">
            <label htmlFor={`${formId}-from`} className="text-[13px] font-medium text-ink">Heard as</label>
            <Input
              ref={fromInput}
              id={`${formId}-from`}
              value={from}
              onChange={(e) => {
                setFrom(e.target.value)
                setFieldErrors({})
                setFormProblem(null)
                setAdded(false)
              }}
              placeholder="e.g. grog"
              aria-invalid={!!fieldErrors.from}
              aria-describedby={fieldErrors.from ? `${formId}-from-error` : `${formId}-hint`}
              disabled={adding}
              spellCheck={false}
              className={fieldErrors.from ? 'w-full border-danger' : 'w-full'}
            />
            {fieldErrors.from && <p id={`${formId}-from-error`} role="alert" className="text-xs text-danger">{fieldErrors.from}</p>}
          </div>
          <ArrowRight size={14} className="mt-9 shrink-0 text-ink-subtle" aria-hidden />
          <div className="flex min-w-0 flex-col gap-1.5">
            <label htmlFor={`${formId}-to`} className="text-[13px] font-medium text-ink">Replace with</label>
            <Input
              ref={toInput}
              id={`${formId}-to`}
              value={to}
              onChange={(e) => {
                setTo(e.target.value)
                setFieldErrors({})
                setFormProblem(null)
                setAdded(false)
              }}
              placeholder="e.g. Groq"
              aria-invalid={!!fieldErrors.to}
              aria-describedby={fieldErrors.to ? `${formId}-to-error` : `${formId}-hint`}
              disabled={adding}
              spellCheck={false}
              className={fieldErrors.to ? 'w-full border-danger' : 'w-full'}
            />
            {fieldErrors.to && <p id={`${formId}-to-error`} role="alert" className="text-xs text-danger">{fieldErrors.to}</p>}
          </div>
          <Button type="submit" variant="primary" className="mt-[26px] min-w-24" disabled={adding}>
            <Plus size={14} aria-hidden />
            {adding ? 'Adding…' : 'Add word'}
          </Button>
        </div>

        <p id={`${formId}-hint`} className="mt-3 text-[13px] text-ink-muted">
          Matching ignores case and only ever replaces whole words, so a rule for “cat” leaves
          “concatenate” alone.
        </p>

        {formProblem && <p role="alert" className="mt-3 text-sm text-danger">{formProblem}</p>}
        {(from || to) && !adding && (
          <p className="mt-3 text-xs text-ink-subtle">Your draft is kept while you switch pages.</p>
        )}
        {added && <p role="status" className="mt-3 text-sm text-success">Word added to your dictionary.</p>}
      </form>

      <div className="mt-4">
        {problem && <p role="alert" className="mb-4 text-sm text-danger">{problem}</p>}
        {loading ? (
          <p className="text-sm text-ink-muted">Loading…</p>
        ) : entries.length === 0 ? (
          <Empty
            title="No words yet"
            hint="Add the names and terms that come back wrong. Proper nouns are the usual culprits."
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {entries.map((entry) => (
              <RuleRow key={entry.id} entry={entry} onSave={save} onDelete={remove} />
            ))}
          </ul>
        )}
      </div>
    </Page>
  )
}
