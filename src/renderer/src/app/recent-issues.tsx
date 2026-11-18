import { useCallback, useEffect, useRef, useState } from 'react'
import { CircleAlert, Settings2 } from 'lucide-react'
import type { SessionIssue } from '@shared/types.js'
import { Button } from '@/components/ui/button.js'
import { Dialog } from '@/components/ui/dialog.js'
import { Tooltip } from '@/components/ui/tooltip.js'
import { useSettingsDialog } from '@/features/settings/store.js'
import { cn } from '@/lib/utils.js'

function title(issue: SessionIssue): string {
  switch (issue.state) {
    case 'offline': return 'Connection unavailable'
    case 'rate-limited': return 'Provider rate limit'
    case 'blocked': return 'Text insertion blocked'
    case 'no-speech': return 'No speech detected'
    case 'no-text': return 'No text to transform'
    default: return issue.source === 'transform' ? 'Transform failed' : 'Dictation failed'
  }
}

export function RecentIssues() {
  const [open, setOpen] = useState(false)
  const [issues, setIssues] = useState<SessionIssue[]>([])
  const [loading, setLoading] = useState(true)
  const [clearing, setClearing] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const revision = useRef(0)
  const openSettings = useSettingsDialog((state) => state.open)

  const load = useCallback(async () => {
    const request = ++revision.current
    setLoading(true)
    setProblem(null)
    try {
      const rows = await window.dictateflow.sessionIssues.list()
      if (request === revision.current) setIssues(rows)
    } catch {
      if (request === revision.current) setProblem('Could not read recent issues. Try again.')
    } finally {
      if (request === revision.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    const unsubscribe = window.dictateflow.sessionIssues.onChanged((rows) => {
      revision.current += 1
      setIssues(rows)
      setProblem(null)
      setLoading(false)
    })
    void load()
    return () => {
      revision.current += 1
      unsubscribe()
    }
  }, [load])

  const clear = async () => {
    setClearing(true)
    setProblem(null)
    try {
      await window.dictateflow.sessionIssues.clear()
    } catch {
      setProblem('Could not clear recent issues. Try again.')
    } finally {
      setClearing(false)
    }
  }

  const label = issues.length ? `Recent issues (${issues.length})` : 'Recent issues'
  const hasErrors = issues.some((issue) => issue.state !== 'no-speech' && issue.state !== 'no-text')
  return (
    <>
      <Tooltip label={label}>
        <button
          type="button"
          aria-label={label}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => setOpen(true)}
          className={cn(
            'flex h-8 items-center gap-1.5 rounded-md px-2 text-ink-muted transition-colors hover:bg-line-soft hover:text-ink',
            hasErrors && 'text-danger',
          )}
        >
          <CircleAlert size={15} strokeWidth={2} aria-hidden />
          {issues.length > 0 && <span className="text-[11px] font-medium tabular-nums" aria-hidden>{issues.length}</span>}
        </button>
      </Tooltip>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Recent issues"
        description="The latest 20 dictation and transform issues, kept until you quit the app."
        className="h-[560px] max-w-[680px]"
      >
        <div className="flex min-h-0 flex-1 flex-col gap-4 px-5 pb-5">
          <div className="flex items-center justify-between gap-3">
            <Button size="sm" onClick={() => {
              setOpen(false)
              openSettings('general')
            }}>
              <Settings2 size={14} aria-hidden />
              Open settings
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void clear()} disabled={clearing || loading || issues.length === 0}>
              {clearing ? 'Clearing…' : 'Clear issues'}
            </Button>
          </div>
          {problem && (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-danger/30 bg-danger/5 p-3">
              <p role="alert" className="text-sm text-danger">{problem}</p>
              <Button size="sm" onClick={() => void load()} disabled={loading}>Try again</Button>
            </div>
          )}
          {loading ? (
            <p role="status" className="py-6 text-sm text-ink-muted">Loading recent issues…</p>
          ) : issues.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center rounded-lg border border-line bg-panel px-6 py-10 text-center">
              <p className="text-sm font-medium text-ink">{problem ? 'Recent issues unavailable' : 'No recent issues'}</p>
              <p className="mt-1 max-w-sm text-sm text-ink-muted">Recording and transform problems will appear here with their full details.</p>
            </div>
          ) : (
            <ol aria-label="Recent dictation and transform issues" className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
              {issues.map((issue) => (
                <li key={issue.id} className="rounded-lg border border-line bg-panel p-4">
                  <div className="flex items-start gap-2">
                    <CircleAlert size={16} className={cn('mt-0.5 shrink-0', issue.state === 'no-speech' || issue.state === 'no-text' ? 'text-ink-muted' : 'text-danger')} aria-hidden />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-ink">{title(issue)}</p>
                      <p className="mt-1 break-words text-xs text-ink-muted">
                        {issue.source === 'transform' ? 'Transform' : 'Dictation'}
                        {issue.detail && ` · ${issue.detail}`}
                        {' · '}<time dateTime={new Date(issue.createdAt).toISOString()}>{new Date(issue.createdAt).toLocaleString()}</time>
                      </p>
                      <p className="selectable mt-3 whitespace-pre-wrap break-words text-sm leading-relaxed text-ink">{issue.message}</p>
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      </Dialog>
    </>
  )
}
