import { useCallback, useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button.js'
import { Tooltip } from '@/components/ui/tooltip.js'
import type { AudioInputDevice } from '@shared/types.js'
import { Select } from './parts.js'

/**
 * The microphone picker.
 *
 * The list comes from the widget, not from this window — §6.7 grants media
 * permission to the widget alone, and without it `enumerateDevices` returns
 * entries with empty labels. See main/audio/devices.ts.
 *
 * An empty stored value means "whatever Windows considers default". When the
 * chosen device disappears, main clears `microphoneId` and this field follows.
 */
export function MicrophoneField({
  value,
  onSave,
}: {
  value: string
  onSave: (deviceId: string) => void
}) {
  const [devices, setDevices] = useState<AudioInputDevice[] | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setDevices(await window.dictateflow.devices.list())
    } catch {
      setDevices([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => window.dictateflow.devices.onChanged(() => void load()), [load])

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex items-center gap-2">
        <Select
          id="microphone"
          value={value}
          onChange={onSave}
          disabled={loading && devices === null}
        >
          <option value="">System default</option>
          {devices?.map((d) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label}
            </option>
          ))}
        </Select>

        <Tooltip label="Refresh">
          <Button
            size="icon"
            variant="secondary"
            onClick={() => void load()}
            disabled={loading}
            aria-label="Refresh microphone list"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : undefined} />
          </Button>
        </Tooltip>
      </div>

      {devices?.length === 0 && (
        <p className="text-right text-[13px] text-ink-muted">No microphones found.</p>
      )}
    </div>
  )
}
