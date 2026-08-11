import { useCallback, useEffect, useState } from 'react'
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

  const load = useCallback(async () => {
    try {
      setEntries(await window.dictateflow.dictionary.list())
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
    // Checked here as well as in the main process, against the same shared
    // function — this one is for the message, that one is for the data.
    const local = validateRule(from, to)
    if (local) {
      setProblem(local)
      return
    }

    const result = await window.dictateflow.dictionary.create({ from, to })
    if (!result.ok) {
      setProblem(result.problem)
      return
    }

    setFrom('')
    setTo('')
    setProblem(null)
    await load()
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
      <section className="rounded-panel border border-line bg-panel p-5">
        <h2 className="text-sm font-medium text-ink">Add a word</h2>

        <div className="mt-4 flex items-center gap-2">
          <Input
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void add()
            }}
            placeholder="grog"
            aria-label="Heard as"
            spellCheck={false}
            className="min-w-0 flex-1"
          />
          <ArrowRight size={14} className="shrink-0 text-ink-subtle" aria-hidden />
          <Input
            value={to}
            onChange={(e) => setTo(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void add()
            }}
            placeholder="Groq"
            aria-label="Should be"
            spellCheck={false}
            className="min-w-0 flex-1"
          />
          <Button variant="primary" onClick={() => void add()} disabled={!from.trim() || !to.trim()}>
            <Plus size={14} />
            Add
          </Button>
        </div>

        <p className="mt-2 text-[13px] text-ink-muted">
          Matching ignores case and only ever replaces whole words, so a rule for “cat” leaves
          “concatenate” alone.
        </p>

        {problem && <p className="mt-3 text-sm text-danger">{problem}</p>}
      </section>

      <div className="mt-4">
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
