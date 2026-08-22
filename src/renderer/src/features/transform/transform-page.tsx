import { useCallback, useEffect, useMemo, useState } from 'react'
import { Plus, Settings2, X } from 'lucide-react'
import { Empty, Page } from '@/components/page.js'
import { Button } from '@/components/ui/button.js'
import { useSettingsDialog } from '@/features/settings/store.js'
import { formatShortcut, type ShortcutClaim } from '@shared/shortcut.js'
import {
  DEFAULT_SETTINGS,
  TRANSFORM_PROVIDERS,
  isTransformProvider,
  type NewTransformDto,
  type Settings,
  type TransformDto,
} from '@shared/types.js'
import { TransformEditor } from './transform-editor.js'
import { TransformRow } from './transform-row.js'

/**
 * Transform — LLM rules bound to their own shortcuts.
 *
 * The flow this page describes: text is already in a field (dictated, typed or
 * pasted), the user presses a rule's combo, the text is taken out, rewritten
 * against the rule, and put back. See docs/transform-feature-plan.md.
 *
 * It sits beside Dictionary in the sidebar because both are "rules", and that
 * is the only thing they share. A dictionary rule is deterministic, instant and
 * free, and runs inside every dictation. A transform is a network round trip
 * the user asks for by name.
 */
export function TransformPage() {
  const [entries, setEntries] = useState<TransformDto[]>([])
  const [settings, setSettings] = useState<Settings | null>(null)
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  const openSettings = useSettingsDialog((s) => s.open)

  const load = useCallback(async () => {
    try {
      setEntries(await window.dictateflow.transforms.list())
    } catch {
      setProblem('Could not read your transforms.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
    void window.dictateflow.settings.getAll().then(setSettings).catch(() => setSettings({}))
  }, [load])

  // The engine and the dictation combo are both shown here and both live in
  // Settings, so this page has to follow a change made in the dialog over it.
  useEffect(() => window.dictateflow.settings.onChanged(setSettings), [])
  // A transform run bumps a hit count. Same reason the dictionary listens to
  // dictations: the number on screen should be the number in the database.
  useEffect(() => window.dictateflow.transforms.onChanged(() => void load()), [load])

  /**
   * Every combo already spoken for, for the shortcut field's conflict check.
   *
   * A DISABLED rule still claims its combo — two rules quietly sharing one
   * would work until the second was enabled, and then one would silently stop
   * firing. Refusing now, while the user is looking at the field, is kinder
   * than a mystery later. The main process enforces the same rule against a
   * fresher snapshot.
   */
  const claims = useMemo((): ShortcutClaim[] => {
    const dictation = settings?.shortcut ?? DEFAULT_SETTINGS.shortcut
    return [
      { shortcut: dictation, owner: 'dictation' },
      ...entries.filter((e) => e.shortcut).map((e) => ({ shortcut: e.shortcut, owner: e.name })),
    ]
  }, [entries, settings])

  /** The same list minus one row, so editing a rule does not clash with itself. */
  const claimsExcept = useCallback(
    (id: number): ShortcutClaim[] => {
      const target = entries.find((e) => e.id === id)
      return claims.filter((c) => !target || c.shortcut !== target.shortcut || c.owner !== target.name)
    },
    [claims, entries],
  )

  const add = async (input: NewTransformDto): Promise<string | null> => {
    const result = await window.dictateflow.transforms.create(input)
    if (!result.ok) return result.problem
    setAdding(false)
    setProblem(null)
    await load()
    return null
  }

  const save = async (id: number, input: NewTransformDto): Promise<string | null> => {
    const result = await window.dictateflow.transforms.update(id, input)
    if (!result.ok) return result.problem
    await load()
    return null
  }

  const toggle = (id: number, enabled: boolean) => {
    const target = entries.find((e) => e.id === id)
    if (!target) return

    // Optimistic — a switch that lags a round trip feels broken — and rolled
    // back on failure rather than left claiming something that never happened.
    setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, enabled } : e)))
    void window.dictateflow.transforms
      .update(id, { name: target.name, rule: target.rule, shortcut: target.shortcut, enabled })
      .then((result) => {
        if (result.ok) return
        setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, enabled: !enabled } : e)))
        setProblem(result.problem)
      })
      .catch(() => {
        setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, enabled: !enabled } : e)))
        setProblem('That change could not be saved.')
      })
  }

  const remove = (id: number) => {
    const previous = entries
    setEntries((prev) => prev.filter((e) => e.id !== id))
    void window.dictateflow.transforms.remove(id).catch(() => {
      setEntries(previous)
      setProblem('Could not delete that transform.')
    })
  }

  const providerId = isTransformProvider(settings?.transformProvider ?? '')
    ? TRANSFORM_PROVIDERS[settings?.transformProvider as keyof typeof TRANSFORM_PROVIDERS]
    : TRANSFORM_PROVIDERS.groq
  const model = settings?.[providerId.modelKey] ?? ''

  return (
    <Page
      title="Transform"
      description="Rewrite the text that is already in a field. Press a shortcut, and the rule you wrote is applied to it in place."
      actions={
        !adding && (
          <Button variant="primary" onClick={() => setAdding(true)}>
            <Plus size={14} />
            New transform
          </Button>
        )
      }
    >
      {/* The engine, stated rather than hidden in Settings. It applies to every
          rule below, it costs a network round trip, and on a Moonshine install
          it is the one thing on screen that is not local - so it belongs where
          the rules are, not two clicks away. */}
      <button
        type="button"
        onClick={() => openSettings('transform')}
        className="flex w-full items-center gap-2 rounded-panel border border-line bg-panel px-4 py-3 text-left transition-colors hover:bg-line-soft"
      >
        <Settings2 size={14} className="shrink-0 text-ink-subtle" aria-hidden />
        <span className="min-w-0 flex-1 truncate text-[13px] text-ink-muted">
          Every rule runs on{' '}
          <span className="font-medium text-ink">{providerId.label}</span>
          {model && <span className="text-ink-subtle"> · {model}</span>}
        </span>
        <span className="shrink-0 text-[13px] text-ink-muted">Change</span>
      </button>

      {adding && (
        <section className="mt-4 rounded-panel border border-accent bg-panel p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-medium text-ink">New transform</h2>
            <Button size="icon" variant="ghost" onClick={() => setAdding(false)} aria-label="Close">
              <X size={14} />
            </Button>
          </div>
          <TransformEditor claims={claims} submitLabel="Add transform" onSubmit={add} />
        </section>
      )}

      {problem && <p className="mt-4 text-sm text-danger">{problem}</p>}

      <div className="mt-4">
        {loading ? (
          <p className="text-sm text-ink-muted">Loading…</p>
        ) : entries.length === 0 ? (
          <Empty
            title="No transforms yet"
            hint="A transform is an instruction - “make this formal”, “turn this into bullets” - bound to a shortcut you press while the text is on screen."
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {entries.map((entry) => (
              <TransformRow
                key={entry.id}
                entry={entry}
                claims={claimsExcept(entry.id)}
                onSave={save}
                onToggle={toggle}
                onDelete={remove}
              />
            ))}
          </ul>
        )}
      </div>

      <p className="mt-6 text-[13px] leading-relaxed text-ink-subtle">
        A transform takes whatever is selected. With nothing selected it takes the whole field, so
        in a document that means the whole document - select first when the field is large.
        Dictation stays on {formatShortcut(settings?.shortcut ?? DEFAULT_SETTINGS.shortcut)}; a
        transform combo can never contain it.
      </p>
    </Page>
  )
}
