import { useEffect, useState } from 'react'
import { Download } from 'lucide-react'
import {
  MOONSHINE_MODELS,
  formatBytes,
  type MoonshineModelSize,
  type MoonshineStatus,
} from '@shared/types.js'
import { Tooltip } from '@/components/ui/tooltip.js'

/**
 * Live download progress for the local model, in the title bar.
 *
 * Exists only while a download is running. Picking a model that is not on the
 * machine starts a 292MB fetch, and that has to be visible from wherever the
 * user is — not only on the Settings card they may never open. When it
 * finishes, it leaves: a control that reports nothing is noise.
 *
 * Clicking opens the Settings model card, which is where Cancel and Resume
 * live. Deliberately not a cancel button itself — a stray click in the title
 * bar should not be able to abandon a download this large.
 */

type Job = { size: MoonshineModelSize; bytes: number; totalBytes: number }

const jobFrom = (s: MoonshineStatus): Job => ({
  size: s.size,
  bytes: s.bytes,
  totalBytes: s.totalBytes,
})

export function TitleBarDownload() {
  const [job, setJob] = useState<Job | null>(null)

  // A download already in flight when this window opened — reopening the main
  // window mid-fetch should not lose the only indicator it has.
  useEffect(() => {
    void window.dictateflow.moonshine
      .status()
      .then((s) => {
        if (s.state === 'downloading') setJob(jobFrom(s))
      })
      .catch(() => {})
  }, [])

  // Progress implies downloading, so this can adopt a job on its own. That
  // matters when the start event lands before this component mounts.
  useEffect(
    () =>
      window.dictateflow.moonshine.onProgress((p) => {
        setJob({ size: p.size, bytes: p.bytes, totalBytes: p.totalBytes })
      }),
    [],
  )

  useEffect(
    () =>
      window.dictateflow.moonshine.onStatus((s) => {
        setJob((current) => {
          if (s.state === 'downloading') return jobFrom(s)
          // Ready, error, cancelled or removed: whatever it is, the model this
          // pill was tracking is no longer downloading, so the pill goes.
          return current && current.size === s.size ? null : current
        })
      }),
    [],
  )

  if (!job) return null

  const percent =
    job.totalBytes > 0 ? Math.min(100, Math.round((job.bytes / job.totalBytes) * 100)) : 0
  const label = `Downloading Moonshine ${MOONSHINE_MODELS[job.size].label}: ${percent}%, ${formatBytes(job.bytes)} of ${formatBytes(job.totalBytes)}`

  return (
    <Tooltip label={label}>
      <button
        type="button"
        aria-label={label}
        onClick={() => void window.dictateflow.settings.open('transcription').catch(() => {})}
        className={
          'flex h-8 items-center gap-1.5 rounded-md px-2 text-ink-muted transition-colors ' +
          'hover:bg-line-soft hover:text-ink'
        }
      >
        <Download size={14} strokeWidth={2} className="shrink-0 animate-pulse" />
        <span
          className="h-1 w-10 shrink-0 overflow-hidden rounded-full bg-line"
          role="progressbar"
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <span
            className="block h-full rounded-full bg-accent transition-[width] duration-200"
            style={{ width: `${percent}%` }}
          />
        </span>
        <span className="text-[11px] tabular-nums">{percent}%</span>
      </button>
    </Tooltip>
  )
}
