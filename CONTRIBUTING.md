# Contributing

This is a single-maintainer project built for one person's daily use. That
shapes what is likely to get merged, so it is worth being direct about it.

## Before a large pull request, open an issue

Small fixes — a bug, a typo, a missed error path — just send them. For
anything larger, open an issue first. The scope in `CLAUDE.md` §9 is
deliberate, and several obvious-looking features are on the "explicitly not
building" list for reasons that are written down there:

- authentication and user accounts
- cloud sync or a hosted database
- telemetry of any kind
- multi-user features

A PR adding one of those will be declined regardless of how well it is
written. This is not a product looking for users; it is a tool that stays
small on purpose.

## Read the spec

[`CLAUDE.md`](CLAUDE.md) is the build specification, not documentation written
after the fact. Sections marked **MEASURED** contain real numbers from real
testing — please do not re-litigate them without new measurements.

§6 in particular lists the constraints that silently break this class of app:
why `globalShortcut` cannot do hold-to-talk, why the widget must never take
focus, why insertion goes through the clipboard, why pixel offsets break under
DPI scaling. Changes in those areas are the ones most likely to look fine
locally and fail on someone else's machine.

## Standards

`CLAUDE.md` §14 defines done. In short:

- Strict TypeScript, no `any`
- Every failure path handled and surfaced in the UI, not swallowed
- Keyboard accessible with visible focus states
- Any file written to disk is deleted with the row that owns it
- `contextIsolation` and `sandbox` stay intact
- Works at 125% and 150% DPI scaling
- Respects `prefers-reduced-motion`

Run before submitting:

```bash
npm run typecheck
npm run build
```

CI runs both on `windows-latest`. There is no test suite yet; if you are
adding one, that is a welcome issue to open.

## Commit messages

Conventional-ish and lowercase — `feat(dictation): ...`, `fix(widget): ...`.
Explain *why* in the body when the change is not obvious. The existing history
is the reference.

## Platform

Windows x64 only. macOS and Linux support would mean a second keyboard hook, a
second insertion path and a second packaging target. Patches that add
cross-platform scaffolding without a maintainer for those platforms create
work that cannot be honoured, so they will not be merged.
