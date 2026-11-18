import { useCallback, useEffect, useState } from 'react'
import { Cloud, Cpu } from 'lucide-react'
import {
  MOONSHINE_MODELS,
  MOONSHINE_SIZES,
  formatBytes,
  isMoonshineSize,
  type MoonshineModelSize,
  type MoonshineStatus,
} from '@shared/types.js'
import { SelectionMenu } from '@/components/ui/selection-menu.js'

const MOONSHINE_PREFIX = 'moonshine:'
type Choice = 'groq' | `${typeof MOONSHINE_PREFIX}${MoonshineModelSize}`

function readChoice(provider: string | undefined, size: string | undefined): Choice {
  if (provider !== 'moonshine') return 'groq'
  return `${MOONSHINE_PREFIX}${isMoonshineSize(size ?? '') ? (size as MoonshineModelSize) : 'medium'}`
}

export function TitleBarModel() {
  const [choice, setChoice] = useState<Choice>('groq')
  const [status, setStatus] = useState<Partial<Record<MoonshineModelSize, MoonshineStatus>>>({})

  useEffect(() => {
    void window.dictateflow.settings.getAll().then((s) => setChoice(readChoice(s.speechProvider, s.moonshineModelSize)))
    return window.dictateflow.settings.onChanged((s) => setChoice(readChoice(s.speechProvider, s.moonshineModelSize)))
  }, [])

  const loadStatus = useCallback(async () => {
    const rows = await Promise.all(MOONSHINE_SIZES.map(async (size) => {
      try {
        return [size, await window.dictateflow.moonshine.status(size)] as const
      } catch {
        return [size, undefined] as const
      }
    }))
    setStatus(Object.fromEntries(rows.filter(([, state]) => state)))
  }, [])

  useEffect(() => window.dictateflow.moonshine.onStatus(() => void loadStatus()), [loadStatus])

  const pick = async (next: string) => {
    const previous = await window.dictateflow.settings.getAll().catch(() => {
      throw new Error('Could not read the current engine. Try again.')
    })
    const size = next.slice(MOONSHINE_PREFIX.length)
    if (next !== 'groq' && !isMoonshineSize(size)) return

    try {
      if (next === 'groq') {
        await window.dictateflow.settings.set('speechProvider', 'groq')
      } else {
        // Selecting the provider loads its model, so save the size first.
        await window.dictateflow.settings.set('moonshineModelSize', size)
        await window.dictateflow.settings.set('speechProvider', 'moonshine')
      }
      setChoice(next as Choice)
    } catch {
      if (next !== 'groq') {
        try {
          await window.dictateflow.settings.set('moonshineModelSize', previous.moonshineModelSize ?? 'medium')
        } catch {
          // Read back the actual state below even if restoring the size fails.
        }
      }
      try {
        await window.dictateflow.settings.set('speechProvider', previous.speechProvider ?? 'groq')
      } catch {
        // A failed side effect can happen after persistence; show the read-back state.
      }
      try {
        const actual = await window.dictateflow.settings.getAll()
        setChoice(readChoice(actual.speechProvider, actual.moonshineModelSize))
      } catch {
        setChoice(readChoice(previous.speechProvider, previous.moonshineModelSize))
      }
      throw new Error('Could not change the transcription engine. Try again.')
    }
  }

  const local = choice !== 'groq'
  const Icon = local ? Cpu : Cloud
  const currentLabel = local
    ? `Moonshine ${MOONSHINE_MODELS[choice.slice(MOONSHINE_PREFIX.length) as MoonshineModelSize].label} · on this device`
    : 'Groq · cloud'

  return (
    <SelectionMenu
      name="Transcription engine"
      label={`Transcribe with: ${currentLabel}`}
      icon={<Icon size={15} strokeWidth={2} />}
      value={choice}
      options={[
        { value: 'groq', label: 'Groq · Whisper Large v3 Turbo', description: 'Fastest. Needs a key and a connection.', group: 'Cloud' },
        ...MOONSHINE_SIZES.map((size) => {
          const spec = MOONSHINE_MODELS[size]
          const state = status[size]?.state
          return {
            value: `${MOONSHINE_PREFIX}${size}`,
            label: `Moonshine ${spec.label}`,
            description: state === 'ready'
              ? `Downloaded · ${spec.wer} errors`
              : state === 'downloading'
                ? 'Downloading…'
                : `${formatBytes(spec.bytes)} download · ${spec.wer} errors`,
            group: 'On this device',
          }
        }),
      ]}
      onOpen={loadStatus}
      onSelect={pick}
    />
  )
}
