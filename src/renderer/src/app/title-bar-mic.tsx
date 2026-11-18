import { useCallback, useEffect, useState } from 'react'
import { Mic } from 'lucide-react'
import type { AudioInputDevice } from '@shared/types.js'
import { SelectionMenu } from '@/components/ui/selection-menu.js'

export function TitleBarMic() {
  const [devices, setDevices] = useState<AudioInputDevice[] | null>(null)
  const [selected, setSelected] = useState('')

  const load = useCallback(async () => {
    try {
      setDevices(await window.dictateflow.devices.list())
    } catch {
      setDevices([])
    }
  }, [])

  useEffect(() => {
    void window.dictateflow.settings.getAll().then((s) => setSelected(s.microphoneId ?? ''))
    return window.dictateflow.settings.onChanged((s) => setSelected(s.microphoneId ?? ''))
  }, [])

  useEffect(() => window.dictateflow.devices.onChanged(() => void load()), [load])

  const pick = async (id: string) => {
    const previous = await window.dictateflow.settings.getAll().catch(() => {
      throw new Error('Could not read the current microphone. Try again.')
    })
    try {
      await window.dictateflow.settings.set('microphoneId', id)
      setSelected(id)
    } catch {
      try {
        await window.dictateflow.settings.set('microphoneId', previous.microphoneId ?? '')
      } catch {
        // Keep the read-back value honest if restoring the setting also fails.
      }
      try {
        const actual = await window.dictateflow.settings.getAll()
        setSelected(actual.microphoneId ?? '')
      } catch {
        setSelected(previous.microphoneId ?? '')
      }
      throw new Error('Could not change the microphone. Try again.')
    }
  }

  const currentLabel = selected === ''
    ? 'System default'
    : (devices?.find((device) => device.deviceId === selected)?.label ?? 'Microphone')

  return (
    <SelectionMenu
      name="Microphone"
      label={`Microphone: ${currentLabel}`}
      icon={<Mic size={15} strokeWidth={2} />}
      value={selected}
      options={[
        { value: '', label: 'System default' },
        ...(devices ?? []).map((device) => ({ value: device.deviceId, label: device.label })),
      ]}
      note={devices === null ? 'Loading microphones…' : devices.length === 0 ? 'No microphones found.' : undefined}
      onOpen={load}
      onSelect={pick}
      width={256}
    />
  )
}
