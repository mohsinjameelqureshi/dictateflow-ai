import { useEffect, useRef, useState } from 'react'
import { Ban, Check, Loader2, Mic, MicOff, TimerReset, TriangleAlert, WifiOff } from 'lucide-react'
import type { WidgetState, WidgetStatePayload } from '@shared/types.js'
import { useTheme } from '@/lib/theme.js'
import { listAudioInputs } from './devices.js'
import { Recorder } from './recorder.js'
import { Waveform } from './waveform.js'

/**
 * All nine states from §11, plus the generic error. Copy follows §12:
 * sentence case, active voice, says what happened — never apologises, never
 * vague.
 */
const COPY: Partial<Record<WidgetState, string>> = {
  processing: 'Transcribing…',
  inserting: 'Inserting',
  success: 'Inserted',
  'no-speech': "Didn't catch that",
  offline: 'No connection',
  'rate-limited': 'Rate limited — try again',
  blocked: "Can't type into this window",
}

const TONE: Partial<Record<WidgetState, string>> = {
  success: 'text-success',
  'no-speech': 'text-ink-muted',
  offline: 'text-danger',
  'rate-limited': 'text-danger',
  blocked: 'text-danger',
  error: 'text-danger',
}

function Icon({ state }: { state: WidgetState }) {
  const cls = 'size-3.5 shrink-0'
  switch (state) {
    case 'listening':
      return <Mic className={`${cls} text-accent`} />
    case 'processing':
      return <Loader2 className={`${cls} animate-spin text-accent`} />
    case 'inserting':
      return <Loader2 className={`${cls} animate-spin text-accent`} />
    case 'success':
      return <Check className={`${cls} text-success`} />
    case 'no-speech':
      return <MicOff className={`${cls} text-ink-subtle`} />
    case 'offline':
      return <WifiOff className={`${cls} text-danger`} />
    case 'rate-limited':
      return <TimerReset className={`${cls} text-danger`} />
    case 'blocked':
      return <Ban className={`${cls} text-danger`} />
    default:
      return <TriangleAlert className={`${cls} text-danger`} />
  }
}

export function Widget() {
  const [payload, setPayload] = useState<WidgetStatePayload>({ state: 'cancelled' })

  // The recorder outlives every render — rebuilding it would drop the warm
  // AudioContext that exists precisely to avoid clipping the first syllable.
  const recorderRef = useRef<Recorder | null>(null)
  if (!recorderRef.current) recorderRef.current = new Recorder()
  const recorder = recorderRef.current

  useEffect(() => {
    // Compile the worklet at load, long before the first key press.
    void recorder.warm().catch(() => {
      /* Reported on the first real start(), where the user can see it. */
    })
  }, [recorder])

  // The widget floats over the user's own screen, so it follows the app's
  // theme like everything else — `getTheme`/`onTheme` rather than settings,
  // which this surface deliberately cannot reach.
  useTheme(window.dictateflowWidget.theme)

  useEffect(() => window.dictateflowWidget.onState(setPayload), [])

  // Settings asks for the microphone list through here. Answering always —
  // even on failure — is what keeps the picker from sitting on a 5s timeout.
  useEffect(
    () =>
      window.dictateflowWidget.onEnumerate(({ requestId }) => {
        void listAudioInputs(!recorder.recording)
          .catch(() => [])
          .then((devices) => window.dictateflowWidget.sendDevices(requestId, devices))
      }),
    [recorder],
  )

  // Unplugging an external mic should revert Settings to system default without
  // waiting for the user to open the picker or hit Refresh.
  useEffect(() => {
    const onChange = () => {
      void listAudioInputs(!recorder.recording)
        .catch(() => [])
        .then((devices) => window.dictateflowWidget.notifyDevicesChanged(devices))
    }
    navigator.mediaDevices.addEventListener('devicechange', onChange)
    return () => navigator.mediaDevices.removeEventListener('devicechange', onChange)
  }, [recorder])

  useEffect(
    () =>
      window.dictateflowWidget.onCommand((command) => {
        switch (command.type) {
          case 'start':
            void recorder.start(command.deviceId).catch((err: unknown) => {
              const e = err as Error
              void window.dictateflowWidget.reportMicError({
                name: e.name ?? 'Error',
                message:
                  e.name === 'NotAllowedError'
                    ? 'Microphone access is blocked.'
                    : e.name === 'NotFoundError'
                      ? 'No microphone found.'
                      : (e.message ?? 'Microphone failed.'),
              })
            })
            return
          case 'stop':
            void window.dictateflowWidget.sendClip(recorder.stop())
            return
          case 'cancel':
            recorder.cancel()
            return
          case 'prepare':
            void recorder.prepare(command.deviceId)
        }
      }),
    [recorder],
  )

  const { state, message } = payload
  // `listening` renders a waveform instead of text, and `cancelled` is
  // invisible — both are absent from COPY on purpose.
  const label = state === 'error' ? (message ?? 'Something went wrong') : (COPY[state] ?? '')

  return (
    <div className="flex h-screen w-screen items-center justify-center p-1">
      {/* `w-fit`, not `w-full`: the pill must shrink to its content. Stretching
          to the BrowserWindow made width changes look like they never applied. */}
      <div
        role="status"
        aria-live="polite"
        className={
          'flex h-10 w-fit max-w-full items-center gap-1.5 rounded-full border border-line bg-panel/95 ' +
          'px-2.5 shadow-lg backdrop-blur-sm transition-opacity duration-150 ' +
          (state === 'cancelled' ? 'opacity-0' : 'opacity-100')
        }
      >
        <Icon state={state} />

        {state === 'listening' ? (
          <Waveform recorder={recorder} />
        ) : (
          <span className={`truncate text-xs font-medium ${TONE[state] ?? 'text-ink'}`}>
            {label}
          </span>
        )}
      </div>
    </div>
  )
}
