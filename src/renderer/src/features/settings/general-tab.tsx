import type { SettingsStore } from './use-settings.js'
import { MicrophoneField } from './microphone-field.js'
import { Row, Section, Select, Toggle } from './parts.js'
import { ShortcutField } from './shortcut-field.js'

export function GeneralTab({ settings, save }: SettingsStore) {
  const flag = (key: 'launchOnStartup' | 'minimizeToTray') => settings?.[key] === 'true'

  return (
    <div className="flex flex-col gap-4">
      <Section
        title="Dictation"
        description="Hold the shortcut, speak, release. The text lands in whatever window had focus."
      >
        <Row
          label="Shortcut"
          hint="Held, not tapped. One key plus modifiers, or a function key on its own."
        >
          <ShortcutField
            value={settings?.shortcut ?? ''}
            onSave={(combo) => void save('shortcut', combo)}
          />
        </Row>

        <Row
          label="Microphone"
          htmlFor="microphone"
          hint="System default follows whatever Windows is using."
        >
          <MicrophoneField
            value={settings?.microphoneId ?? ''}
            onSave={(id) => void save('microphoneId', id)}
          />
        </Row>
      </Section>

      <Section title="Appearance">
        <Row label="Theme" htmlFor="theme" hint="System follows Windows and changes with it.">
          <Select
            id="theme"
            value={settings?.theme ?? 'light'}
            onChange={(next) => void save('theme', next)}
          >
            <option value="system">System</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </Select>
        </Row>
      </Section>

      <Section title="Windows">
        <Row label="Open at login" hint="Start Wispr AI in the tray when you sign in.">
          <Toggle
            label="Open at login"
            checked={flag('launchOnStartup')}
            onChange={(next) => void save('launchOnStartup', String(next))}
          />
        </Row>

        {/* Closing never quits either way (§9) — the tray is how you leave, and
            quitting on close would silently disable the global shortcut. */}
        <Row
          label="Keep the window loaded"
          hint="Closing hides the window instead of unloading it, so it reopens instantly. Either way the app keeps running in the tray."
        >
          <Toggle
            label="Keep the window loaded"
            checked={flag('minimizeToTray')}
            onChange={(next) => void save('minimizeToTray', String(next))}
          />
        </Row>
      </Section>
    </div>
  )
}
