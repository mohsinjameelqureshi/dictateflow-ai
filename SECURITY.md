# Security

## Reporting a vulnerability

Please do not open a public issue for a security problem.

Use GitHub's **Report a vulnerability** button under the Security tab, which
opens a private advisory. If that is unavailable, email the address on the
maintainer's GitHub profile.

This is a personal project with one maintainer, so there is no guaranteed
response time. Expect a reply within a week or so, and please give a
reasonable window before public disclosure.

## What this app actually does

Worth knowing before assessing it. DictateFlow AI:

- installs a **global keyboard hook** (`uiohook-napi`) that observes every
  keystroke system-wide, in order to detect the hold-to-talk shortcut
- **simulates keyboard input** (`nut.js`) to paste into the focused window
- **reads and writes the clipboard** on every dictation
- holds a **Groq API key** and sends recorded audio to Groq's API
- writes an unencrypted SQLite database and WAV files to `%APPDATA%`

Any of those is worth scrutiny. That is why the source is public.

## Design

**The API key** is the only secret the app holds. It is encrypted with
Electron `safeStorage`, which on Windows is DPAPI, and written to
`groq-key.bin` — deliberately *not* into the settings table, so that a copied
database yields nothing. The ciphertext is bound to the Windows user account,
so the file is useless on another machine or under another account. If OS
encryption is unavailable the app refuses to save the key rather than falling
back to plaintext.

**The renderer is sandboxed.** `contextIsolation: true`,
`nodeIntegration: false`, `sandbox: true`, and a typed preload bridge exposing
a fixed set of IPC channels. The renderer has no filesystem access, cannot
read the API key, and loads no remote content. The Content-Security-Policy
keeps `connect-src` at `'self'` in production — the Groq call happens in the
main process.

**Audio playback cannot be used to read arbitrary files.** The
`dictateflow-audio://` handler takes a dictation id, not a path. It looks the
row up in the database, takes `path.basename` of the stored filename, joins it
to the recordings directory, and verifies the result is still inside that
directory. Both the basename and the prefix check are required; either alone
is a path-traversal hole.

**The keyboard hook does not log.** It matches modifier keycodes to start and
stop recording and discards everything else. It writes nothing to disk.

## What is not protected

Stated plainly so nobody assumes otherwise:

- **The database is not encrypted.** Your transcripts and recordings are
  readable by anything running as your Windows user. Full-disk encryption
  (BitLocker) is the intended protection, and Windows already provides it.
  Adding a login screen to the app would not change this — see `CLAUDE.md` §2.
- **Releases are not code signed.** Verify the published SHA256 checksum, or
  build from source.
- **Audio goes to a third party.** Groq receives your recorded speech and is
  governed by their privacy policy, not this one.

## Dependencies

Native modules (`better-sqlite3`, `uiohook-napi`) are compiled locally at
install time via `electron-rebuild`; no prebuilt binaries are fetched from
anywhere other than the packages' own published artifacts.
