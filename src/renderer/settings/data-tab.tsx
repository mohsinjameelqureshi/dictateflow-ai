import { useState } from 'react'
import { Download, RefreshCw, TriangleAlert, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button.js'
import type { TransferResult } from '@shared/types.js'
import { Row, Section } from './parts.js'

/**
 * Export and import as JSON (§9).
 *
 * The copy is explicit about the two things people are most likely to assume
 * wrongly: the API key is not in the file, and importing adds to what is
 * already here rather than replacing it.
 */
export function DataTab() {
  const [busy, setBusy] = useState<'export' | 'import' | 'rebuild' | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)

  const run = async (which: 'export' | 'import') => {
    setBusy(which)
    setNote(null)
    setProblem(null)
    try {
      const result: TransferResult =
        which === 'export' ? await window.wispr.data.export() : await window.wispr.data.import()

      // Cancelling a file dialog is a normal thing to do, not an outcome that
      // needs reporting back.
      if (result.status === 'cancelled') return
      if (result.status === 'error') {
        setProblem(result.problem)
        return
      }

      setNote(
        which === 'export'
          ? `Saved ${count(result.dictations, 'transcript')} and ${count(
              result.dictionary,
              'dictionary word',
            )}.`
          : `Added ${count(result.dictations, 'transcript')} and ${count(
              result.dictionary,
              'dictionary word',
            )}${result.skipped > 0 ? `. Skipped ${result.skipped} already here` : ''}.`,
      )
    } catch {
      setProblem('That did not finish. Nothing was changed.')
    } finally {
      setBusy(null)
    }
  }

  const rebuild = async () => {
    setBusy('rebuild')
    setNote(null)
    setProblem(null)
    try {
      await window.wispr.insights.rebuild()
      setNote('Statistics recalculated from your history.')
    } catch {
      setProblem('Could not recalculate the statistics.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Section
        title="Backup"
        description="Plain JSON — readable, and yours. Your Groq API key is never written to it; it stays encrypted by Windows."
      >
        <Row label="Export everything" hint="Transcripts, dictionary and settings, in one file.">
          <Button variant="secondary" onClick={() => void run('export')} disabled={busy !== null}>
            <Download size={14} />
            {busy === 'export' ? 'Exporting…' : 'Export'}
          </Button>
        </Row>

        <Row
          label="Import a backup"
          hint="Adds to what is already here. Anything already present is skipped, so importing the same file twice is safe."
        >
          <Button variant="secondary" onClick={() => void run('import')} disabled={busy !== null}>
            <Upload size={14} />
            {busy === 'import' ? 'Importing…' : 'Import'}
          </Button>
        </Row>
      </Section>

      <Section title="Maintenance">
        <Row
          label="Recalculate statistics"
          hint="Rebuilds the daily totals behind Insights from your transcripts. Nothing is deleted."
        >
          <Button variant="secondary" onClick={() => void rebuild()} disabled={busy !== null}>
            <RefreshCw size={14} className={busy === 'rebuild' ? 'animate-spin' : undefined} />
            Recalculate
          </Button>
        </Row>
      </Section>

      {note && <p className="text-sm text-ink-muted">{note}</p>}
      {problem && (
        <p className="flex items-center gap-2 text-sm text-danger">
          <TriangleAlert size={14} className="shrink-0" />
          {problem}
        </p>
      )}
    </div>
  )
}

function count(n: number, noun: string): string {
  return `${n.toLocaleString()} ${noun}${n === 1 ? '' : 's'}`
}
