# DictateFlow AI 1.0.0

First public release. Windows 10 and 11, 64-bit.

Hold `Ctrl` + `Win` (the default, rebindable to anything), speak, then release.
The text is inserted into whatever application had focus: your editor, a
browser field, Slack, anything.

History, statistics and recordings stay in a local SQLite file. The only thing
that leaves your machine is the audio clip, sent to Groq to be transcribed.
No account, no login, no telemetry.

## What is in it

- Global hold-to-talk shortcut, rebindable to any key or modifier combination
- Floating widget that appears on the monitor your cursor is on, and never
  takes focus, so the text lands in the window behind it
- Transcription by Groq, using Whisper large-v3-turbo
- Personal dictionary: deterministic find-and-replace for the words the
  transcriber keeps getting wrong, applied after transcription
- History with search, copy, favourite, delete, and playback of the original
  recording for every session
- Insights: words per minute, totals, sessions, streaks, and a year-long
  activity heatmap, all derived from your own database
- Settings for shortcut, microphone, theme, launch at login and tray behaviour
- Export and import everything as plain JSON
- Light and dark themes

## Install

1. Download `dictateflow-ai.exe` below.
2. Run it. It installs per-user and does not ask for administrator rights.
3. SmartScreen will warn you. See the next section.

## Setup

You need your own free Groq API key. There is no bundled key and no server in
front of the API.

1. Get a key at [console.groq.com](https://console.groq.com). Free tier, no
   card required.
2. Paste it into **Settings → API**.

The key is encrypted with Windows DPAPI, tied to your Windows account, and
stored outside the database. It never leaves your machine.

## This installer is not code signed

A certificate costs a few hundred dollars a year, which is not justified for a
personal project. So Windows SmartScreen shows:

> **Windows protected your PC**
> Microsoft Defender SmartScreen prevented an unrecognised app from starting.

Click **More info**, then **Run anyway**.

That warning means "nobody has paid to vouch for this file", not "this file is
known to be malicious". If you would rather not take that on faith, verify the
download:

```
SHA256  94DDCDE76545B90D49A1617729C770ECDEA7D3C30BF5839DDEEE3C9773A8F65A
```

```powershell
Get-FileHash .\dictateflow-ai.exe -Algorithm SHA256
```

Or build it yourself from source. It takes about five minutes.

## Known limitations

- **Cannot type into elevated windows.** A non-elevated process cannot send
  input to a process running as administrator. This is Windows UIPI, not a
  bug. You get a clear error rather than silent failure.
- **Requires a network connection.** Expect 1 to 2 seconds between releasing
  the key and the text appearing. Most of that is network round-trip and
  free-tier queueing, not transcription.
- **Grammar cleanup is off by default.** An LLM pass over Whisper's output
  measurably deletes words, so it ships disabled. The raw transcript is always
  stored and always shown.
- **Very short or very quiet clips are dropped.** Whisper invents confident
  text out of silence, so an accidental tap is rejected rather than typed.
- **Windows only.** The keyboard hook, the insertion path and the packaging
  are all Windows-specific. No macOS or Linux build, and none planned.

Full details in the [README](https://github.com/mohsinjameelqureshi/dictateflow-ai#readme).

MIT licensed.
